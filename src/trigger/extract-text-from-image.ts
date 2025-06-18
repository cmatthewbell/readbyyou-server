import { task } from '@trigger.dev/sdk/v3';
import OpenAI from 'openai';
import { supabase } from '../config/supabase';

interface Payload {
  imageUrl: string;
}

interface ExtractedText {
  success: boolean;
  text: string;
  pageCount: number; // 1 for single page, 2 for double page
  confidence: 'high' | 'medium' | 'low';
  error?: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Helper function to extract storage path from image URL
 * URL format: https://project.supabase.co/storage/v1/object/public/book-images/userId/timestamp-uuid.jpg
 */
function extractImagePathFromUrl(url: string): string | null {
  try {
    // Extract the path after the bucket name
    const urlParts = url.split('/');
    const bucketIndex = urlParts.findIndex(part => part === 'book-images');
    
    if (bucketIndex === -1) return null;
    
    // Get the path after book-images/
    const pathParts = urlParts.slice(bucketIndex + 1);
    return pathParts.join('/');
  } catch (error) {
    console.warn('Failed to extract image path from URL:', url);
    return null;
  }
}

export const extractTextFromImage = task({
  id: 'extract-text-from-image',
  maxDuration: 1200,
  onFailure: async (_payload: Payload, error: unknown) => {
    console.error('Failed to extract text from image', error);
  },
  run: async (payload: Payload): Promise<ExtractedText> => {
    console.log('Extracting text from image', payload);

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert OCR system specialized in extracting text from book pages. 

INSTRUCTIONS:
1. Extract ALL text content from the image accurately, preserving the original structure and formatting
2. Handle both single-page and double-page spreads (when user photographs 2 pages at once)
3. For double-page spreads, read from left page first, then right page
4. Maintain paragraph breaks and proper spacing
5. Include chapter titles, headers, footers, and page numbers if visible
6. If text is unclear or partially obscured, make your best interpretation
7. Indicate your confidence level in the extraction

RESPONSE FORMAT:
Return a JSON object with:
- "text": The extracted text content
- "pageCount": 1 for single page, 2 for double page spread
- "confidence": "high", "medium", or "low" based on image quality and text clarity

EXAMPLE RESPONSE:
{
  "text": "Chapter 1\\n\\nThe story begins on a dark and stormy night...",
  "pageCount": 1,
  "confidence": "high"
}`
          },
          {
            role: "user", 
            content: [
              {
                type: "text",
                text: "Please extract all text from this book page/pages. Ensure you capture every word accurately and maintain the original formatting."
              },
              {
                type: "image_url",
                image_url: {
                  url: payload.imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.1 // Low temperature for consistent, accurate extraction
      });

      const responseContent = completion.choices[0].message.content;
      
      if (!responseContent) {
        throw new Error('No response content from OpenAI');
      }

      // Try to parse as JSON, fallback to plain text if needed
      let result: ExtractedText;
      try {
        const parsed = JSON.parse(responseContent);
        result = {
          success: true,
          text: parsed.text || responseContent,
          pageCount: parsed.pageCount || 1,
          confidence: parsed.confidence || 'medium'
        };
      } catch (parseError) {
        // If not valid JSON, treat entire response as extracted text
        console.warn('Response not in JSON format, using as plain text');
        result = {
          success: true,
          text: responseContent,
          pageCount: 1,
          confidence: 'medium'
        };
      }

      console.log(`Extracted ${result.text.length} characters from ${result.pageCount} page(s) with ${result.confidence} confidence`);
      
      // Delete the image from storage after successful extraction
      try {
        const imagePath = extractImagePathFromUrl(payload.imageUrl);
        if (imagePath) {
          const { error: deleteError } = await supabase.storage
            .from('book-images')
            .remove([imagePath]);
            
          if (deleteError) {
            console.warn('Failed to delete image after OCR:', deleteError);
          } else {
            console.log(`Successfully deleted image: ${imagePath}`);
          }
        }
      } catch (deleteError) {
        console.warn('Error deleting image after OCR:', deleteError);
        // Don't fail the task if image deletion fails
      }
      
      return result;

    } catch (error) {
      console.error('Error in text extraction:', error);
      
      // Return failure response instead of throwing
      return {
        success: false,
        text: '',
        pageCount: 1,
        confidence: 'low',
        error: error instanceof Error ? error.message : 'Could not extract text from image. Please try again with a clearer image.'
      };
    }
  }
});