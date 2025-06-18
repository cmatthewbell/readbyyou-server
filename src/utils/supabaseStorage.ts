import { supabase } from '../config/supabase';
import { v4 as uuidv4 } from 'uuid';

export interface UploadResult {
  success: boolean;
  publicUrl?: string;
  path?: string;
  error?: string;
}

// Bucket names
const BOOK_IMAGES_BUCKET = 'book-images';
const BOOK_AUDIO_BUCKET = 'book-audio';

/**
 * Upload an image file to Supabase Storage
 * @param file - The file buffer
 * @param userId - User ID for organizing files
 * @param originalName - Original filename
 * @returns Upload result with public URL
 */
export const uploadImage = async (
  file: Buffer,
  userId: string,
  originalName: string
): Promise<UploadResult> => {
  try {
    // Generate unique filename
    const fileExtension = originalName.split('.').pop()?.toLowerCase() || 'jpg';
    const uniqueId = uuidv4();
    const timestamp = Date.now();
    
    // Create file path: userId/timestamp-uniqueId.ext
    const filePath = `${userId}/${timestamp}-${uniqueId}.${fileExtension}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BOOK_IMAGES_BUCKET)
      .upload(filePath, file, {
        contentType: `image/${fileExtension}`,
        upsert: false // Don't overwrite existing files
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(BOOK_IMAGES_BUCKET)
      .getPublicUrl(filePath);

    return {
      success: true,
      publicUrl: publicUrlData.publicUrl,
      path: filePath
    };

  } catch (error) {
    console.error('Upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown upload error'
    };
  }
};

/**
 * Upload multiple images in parallel
 * @param files - Array of file buffers with metadata
 * @param userId - User ID
 * @returns Array of upload results
 */
export const uploadMultipleImages = async (
  files: Array<{ buffer: Buffer; originalName: string }>,
  userId: string
): Promise<UploadResult[]> => {
  const uploadPromises = files.map(file => 
    uploadImage(file.buffer, userId, file.originalName)
  );

  return Promise.all(uploadPromises);
};

/**
 * Upload an audio file to Supabase Storage
 * @param file - The audio file buffer
 * @param userId - User ID for organizing files
 * @param bookId - Book ID for grouping audio chunks
 * @param fileName - Filename for the audio chunk
 * @returns Upload result with public URL
 */
export const uploadAudio = async (
  file: Buffer,
  userId: string,
  bookId: string,
  fileName: string
): Promise<UploadResult> => {
  try {
    // Create file path: userId/bookId/fileName
    const filePath = `${userId}/${bookId}/${fileName}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BOOK_AUDIO_BUCKET)
      .upload(filePath, file, {
        contentType: 'audio/mpeg',
        upsert: false // Don't overwrite existing files
      });

    if (error) {
      console.error('Supabase audio upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(BOOK_AUDIO_BUCKET)
      .getPublicUrl(filePath);

    return {
      success: true,
      publicUrl: publicUrlData.publicUrl,
      path: filePath
    };

  } catch (error) {
    console.error('Audio upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown upload error'
    };
  }
}; 