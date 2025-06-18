import { task } from '@trigger.dev/sdk/v3';
import { uploadAudio } from '../utils/supabaseStorage';
import { supabase } from '../config/supabase';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';

interface Payload {
  userId: string;
  bookId: string;
  totalChunks: number;
  chunkUrls: Array<{
    chunkIndex: number;
    audioUrl: string;
    duration: number;
  }>;
  isAppending?: boolean; // Optional flag for append operations
  existingAudioUrl?: string; // URL of existing audio to append to
}

interface CombineResult {
  success: boolean;
  finalAudioUrl?: string;
  finalAudioPath?: string;
  totalDuration?: number;
  deletedChunks?: number;
  error?: string;
}

export const combineBookAudio = task({
  id: 'combine-book-audio',
  maxDuration: 3600, // 1 hour for large books
  onFailure: async (_payload: Payload, error: unknown) => {
    console.error('Failed to combine book audio', error);
  },
  run: async (payload: Payload): Promise<CombineResult> => {
    console.log(`Combining ${payload.totalChunks} audio chunks for book ${payload.bookId}`);

    const tempDir = path.join(os.tmpdir(), `book-${payload.bookId}-${Date.now()}`);
    
    try {
      // Validate inputs
      if (!payload.chunkUrls || payload.chunkUrls.length === 0) {
        return {
          success: false,
          error: 'No audio chunks provided'
        };
      }

      if (payload.chunkUrls.length !== payload.totalChunks) {
        return {
          success: false,
          error: `Expected ${payload.totalChunks} chunks, but received ${payload.chunkUrls.length}`
        };
      }

      // Create temporary directory
      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }

      console.log(`Created temp directory: ${tempDir}`);

      // Sort chunks by index to ensure correct order
      const sortedChunks = payload.chunkUrls.sort((a, b) => a.chunkIndex - b.chunkIndex);

      // Handle existing audio if this is an append operation
      const allAudioFiles: string[] = [];
      let totalDuration = 0;

      if (payload.isAppending && payload.existingAudioUrl) {
        console.log('Downloading existing audio for append operation...');
        try {
          const response = await fetch(payload.existingAudioUrl);
          if (!response.ok) {
            throw new Error(`Failed to download existing audio: ${response.statusText}`);
          }

          const existingAudioBuffer = Buffer.from(await response.arrayBuffer());
          const existingAudioPath = path.join(tempDir, 'existing-audio.mp3');
          
          await writeFile(existingAudioPath, existingAudioBuffer);
          allAudioFiles.push(existingAudioPath);

          console.log(`Downloaded existing audio: ${existingAudioBuffer.length} bytes`);
        } catch (error) {
          console.error('Error downloading existing audio:', error);
          throw new Error(`Failed to download existing audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Download all new chunks
      const chunkFiles: string[] = [];

      for (const chunk of sortedChunks) {
        console.log(`Downloading chunk ${chunk.chunkIndex} from ${chunk.audioUrl}`);
        
        try {
          // Download the audio file
          const response = await fetch(chunk.audioUrl);
          if (!response.ok) {
            throw new Error(`Failed to download chunk ${chunk.chunkIndex}: ${response.statusText}`);
          }

          const audioBuffer = Buffer.from(await response.arrayBuffer());
          const chunkPath = path.join(tempDir, `chunk-${chunk.chunkIndex.toString().padStart(3, '0')}.mp3`);
          
          await writeFile(chunkPath, audioBuffer);
          chunkFiles.push(chunkPath);
          totalDuration += chunk.duration;

          console.log(`Downloaded chunk ${chunk.chunkIndex}: ${audioBuffer.length} bytes`);
        } catch (error) {
          console.error(`Error downloading chunk ${chunk.chunkIndex}:`, error);
          throw new Error(`Failed to download chunk ${chunk.chunkIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Combine all audio files (existing + new chunks)
      allAudioFiles.push(...chunkFiles);
      
      console.log(`Downloaded ${chunkFiles.length} new chunks, total estimated new duration: ${totalDuration}s`);
      console.log(`Total files to combine: ${allAudioFiles.length}`);

      // Combine audio files using fluent-ffmpeg
      const outputPath = path.join(tempDir, 'combined-book.mp3');
      
      console.log('Combining audio files with fluent-ffmpeg...');
      
      await new Promise<void>((resolve, reject) => {
        let command = ffmpeg();
        
        // Add all audio files as inputs (existing first, then new chunks)
        allAudioFiles.forEach(file => {
          command = command.input(file);
        });
        
        // Configure output
        command
          .outputOptions([
            '-filter_complex', 
            `concat=n=${allAudioFiles.length}:v=0:a=1[out]`,
            '-map', '[out]'
          ])
          .audioCodec('mp3')
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            console.log(`Processing: ${progress.percent}% done`);
          })
          .on('end', () => {
            console.log('Audio combination completed');
            resolve();
          })
          .on('error', (err) => {
            console.error('FFmpeg error:', err);
            reject(new Error(`Failed to combine audio chunks: ${err.message}`));
          })
          .run();
      });

      // Verify the output file was created
      if (!existsSync(outputPath)) {
        throw new Error('Combined audio file was not created');
      }

      // Read the combined file
      const combinedAudioBuffer = await readFile(outputPath);
      console.log(`Combined audio file size: ${combinedAudioBuffer.length} bytes`);

      if (combinedAudioBuffer.length === 0) {
        throw new Error('Combined audio file is empty');
      }

      // Upload the combined audio to Supabase Storage
      const fileName = 'complete-book.mp3';
      
      console.log('Uploading combined audio to Supabase Storage...');
      
      const uploadResult = await uploadAudio(
        combinedAudioBuffer,
        payload.userId,
        payload.bookId,
        fileName
      );

      if (!uploadResult.success) {
        throw new Error(`Failed to upload combined audio: ${uploadResult.error}`);
      }

      console.log(`Successfully combined and uploaded book audio: ${uploadResult.publicUrl}`);

      // Clean up individual chunk files from Supabase Storage (only new chunks, not existing audio)
      console.log('Cleaning up new audio chunks from storage...');
      
      const chunkPaths = sortedChunks.map(chunk => {
        // Extract the file path from the chunk URL
        // URL format: https://project.supabase.co/storage/v1/object/public/book-audio/userId/bookId/chunk-001.mp3
        const urlParts = chunk.audioUrl.split('/');
        const fileName = urlParts[urlParts.length - 1]; // chunk-001.mp3
        return `${payload.userId}/${payload.bookId}/${fileName}`;
      });

      // Delete new chunks in parallel (don't delete existing audio)
      const deletePromises = chunkPaths.map(async (chunkPath) => {
        try {
          const { error } = await supabase.storage
            .from('book-audio')
            .remove([chunkPath]);
          
          if (error) {
            console.warn(`Failed to delete chunk ${chunkPath}:`, error.message);
          } else {
            console.log(`Deleted chunk: ${chunkPath}`);
          }
        } catch (error) {
          console.warn(`Error deleting chunk ${chunkPath}:`, error);
        }
      });

      await Promise.allSettled(deletePromises);
      
      // Also delete the old complete book file if this is an append operation
      if (payload.isAppending && payload.existingAudioUrl) {
        try {
          const urlParts = payload.existingAudioUrl.split('/');
          const bucketIndex = urlParts.findIndex(part => part === 'book-audio');
          if (bucketIndex !== -1) {
            const pathParts = urlParts.slice(bucketIndex + 1);
            const oldAudioPath = pathParts.join('/');
            
            const { error } = await supabase.storage
              .from('book-audio')
              .remove([oldAudioPath]);
            
            if (error) {
              console.warn(`Failed to delete old audio file ${oldAudioPath}:`, error.message);
            } else {
              console.log(`Deleted old audio file: ${oldAudioPath}`);
            }
          }
        } catch (error) {
          console.warn('Error deleting old audio file:', error);
        }
      }
      
      console.log('Chunk cleanup completed');

      return {
        success: true,
        finalAudioUrl: uploadResult.publicUrl,
        finalAudioPath: uploadResult.path,
        totalDuration: Math.round(totalDuration),
        deletedChunks: chunkPaths.length
      };

    } catch (error) {
      console.error('Error in combine book audio:', error);
      
      let errorMessage = 'Unknown error occurred during audio combination';
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Handle specific error types
        if (errorMessage.includes('ffmpeg')) {
          errorMessage = 'Audio combination failed - FFmpeg processing error';
        } else if (errorMessage.includes('download')) {
          errorMessage = 'Failed to download audio chunks from storage';
        } else if (errorMessage.includes('upload')) {
          errorMessage = 'Failed to upload combined audio file';
        }
      }

      return {
        success: false,
        error: errorMessage
      };

    } finally {
      // Clean up temporary files
      try {
        console.log('Cleaning up temporary files...');
        
        // Remove all temporary files
        if (existsSync(tempDir)) {
          const { rmdir } = await import('fs/promises');
          await rmdir(tempDir, { recursive: true });
        }
        
        console.log('Cleanup completed');
      } catch (cleanupError) {
        console.warn('Failed to clean up temporary files:', cleanupError);
        // Don't fail the task due to cleanup issues
      }
    }
  }
});
