import { task } from '@trigger.dev/sdk/v3';
import { client as elevenlabs } from '../config/elevenlabs';
import { uploadAudio } from '../utils/supabaseStorage';

interface Payload {
  text: string;
  voiceId: string;
  userId: string;
  bookId: string;
  chunkIndex: number; // For identifying which chunk this is (0, 1, 2, etc.)
}

interface TTSResult {
  success: boolean;
  audioUrl?: string;
  audioPath?: string;
  chunkIndex: number;
  duration?: number; // Audio duration in seconds
  error?: string;
}

export const textToSpeech = task({
  id: 'text-to-speech',
  maxDuration: 1800, // 30 minutes for longer text chunks
  onFailure: async (_payload: Payload, error: unknown) => {
    console.error('Failed to convert text to speech', error);
  },
  run: async (payload: Payload): Promise<TTSResult> => {
    console.log(`Converting text to speech for chunk ${payload.chunkIndex}, user: ${payload.userId}`);

    try {
      // Validate inputs
      if (!payload.text || payload.text.trim().length === 0) {
        return {
          success: false,
          chunkIndex: payload.chunkIndex,
          error: 'Text is required and cannot be empty'
        };
      }

      if (!payload.voiceId) {
        return {
          success: false,
          chunkIndex: payload.chunkIndex,
          error: 'Voice ID is required'
        };
      }

      console.log(`Processing ${payload.text.length} characters with voice ID: ${payload.voiceId}`);

      // Generate audio with ElevenLabs
      const audioResponse = await elevenlabs.textToSpeech.convert(
        payload.voiceId,
        {
          text: payload.text,
          modelId: "eleven_multilingual_v2", // Good quality, supports multiple languages
          voiceSettings: {
            stability: 0.5,
            similarityBoost: 0.8,
            style: 0.2,
            useSpeakerBoost: true
          },
          outputFormat: "mp3_44100_128" // Good quality MP3
        }
      );

      // Convert response to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of audioResponse) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);
      
      if (audioBuffer.length === 0) {
        throw new Error('Received empty audio buffer from ElevenLabs');
      }

      console.log(`Generated audio: ${audioBuffer.length} bytes`);

      // Create filename for this chunk
      const fileName = `chunk-${payload.chunkIndex.toString().padStart(3, '0')}.mp3`;

      // Upload to Supabase Storage
      const uploadResult = await uploadAudio(
        audioBuffer,
        payload.userId,
        payload.bookId,
        fileName
      );

      if (!uploadResult.success) {
        return {
          success: false,
          chunkIndex: payload.chunkIndex,
          error: `Failed to upload audio: ${uploadResult.error}`
        };
      }

      // Estimate duration (rough calculation: ~150 words per minute, ~5 chars per word)
      const estimatedWords = payload.text.length / 5;
      const estimatedDuration = (estimatedWords / 150) * 60; // Convert to seconds

      console.log(`Successfully generated and uploaded audio chunk ${payload.chunkIndex}`);

      return {
        success: true,
        audioUrl: uploadResult.publicUrl,
        audioPath: uploadResult.path,
        chunkIndex: payload.chunkIndex,
        duration: Math.round(estimatedDuration)
      };

    } catch (error) {
      console.error('Error in text-to-speech conversion:', error);
      
      // Handle specific ElevenLabs errors
      let errorMessage = 'Unknown error occurred during text-to-speech conversion';
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Check for common ElevenLabs API errors
        if (errorMessage.includes('voice_id')) {
          errorMessage = 'Invalid voice ID provided';
        } else if (errorMessage.includes('quota')) {
          errorMessage = 'ElevenLabs API quota exceeded';
        } else if (errorMessage.includes('rate limit')) {
          errorMessage = 'Rate limit exceeded, please try again later';
        }
      }

      return {
        success: false,
        chunkIndex: payload.chunkIndex,
        error: errorMessage
      };
    }
  }
});
