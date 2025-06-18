import { task } from '@trigger.dev/sdk/v3';
import { client as elevenlabs } from '../config/elevenlabs';
import { uploadAudio } from '../utils/supabaseStorage';
import { supabase } from '../config/supabase';

interface Payload {
  audioBuffer: Buffer;
  originalFilename: string;
  voiceName: string;
  userId: string;
  userFirstName?: string;
}

interface VoiceCloneResult {
  success: boolean;
  elevenlabsVoiceId?: string;
  voiceName?: string;
  error?: string;
}

export const createVoiceClone = task({
  id: 'create-voice-clone',
  maxDuration: 600, // 10 minutes for voice cloning
  onFailure: async (_payload: Payload, error: unknown) => {
    console.error('Failed to create voice clone', error);
  },
  run: async (payload: Payload): Promise<VoiceCloneResult> => {
    console.log(`Creating voice clone "${payload.voiceName}" for user ${payload.userId}`);

    try {
      // Upload audio file to Supabase Storage temporarily
      console.log('Uploading audio file to storage...');
      const uploadResult = await uploadAudio(
        payload.audioBuffer,
        payload.userId,
        'temp-voice', // Temporary folder for voice files
        `voice-${Date.now()}.${payload.originalFilename.split('.').pop()}`
      );

      if (!uploadResult.success) {
        throw new Error(`Failed to upload audio file: ${uploadResult.error}`);
      }

      const audioUrl = uploadResult.publicUrl!;
      console.log('Audio file uploaded successfully');

      // Create voice clone with ElevenLabs Instant Voice Cloning API
      console.log('Creating voice clone in ElevenLabs...');
      const response = await fetch(audioUrl);
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const audioBlob = new Blob([audioBuffer]);
      
      const voiceClone = await elevenlabs.voices.ivc.create({
        name: payload.voiceName.trim(),
        files: [audioBlob as File], // Convert to File-like object
        description: `Voice clone for ${payload.userFirstName || 'user'}`
      });

      console.log(`Voice clone created successfully: ${voiceClone.voiceId}`);

      // Delete the temporary audio file from storage
      try {
        const { error: deleteError } = await supabase.storage
          .from('book-audio')
          .remove([uploadResult.path!]);
        
        if (deleteError) {
          console.warn('Failed to delete temporary voice file:', deleteError);
        } else {
          console.log('Temporary voice file deleted successfully');
        }
      } catch (deleteError) {
        console.warn('Error deleting temporary voice file:', deleteError);
        // Don't fail the task if cleanup fails
      }

      return {
        success: true,
        elevenlabsVoiceId: voiceClone.voiceId,
        voiceName: payload.voiceName.trim()
      };

    } catch (error) {
      console.error('Error in voice clone creation:', error);
      
      // Handle specific ElevenLabs API errors
      let errorMessage = 'Unknown error occurred during voice cloning';
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Check for common ElevenLabs API errors
        if (errorMessage.includes('quota')) {
          errorMessage = 'ElevenLabs API quota exceeded';
        } else if (errorMessage.includes('rate limit')) {
          errorMessage = 'Rate limit exceeded, please try again later';
        } else if (errorMessage.includes('voice_id')) {
          errorMessage = 'Invalid voice configuration';
        } else if (errorMessage.includes('upload')) {
          errorMessage = 'Failed to upload audio file to storage';
        }
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }
}); 