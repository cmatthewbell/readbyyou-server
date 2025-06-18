import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

export const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
}); 