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

interface VoiceVersion {
  voiceId: string;
  audioUrl: string;
  totalDuration: number;
}

// Helper functions for voice versions
function getCurrentVoiceVersion(book: any): VoiceVersion | null {
  if (!book.current_voice_id || !Array.isArray(book.voice_versions)) return null;
  
  return book.voice_versions.find((v: VoiceVersion) => v.voiceId === book.current_voice_id) || null;
}

function getCurrentAudioUrl(book: any): string | null {
  const currentVersion = getCurrentVoiceVersion(book);
  return currentVersion?.audioUrl || null;
}

function getCurrentTotalDuration(book: any): number {
  const currentVersion = getCurrentVoiceVersion(book);
  return currentVersion?.totalDuration || 0;
}

function getCurrentProgress(book: any): number {
  if (!book.current_voice_id || typeof book.voice_progress !== 'object') return 0;
  return book.voice_progress[book.current_voice_id] || 0;
}

// Helper function to transform book for API response
function transformBookForResponse(book: any): any {
  const currentVoiceVersion = getCurrentVoiceVersion(book);
  const currentProgress = getCurrentProgress(book);
  
  return {
    ...book,
    // Add convenience fields for frontend
    current_audio_url: currentVoiceVersion?.audioUrl || null,
    current_total_duration: currentVoiceVersion?.totalDuration || 0,
    current_progress: currentProgress,
    total_voice_versions: Array.isArray(book.voice_versions) ? book.voice_versions.length : 0,
    // Calculate progress percentage
    progress_percentage: currentVoiceVersion && currentVoiceVersion.totalDuration > 0 
      ? Math.round((currentProgress / currentVoiceVersion.totalDuration) * 100 * 10) / 10 
      : 0
  };
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
        page_count: imageUrls.length,
        image_urls: [], // Images are deleted after OCR processing
        text_content: sortedOCRResults.map(page => page.text), // Store extracted text
        voice_versions: [
          {
            voiceId: voiceId,
            audioUrl: finalAudioUrl,
            totalDuration: combineResult.output.totalDuration || 0
          }
        ],
        current_voice_id: voiceId,
        voice_progress: {}, // Empty progress initially
        status: 'completed'
      }
    });

    console.log(`Book created successfully: ${book.id}`);

    // Transform book for response with current voice info
    const transformedBook = transformBookForResponse(book);

    // Return the transformed book object
    return res.status(201).json({
      success: true,
      book: transformedBook,
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
    
    // Transform books for response with current voice info
    const transformedBooks = booksToReturn.map(transformBookForResponse);
    
    // Get next cursor (created_at of the last book)
    const nextCursor = hasNextPage && booksToReturn.length > 0 
      ? booksToReturn[booksToReturn.length - 1].id 
      : null;
    
    return res.status(200).json({
      success: true,
      books: transformedBooks,
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
    
    // Transform book for response with current voice info
    const transformedBook = transformBookForResponse(book);
    
    return res.status(200).json({
      success: true,
      book: transformedBook
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
    
    // Delete all voice versions
    if (Array.isArray(book.voice_versions)) {
      for (const voiceVersion of book.voice_versions as unknown as VoiceVersion[]) {
        const audioPath = extractStoragePathFromUrl(voiceVersion.audioUrl, userId, id);
        if (audioPath) {
          console.log(`Deleting audio file: ${audioPath}`);
          
          const { error: audioError } = await supabase.storage
            .from('book-audio')
            .remove([audioPath]);
          
          if (audioError) {
            console.warn('Failed to delete audio file:', audioError);
          } else {
            console.log(`Deleted audio file: ${audioPath}`);
            deletedFiles++;
          }
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

/**
 * Stream a book's audio with range request support
 * GET /books/:id/stream
 */
export const streamBookAudio = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      error: 'Book ID is required'
    });
  }
  
  try {
    // Get the book to ensure it exists and belongs to the user
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
    
    const currentAudioUrl = getCurrentAudioUrl(book);
    if (!currentAudioUrl) {
      return res.status(404).json({
        error: 'Audio file not found for this book'
      });
    }
    
    // Get the audio file from Supabase Storage
    const audioPath = extractStoragePathFromUrl(currentAudioUrl, userId, id);
    if (!audioPath) {
      return res.status(500).json({
        error: 'Invalid audio file path'
      });
    }
    
    // Download the file from Supabase Storage to get metadata
    const { data: audioFile, error: downloadError } = await supabase.storage
      .from('book-audio')
      .download(audioPath);
      
    if (downloadError || !audioFile) {
      console.error('Failed to download audio file:', downloadError);
      return res.status(500).json({
        error: 'Failed to access audio file'
      });
    }
    
    // Get file size
    const fileSize = audioFile.size;
    const range = req.headers.range;
    
    if (range) {
      // Handle range requests for seeking/progressive download
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      
      // Set partial content headers
      res.status(206); // Partial Content
      res.set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      });
      
      // Stream the requested chunk
      const audioBuffer = await audioFile.arrayBuffer();
      const chunk = Buffer.from(audioBuffer).slice(start, end + 1);
      return res.send(chunk);
      
    } else {
      // Handle full file requests
      res.set({
        'Content-Length': fileSize.toString(),
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      });
      
      // Stream the entire file
      const audioBuffer = await audioFile.arrayBuffer();
      return res.send(Buffer.from(audioBuffer));
    }
    
  } catch (error) {
         console.error('Error streaming audio:', error);
     return res.status(500).json({
       error: 'Failed to stream audio',
       details: error instanceof Error ? error.message : 'Unknown error'
     });
   }
 });

/**
 * Update book progress (current listening position)
 * PATCH /books/:id/progress
 * Body: { currentTime: number } // Current audio timestamp in seconds
 */
export const updateBookProgress = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { id } = req.params;
  const { currentTime } = req.body;
  
  if (!id) {
    return res.status(400).json({
      error: 'Book ID is required'
    });
  }
  
  if (typeof currentTime !== 'number' || currentTime < 0) {
    return res.status(400).json({
      error: 'currentTime must be a non-negative number (seconds)'
    });
  }
  
  try {
    // Check if book exists and belongs to user
    const existingBook = await prisma.book.findFirst({
      where: {
        id: id,
        user_id: userId
      }
    });
    
    if (!existingBook) {
      return res.status(404).json({
        error: 'Book not found'
      });
    }
    
    const currentTotalDuration = getCurrentTotalDuration(existingBook);
    
    // Validate currentTime doesn't exceed total duration (with small buffer for rounding)
    if (currentTime > currentTotalDuration + 5) {
      return res.status(400).json({
        error: `Current time cannot exceed total duration (${currentTotalDuration} seconds)`
      });
    }
    
    // Calculate percentage progress
    const progressPercentage = currentTotalDuration > 0 
      ? Math.min((currentTime / currentTotalDuration) * 100, 100)
      : 0;
    
    // Update voice-specific progress
    const currentVoiceProgress = (existingBook.voice_progress as any) || {};
    const currentVoiceId = existingBook.current_voice_id;
    
    if (currentVoiceId) {
      currentVoiceProgress[currentVoiceId] = Math.round(currentTime);
    }
    
    const updatedBook = await prisma.book.update({
      where: {
        id: id
      },
      data: {
        voice_progress: currentVoiceProgress,
        updated_at: new Date()
      }
    });
    
    console.log(`Updated progress for book ${id}: ${currentTime}s / ${currentTotalDuration}s (${progressPercentage.toFixed(1)}%)`);
    
    // Transform book for response with current voice info
    const transformedBook = transformBookForResponse(updatedBook);
    
    return res.status(200).json({
      success: true,
      book: transformedBook,
      progressPercentage: Math.round(progressPercentage * 10) / 10, // Round to 1 decimal place
      currentTime: Math.round(currentTime),
      totalDuration: currentTotalDuration
    });
    
  } catch (error) {
    console.error('Error updating book progress:', error);
    return res.status(500).json({
      error: 'Failed to update book progress',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Add pages to an existing book
 * POST /books/:id/add-pages
 * FormData: { voiceId: string, images: File[] }
 */
export const addPagesToBook = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { id } = req.params;
  const { voiceId } = req.body;
  const images = req.files;

  // Validate inputs
  if (!id) {
    return res.status(400).json({
      error: 'Book ID is required'
    });
  }

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
      error: 'Maximum 10 images allowed per addition'
    });
  }

  console.log(`Adding ${images.length} pages to book ${id} for user ${userId}`);

  try {
    // Get existing book and validate
    const existingBook = await prisma.book.findFirst({
      where: {
        id: id,
        user_id: userId
      }
    });

    if (!existingBook) {
      return res.status(404).json({
        error: 'Book not found'
      });
    }

    if (existingBook.status !== 'completed') {
      return res.status(400).json({
        error: 'Can only add pages to completed books'
      });
    }

    // PHASE 0: Upload new images to Supabase Storage
    console.log('PHASE 0: Uploading new images to storage...');
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

    const newImageUrls = uploadResults.map(result => result.publicUrl!);
    console.log(`Uploaded ${newImageUrls.length} new images successfully`);

    // PHASE 1: Extract text from new images using OCR
    console.log('PHASE 1: Starting OCR processing for new images');
    
    // Create payload array for new OCR tasks
    const ocrPayloads = newImageUrls.map((imageUrl: string, index: number) => ({
      payload: {
        imageUrl,
        pageNumber: existingBook.page_count + index + 1, // Continue from existing page count
        totalPages: existingBook.page_count + newImageUrls.length
      }
    }));

    console.log(`Processing ${ocrPayloads.length} new images for OCR`);

    let sortedOCRResults: any[] = [];
    
    try {
      // Execute all OCR tasks at once
      const ocrBatchResult = await extractTextFromImage.batchTriggerAndWait(ocrPayloads);
      console.log(`OCR batch completed`);

      // Process OCR results
      if (ocrBatchResult.runs) {
        console.log(`Received ${ocrBatchResult.runs.length} OCR runs`);
        
        const ocrResults: any[] = [];
        
        for (let index = 0; index < ocrBatchResult.runs.length; index++) {
          const run = ocrBatchResult.runs[index];
          if (run.ok && run.output?.success) {
            console.log(`✅ OCR ${index + 1} completed successfully`);
            ocrResults[index] = {
              pageNumber: existingBook.page_count + index + 1,
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

    console.log(`OCR processing complete. Total new pages: ${sortedOCRResults.length}/${newImageUrls.length}`);

    if (sortedOCRResults.length === 0) {
      return res.status(500).json({
        error: 'No text was successfully extracted from any new images'
      });
    }

    // PHASE 2: Convert new text to speech
    console.log('PHASE 2: Starting text-to-speech conversion for new pages');
    
    // Create payload array for TTS tasks (starting from existing chunk count)
    const ttsPayloads = sortedOCRResults.map((page, index) => ({
      payload: {
        text: page.text,
        voiceId,
        userId,
        bookId: id,
        chunkIndex: existingBook.page_count + index // Continue chunk indexing
      }
    }));

    console.log(`Converting ${ttsPayloads.length} new text chunks to speech`);

    let newChunkUrls: any[] = [];

    try {
      // Execute all TTS tasks at once
      const ttsBatchResult = await textToSpeech.batchTriggerAndWait(ttsPayloads);
      console.log(`TTS batch completed`);

      // Process TTS results
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
        newChunkUrls = ttsResults
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

    console.log(`TTS processing complete. Total new audio chunks: ${newChunkUrls.length}/${sortedOCRResults.length}`);

    if (newChunkUrls.length === 0) {
      return res.status(500).json({
        error: 'No audio was successfully generated from any new text'
      });
    }

    // PHASE 3: Append new audio chunks to existing book
    console.log('PHASE 3: Appending new audio chunks to existing book');

    const combineResult = await tasks.triggerAndWait<typeof combineBookAudio>(
      'combine-book-audio',
      {
        userId,
        bookId: id,
        totalChunks: newChunkUrls.length,
        chunkUrls: newChunkUrls,
        isAppending: true, // Flag to indicate this is an append operation
        existingAudioUrl: getCurrentAudioUrl(existingBook) || undefined
      }
    );
    
    if (!combineResult.ok) {
      console.error('Audio combination failed:', combineResult.error);
      return res.status(500).json({
        error: 'Failed to append new audio to existing book',
        details: combineResult.error
      });
    }
    
    console.log('Audio append operation successful!');
    
    const finalAudioUrl = combineResult.output?.finalAudioUrl;
    if (!finalAudioUrl) {
      console.error('Final audio URL is missing or invalid', combineResult.output);
      return res.status(500).json({
        error: 'Final audio URL is missing or invalid'
      });
    }

    // PHASE 4: Update book record with updated voice version
    console.log('Updating book record in database...');
    
    // Update the current voice version with new audio and duration
    const voiceVersions = existingBook.voice_versions as unknown as VoiceVersion[];
    const currentVoiceId = existingBook.current_voice_id;
    
    const updatedVoiceVersions = voiceVersions.map(version => {
      if (version.voiceId === currentVoiceId) {
        return {
          ...version,
          audioUrl: finalAudioUrl,
          totalDuration: combineResult.output.totalDuration || version.totalDuration
        };
      }
      return version;
    });
    
    // Update text content with new pages
    const existingTextContent = existingBook.text_content as string[];
    const newTextContent = [...existingTextContent, ...sortedOCRResults.map(page => page.text)];
    
    const updatedBook = await prisma.book.update({
      where: {
        id: id
      },
      data: {
        voice_versions: updatedVoiceVersions as any,
        text_content: newTextContent,
        page_count: existingBook.page_count + newImageUrls.length,
        updated_at: new Date()
      }
    });

    console.log(`Book updated successfully: ${updatedBook.id}`);
    console.log(`Added ${newImageUrls.length} pages. Total pages: ${updatedBook.page_count}`);

    const newTotalDuration = getCurrentTotalDuration(updatedBook);
    const transformedBook = transformBookForResponse(updatedBook);

    return res.status(200).json({
      success: true,
      message: `Successfully added ${newImageUrls.length} pages to book`,
      book: transformedBook,
      addedPages: newImageUrls.length,
      newTotalPages: updatedBook.page_count,
      newTotalDuration: newTotalDuration
    });

  } catch (error) {
    console.error('Error adding pages to book:', error);
    
    return res.status(500).json({
      error: 'Failed to add pages to book',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Change the voice of an existing book
 * POST /books/:id/change-voice
 * Body: { voiceId: string }
 */
export const changeBookVoice = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { id } = req.params;
  const { voiceId } = req.body;

  // Validate inputs
  if (!id) {
    return res.status(400).json({
      error: 'Book ID is required'
    });
  }

  if (!voiceId) {
    return res.status(400).json({
      error: 'Voice ID is required'
    });
  }

  console.log(`Changing voice for book ${id} to voice ${voiceId} for user ${userId}`);

  try {
    // Get existing book and validate
    const existingBook = await prisma.book.findFirst({
      where: {
        id: id,
        user_id: userId
      }
    });

    if (!existingBook) {
      return res.status(404).json({
        error: 'Book not found'
      });
    }

    if (existingBook.status !== 'completed') {
      return res.status(400).json({
        error: 'Can only change voice for completed books'
      });
    }

    // Validate that the voice belongs to the user
    const voice = await prisma.userVoice.findFirst({
      where: {
        id: voiceId,
        user_id: userId
      }
    });

    if (!voice) {
      return res.status(404).json({
        error: 'Voice not found'
      });
    }

    const voiceVersions = existingBook.voice_versions as unknown as VoiceVersion[];
    
    // Check if this voice version already exists
    const existingVoiceVersion = voiceVersions.find(v => v.voiceId === voiceId);
    
    if (existingVoiceVersion) {
      // Voice version already exists, just switch to it
      console.log(`Voice version already exists, switching to voice ${voiceId}`);
      
      const updatedBook = await prisma.book.update({
        where: { id: id },
        data: {
          current_voice_id: voiceId,
          updated_at: new Date()
        }
      });

      const transformedBook = transformBookForResponse(updatedBook);

      return res.status(200).json({
        success: true,
        message: 'Successfully switched to existing voice version',
        book: transformedBook,
        currentVoice: voice.voice_name,
        audioUrl: existingVoiceVersion.audioUrl,
        totalDuration: existingVoiceVersion.totalDuration
      });
    }

    // Voice version doesn't exist, need to create it
    console.log(`Creating new voice version for voice ${voiceId}`);

    // Get the text content for TTS conversion
    const textContent = existingBook.text_content as string[];
    
    if (!textContent || textContent.length === 0) {
      return res.status(400).json({
        error: 'Book text content not available. Cannot create new voice version.'
      });
    }

    // PHASE 1: Convert text to speech with new voice
    console.log(`Converting ${textContent.length} text chunks to speech with new voice`);
    
    const ttsPayloads = textContent.map((text, index) => ({
      payload: {
        text,
        voiceId,
        userId,
        bookId: id,
        chunkIndex: index
      }
    }));

    let newChunkUrls: any[] = [];

    try {
      // Execute all TTS tasks at once
      const ttsBatchResult = await textToSpeech.batchTriggerAndWait(ttsPayloads);
      console.log(`TTS batch completed`);

      // Process TTS results
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
        newChunkUrls = ttsResults
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

    console.log(`TTS processing complete. Total audio chunks: ${newChunkUrls.length}/${textContent.length}`);

    if (newChunkUrls.length === 0) {
      return res.status(500).json({
        error: 'No audio was successfully generated from any text'
      });
    }

    // PHASE 2: Combine audio chunks into final book
    console.log('PHASE 2: Combining audio chunks into final book with new voice');

    const combineResult = await tasks.triggerAndWait<typeof combineBookAudio>(
      'combine-book-audio',
      {
        userId,
        bookId: id,
        totalChunks: newChunkUrls.length,
        chunkUrls: newChunkUrls
      }
    );
    
    if (!combineResult.ok) {
      console.error('Audio combination failed:', combineResult.error);
      return res.status(500).json({
        error: 'Failed to combine audio chunks for new voice',
        details: combineResult.error
      });
    }
    
    console.log('Audio combination successful for new voice!');
    
    const finalAudioUrl = combineResult.output?.finalAudioUrl;
    const totalDuration = combineResult.output?.totalDuration || 0;
    
    if (!finalAudioUrl) {
      console.error('Final audio URL is missing or invalid', combineResult.output);
      return res.status(500).json({
        error: 'Final audio URL is missing or invalid'
      });
    }

    // PHASE 3: Update book with new voice version
    console.log('PHASE 3: Adding new voice version to book');
    
    const newVoiceVersion: VoiceVersion = {
      voiceId: voiceId,
      audioUrl: finalAudioUrl,
      totalDuration: totalDuration
    };

    const updatedVoiceVersions = [...voiceVersions, newVoiceVersion];

    // Carry over progress from previous voice to new voice
    const currentProgress = getCurrentProgress(existingBook);
    const currentVoiceProgress = (existingBook.voice_progress as any) || {};
    currentVoiceProgress[voiceId] = currentProgress; // Set new voice to same progress

    const updatedBook = await prisma.book.update({
      where: { id: id },
      data: {
        voice_versions: updatedVoiceVersions as any,
        current_voice_id: voiceId,
        voice_progress: currentVoiceProgress,
        updated_at: new Date()
      }
    });

    console.log(`Book voice changed successfully: ${updatedBook.id}`);
    console.log(`New voice: ${voice.voice_name} (${voiceId}) - Starting at ${currentProgress}s`);

    const transformedBook = transformBookForResponse(updatedBook);

    return res.status(200).json({
      success: true,
      message: `Successfully created and switched to new voice version: ${voice.voice_name}`,
      book: transformedBook,
      currentVoice: voice.voice_name,
      audioUrl: finalAudioUrl,
      totalDuration: totalDuration,
      currentProgress: currentProgress, // Include the carried-over progress
      totalVoiceVersions: updatedVoiceVersions.length
    });

  } catch (error) {
    console.error('Error changing book voice:', error);
    
    return res.status(500).json({
      error: 'Failed to change book voice',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

