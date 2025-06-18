import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { uploadMultipleImages } from '../utils/supabaseStorage';
import { supabase } from '../config/supabase';
import { extractTextFromImage } from '../trigger/extract-text-from-image';
import { textToSpeech } from '../trigger/text-to-speech';
import { combineBookAudio } from '../trigger/combine-book-audio';
import { tasks } from '@trigger.dev/sdk/v3';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    provider: string;
    provider_id: string;
  };
  files?: any[];
}

/**
 * Create a new book from uploaded images
 * POST /books/create
 * FormData: { voiceId: string, images: File[], title?: string }
 */
export const createBook = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const { voiceId, title: providedTitle } = req.body;
  const images = req.files;
  const userId = req.user.id;

  // Validate inputs
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({
      error: 'At least one image file is required'
    });
  }

  if (!voiceId) {
    return res.status(400).json({
      error: 'Voice ID is required'
    });
  }

  if (images.length > 10) {
    return res.status(400).json({
      error: 'Maximum 10 images allowed per book'
    });
  }

  console.log(`Creating book for user ${userId} with ${images.length} images`);

  try {
    // Generate unique book ID
    const bookId = uuidv4();

    // PHASE 0: Upload images to Supabase Storage
    console.log('PHASE 0: Uploading images to storage...');
    const imageFiles = images.map((file: any) => ({
      buffer: file.buffer,
      originalName: file.originalname
    }));

    const uploadResults = await uploadMultipleImages(imageFiles, userId);
    
    // Check for upload failures
    const failedUploads = uploadResults.filter(result => !result.success);
    if (failedUploads.length > 0) {
      console.error('Some image uploads failed:', failedUploads);
      return res.status(500).json({
        error: 'Failed to upload some images',
        details: failedUploads.map(f => f.error)
      });
    }

    const imageUrls = uploadResults.map(result => result.publicUrl!);
    console.log(`Uploaded ${imageUrls.length} images successfully`);

    // PHASE 1: Extract text from all images using OCR
    console.log('PHASE 1: Starting OCR processing for all images');
    
    // Create payload array for all OCR tasks
    const ocrPayloads = imageUrls.map((imageUrl: string, index: number) => ({
      payload: {
        imageUrl,
        pageNumber: index + 1,
        totalPages: imageUrls.length
      }
    }));

    console.log(`Processing ${ocrPayloads.length} images for OCR in a single batch`);

    let sortedOCRResults: any[] = [];
    
    try {
      // Execute all OCR tasks at once
      const ocrBatchResult = await extractTextFromImage.batchTriggerAndWait(ocrPayloads);
      console.log(`OCR batch completed`);

      // Process each run in the batch
      if (ocrBatchResult.runs) {
        console.log(`Received ${ocrBatchResult.runs.length} OCR runs`);
        
        const ocrResults: any[] = [];
        
        for (let index = 0; index < ocrBatchResult.runs.length; index++) {
          const run = ocrBatchResult.runs[index];
          if (run.ok && run.output?.success) {
            console.log(`✅ OCR ${index + 1} completed successfully`);
            ocrResults[index] = {
              pageNumber: index + 1,
              text: run.output.text || '',
              confidence: run.output.confidence || 'low'
            };
          } else {
            const errorMsg = 'error' in run ? run.error : 'Unknown OCR error';
            console.error(`❌ Failed to process OCR ${index + 1}:`, errorMsg);
            return res.status(500).json({
              error: `Failed to extract text from image ${index + 1}`,
              details: errorMsg
            });
          }
        }

        // Sort by page number
        sortedOCRResults = ocrResults
          .filter(result => result !== undefined)
          .sort((a, b) => a.pageNumber - b.pageNumber);

      } else {
        console.error(`OCR batch result does not contain runs property:`, ocrBatchResult);
        return res.status(500).json({
          error: 'OCR batch processing failed'
        });
      }
    } catch (error) {
      console.error(`Error processing OCR batch:`, error);
      return res.status(500).json({
        error: 'Failed to process OCR batch',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    console.log(`OCR processing complete. Total pages: ${sortedOCRResults.length}/${imageUrls.length}`);

    if (sortedOCRResults.length === 0) {
      return res.status(500).json({
        error: 'No text was successfully extracted from any images'
      });
    }

    // PHASE 2: Convert text to speech for each page
    console.log('PHASE 2: Starting text-to-speech conversion for all pages');
    
    // Create payload array for all TTS tasks
    const ttsPayloads = sortedOCRResults.map((page, index) => ({
      payload: {
        text: page.text,
        voiceId,
        userId,
        bookId,
        chunkIndex: index
      }
    }));

    console.log(`Converting ${ttsPayloads.length} text chunks to speech in a single batch`);

    let chunkUrls: any[] = [];

    try {
      // Execute all TTS tasks at once
      const ttsBatchResult = await textToSpeech.batchTriggerAndWait(ttsPayloads);
      console.log(`TTS batch completed`);

      // Process each run in the batch
      if (ttsBatchResult.runs) {
        console.log(`Received ${ttsBatchResult.runs.length} TTS runs`);
        
        const ttsResults: any[] = [];
        
        for (let index = 0; index < ttsBatchResult.runs.length; index++) {
          const run = ttsBatchResult.runs[index];
          if (run.ok && run.output?.success) {
            console.log(`✅ TTS ${index + 1} completed successfully`);
            ttsResults[index] = {
              chunkIndex: run.output.chunkIndex,
              audioUrl: run.output.audioUrl,
              duration: run.output.duration || 0
            };
          } else {
            const errorMsg = 'error' in run ? run.error : 'Unknown TTS error';
            console.error(`❌ Failed to process TTS ${index + 1}:`, errorMsg);
            return res.status(500).json({
              error: `Failed to convert text to speech for chunk ${index + 1}`,
              details: errorMsg
            });
          }
        }

        // Filter out undefined results and sort by chunk index
        chunkUrls = ttsResults
          .filter(result => result !== undefined)
          .sort((a, b) => a.chunkIndex - b.chunkIndex);

      } else {
        console.error(`TTS batch result does not contain runs property:`, ttsBatchResult);
        return res.status(500).json({
          error: 'TTS batch processing failed'
        });
      }
    } catch (error) {
      console.error(`Error processing TTS batch:`, error);
      return res.status(500).json({
        error: 'Failed to process TTS batch',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    console.log(`TTS processing complete. Total audio chunks: ${chunkUrls.length}/${sortedOCRResults.length}`);

    if (chunkUrls.length === 0) {
      return res.status(500).json({
        error: 'No audio was successfully generated from any text'
      });
    }

    // PHASE 3: Combine all audio chunks into final book
    console.log('PHASE 3: Combining all audio chunks into final book');

    const combineResult = await tasks.triggerAndWait<typeof combineBookAudio>(
      'combine-book-audio',
      {
        userId,
        bookId,
        totalChunks: chunkUrls.length,
        chunkUrls
      }
    );
    
    if (!combineResult.ok) {
      console.error('Audio combination failed:', combineResult.error);
      return res.status(500).json({
        error: 'Failed to combine audio chunks',
        details: combineResult.error
      });
    }
    
    console.log('Audio combination successful!');
    
    // Final Audio URL from the combine-book-audio task
    if (!combineResult.output || typeof combineResult.output.finalAudioUrl !== 'string') {
      console.error('Final audio URL is missing or invalid', combineResult.output);
      return res.status(500).json({
        error: 'Final audio URL is missing or invalid'
      });
    }
    
    const finalAudioUrl = combineResult.output.finalAudioUrl;

    // PHASE 4: Detect book title using OpenAI (if not provided)
    let bookTitle = providedTitle;
    
    if (!bookTitle) {
      console.log('PHASE 4: Detecting book title...');
      try {
        const allText = sortedOCRResults.map(page => page.text).join('\n\n');
        const titlePrompt = `Analyze the following text from a book and determine the book title. Look for title pages, headers, or other indicators of the book's title. If you cannot determine a clear title, respond with "Unknown Book".

Text:
${allText.substring(0, 2000)}...`; // Limit text for API efficiency

        const titleResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a book title detection assistant. Respond only with the book title, nothing else.'
            },
            {
              role: 'user',
              content: titlePrompt
            }
          ],
          max_tokens: 100,
          temperature: 0
        });

        const detectedTitle = titleResponse.choices[0]?.message?.content?.trim();
        bookTitle = detectedTitle && detectedTitle !== 'Unknown Book' 
          ? detectedTitle 
          : `Book ${bookId.substring(0, 8)}`;

        console.log(`Detected title: ${bookTitle}`);
      } catch (error) {
        console.warn('Title detection failed, using fallback:', error);
        bookTitle = `Book ${bookId.substring(0, 8)}`;
      }
    }

    // Create book record in database
    console.log('Creating book record in database...');
    const book = await prisma.book.create({
      data: {
        id: bookId,
        user_id: userId,
        title: bookTitle,
        audio_url: finalAudioUrl,
        total_duration: combineResult.output.totalDuration || 0,
        page_count: imageUrls.length,
        image_urls: [], // Images are deleted after OCR processing
        status: 'completed'
      }
    });

    console.log(`Book created successfully: ${book.id}`);

    // Return the actual database book object
    return res.status(201).json({
      success: true,
      book,
    });

  } catch (error) {
    console.error('Error creating book:', error);
    
    return res.status(500).json({
      error: 'Failed to create book',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get all books for the authenticated user with cursor pagination
 * GET /books?cursor=book-id&limit=10
 */
export const getUserBooks = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { cursor, limit = '10' } = req.query;
  
  // Parse and validate limit
  const pageSize = Math.min(Math.max(parseInt(limit as string) || 10, 1), 50); // Min 1, Max 50
  
  try {
    // Build where clause for cursor pagination
    const where: any = {
      user_id: userId
    };
    
    // If cursor is provided, get books created before this cursor
    if (cursor && typeof cursor === 'string') {
      where.created_at = {
        lt: await getCursorDate(cursor)
      };
    }
    
    // Fetch books with pagination
    const books = await prisma.book.findMany({
      where,
      orderBy: {
        created_at: 'desc' // Most recent first
      },
      take: pageSize + 1 // Take one extra to determine if there's a next page
    });
    
    // Check if there are more books (hasNextPage)
    const hasNextPage = books.length > pageSize;
    const booksToReturn = hasNextPage ? books.slice(0, pageSize) : books;
    
    // Get next cursor (created_at of the last book)
    const nextCursor = hasNextPage && booksToReturn.length > 0 
      ? booksToReturn[booksToReturn.length - 1].id 
      : null;
    
    return res.status(200).json({
      success: true,
      books: booksToReturn,
      pagination: {
        hasNextPage,
        nextCursor,
        limit: pageSize
      }
    });
    
  } catch (error) {
    console.error('Error fetching user books:', error);
    return res.status(500).json({
      error: 'Failed to fetch books',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Helper function to get the created_at date from a cursor (book ID)
 */
async function getCursorDate(cursor: string): Promise<Date> {
  const book = await prisma.book.findUnique({
    where: { id: cursor },
    select: { created_at: true }
  });
  
  if (!book) {
    throw new Error('Invalid cursor provided');
  }
  
  return book.created_at;
}

/**
 * Get a single book by ID for the authenticated user
 * GET /books/:id
 */
export const getBook = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      error: 'Book ID is required'
    });
  }
  
  try {
    const book = await prisma.book.findFirst({
      where: {
        id: id,
        user_id: userId // Ensure user can only access their own books
      }
    });
    
    if (!book) {
      return res.status(404).json({
        error: 'Book not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      book
    });
    
  } catch (error) {
    console.error('Error fetching book:', error);
    return res.status(500).json({
      error: 'Failed to fetch book',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Delete a book and all its associated storage
 * DELETE /books/:id
 */
export const deleteBook = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      error: 'Book ID is required'
    });
  }
  
  try {
    // First, get the book to ensure it exists and belongs to the user
    const book = await prisma.book.findFirst({
      where: {
        id: id,
        user_id: userId
      }
    });
    
    if (!book) {
      return res.status(404).json({
        error: 'Book not found'
      });
    }
    
    console.log(`Deleting book ${id} and all associated storage`);
    
    // Delete audio files from Supabase Storage (images are deleted during OCR processing)
    let deletedFiles = 0;
    
    if (book.audio_url) {
      const audioPath = extractStoragePathFromUrl(book.audio_url, userId, id);
      if (audioPath) {
        console.log(`Deleting audio file: ${audioPath}`);
        
        const { error: audioError } = await supabase.storage
          .from('book-audio')
          .remove([audioPath]);
        
        if (audioError) {
          console.warn('Failed to delete audio file:', audioError);
        } else {
          console.log(`Deleted audio file: ${audioPath}`);
          deletedFiles = 1;
        }
      }
    }
    
    // 4. Delete book record from database
    await prisma.book.delete({
      where: {
        id: id
      }
    });
    
    console.log(`Book ${id} deleted successfully`);
    
    return res.status(200).json({
      success: true,
      message: 'Book and all associated files deleted successfully',
      deletedFiles: deletedFiles
    });
    
  } catch (error) {
    console.error('Error deleting book:', error);
    return res.status(500).json({
      error: 'Failed to delete book',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Helper function to extract storage path from audio URL
 * URL format: https://project.supabase.co/storage/v1/object/public/book-audio/userId/bookId/complete-book.mp3
 */
function extractStoragePathFromUrl(url: string, userId: string, bookId: string): string | null {
  try {
    // Extract the path after the bucket name
    const urlParts = url.split('/');
    const bucketIndex = urlParts.findIndex(part => part === 'book-audio');
    
    if (bucketIndex === -1) return null;
    
    // Get the path after book-audio/
    const pathParts = urlParts.slice(bucketIndex + 1);
    return pathParts.join('/');
  } catch (error) {
    console.warn('Failed to extract audio path from URL:', url);
    return null;
  }
}

