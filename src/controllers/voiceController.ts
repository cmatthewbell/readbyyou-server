import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { createVoiceClone } from '../trigger/create-voice-clone';
import { tasks } from '@trigger.dev/sdk/v3';

const prisma = new PrismaClient();

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
 * Add a new voice for the authenticated user
 * POST /voices/create
 * FormData: { voice_name: string, audio: File } - Single audio file (10-second recording from iPhone or uploaded MP3)
 */
export const createVoice = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { voice_name } = req.body;
  const audioFiles = req.files;

  // Validate inputs
  if (!voice_name || typeof voice_name !== 'string' || voice_name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Voice name is required'
    });
  }

  if (!audioFiles || !Array.isArray(audioFiles) || audioFiles.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Audio file is required'
    });
  }

  if (audioFiles.length > 1) {
    return res.status(400).json({
      success: false,
      message: 'Only one audio file allowed for voice cloning'
    });
  }

  const audioFile = audioFiles[0];

  // Validate voice name uniqueness for this user
  const existingVoice = await prisma.userVoice.findFirst({
    where: {
      user_id: userId,
      voice_name: voice_name.trim()
    }
  });

  if (existingVoice) {
    return res.status(400).json({
      success: false,
      message: 'A voice with this name already exists. Please choose a different name.'
    });
  }

  // Get user profile for first name
  const userProfile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  console.log(`Creating new voice "${voice_name.trim()}" for user ${userId}`);

  try {
    // Use trigger task to create voice clone
    console.log('Starting voice clone creation task...');
    const voiceCloneResult = await tasks.triggerAndWait<typeof createVoiceClone>(
      'create-voice-clone',
      {
        audioBuffer: audioFile.buffer,
        originalFilename: audioFile.originalname,
        voiceName: voice_name.trim(),
        userId,
        userFirstName: userProfile?.first_name || undefined
      }
    );

    if (!voiceCloneResult.ok) {
      console.error('Voice clone task failed:', voiceCloneResult.error);
      return res.status(500).json({
        success: false,
        message: 'Voice cloning task failed',
        error: voiceCloneResult.error
      });
    }

    if (!voiceCloneResult.output.success) {
      console.error('Voice clone creation failed:', voiceCloneResult.output.error);
      return res.status(500).json({
        success: false,
        message: 'Voice cloning failed',
        error: voiceCloneResult.output.error
      });
    }

    console.log('Voice clone created successfully');

    // Check if user has any existing voices (for default setting)
    const existingVoicesCount = await prisma.userVoice.count({
      where: { user_id: userId }
    });

    // Create voice record in database
    const voice = await prisma.userVoice.create({
      data: {
        user_id: userId,
        voice_name: voiceCloneResult.output.voiceName!,
        audio_file_url: null, // No longer storing the file
        elevenlabs_voice_id: voiceCloneResult.output.elevenlabsVoiceId!,
        is_default: existingVoicesCount === 0 // First voice becomes default
      }
    });

    console.log(`Voice created successfully: ${voice.id}`);

    return res.status(201).json({
      success: true,
      message: 'Voice created successfully',
      voice: {
        id: voice.id,
        voice_name: voice.voice_name,
        elevenlabs_voice_id: voice.elevenlabs_voice_id,
        is_default: voice.is_default,
        created_at: voice.created_at
      }
    });

  } catch (error) {
    console.error('Error creating voice:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to create voice',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get all voices for the authenticated user with cursor pagination
 * GET /voices?cursor=voice-id&limit=10
 */
export const getUserVoices = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { cursor, limit = '10' } = req.query;
  
  // Parse and validate limit
  const pageSize = Math.min(Math.max(parseInt(limit as string) || 10, 1), 50); // Min 1, Max 50

  try {
    // Build where clause for cursor pagination
    const where: any = {
      user_id: userId
    };
    
    // If cursor is provided, get voices created after this cursor
    if (cursor && typeof cursor === 'string') {
      where.created_at = {
        gt: await getVoiceCursorDate(cursor)
      };
    }
    
    // Fetch voices with pagination
    const voices = await prisma.userVoice.findMany({
      where,
      orderBy: [
        { is_default: 'desc' }, // Default voice first
        { created_at: 'asc' }   // Then by creation date
      ],
      take: pageSize + 1, // Take one extra to determine if there's a next page
      select: {
        id: true,
        voice_name: true,
        elevenlabs_voice_id: true,
        is_default: true,
        created_at: true,
        updated_at: true
      }
    });
    
    // Check if there are more voices (hasNextPage)
    const hasNextPage = voices.length > pageSize;
    const voicesToReturn = hasNextPage ? voices.slice(0, pageSize) : voices;
    
    // Get next cursor (ID of the last voice)
    const nextCursor = hasNextPage && voicesToReturn.length > 0 
      ? voicesToReturn[voicesToReturn.length - 1].id 
      : null;

    return res.status(200).json({
      success: true,
      voices: voicesToReturn,
      pagination: {
        hasNextPage,
        nextCursor,
        limit: pageSize
      }
    });

  } catch (error) {
    console.error('Error fetching user voices:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch voices',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Helper function to get the created_at date from a cursor (voice ID)
 */
async function getVoiceCursorDate(cursor: string): Promise<Date> {
  const voice = await prisma.userVoice.findUnique({
    where: { id: cursor },
    select: { created_at: true }
  });
  
  if (!voice) {
    throw new Error('Invalid cursor provided');
  }
  
  return voice.created_at;
}

/**
 * Set a voice as default for the user
 * PATCH /voices/:id/set-default
 */
export const setDefaultVoice = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Voice ID is required'
    });
  }

  try {
    // Check if voice exists and belongs to user
    const voice = await prisma.userVoice.findFirst({
      where: {
        id: id,
        user_id: userId
      }
    });

    if (!voice) {
      return res.status(404).json({
        success: false,
        message: 'Voice not found'
      });
    }

    // Update all user's voices to not be default
    await prisma.userVoice.updateMany({
      where: { user_id: userId },
      data: { is_default: false }
    });

    // Set the selected voice as default
    const updatedVoice = await prisma.userVoice.update({
      where: { id: id },
      data: { is_default: true }
    });

    console.log(`Set voice ${id} as default for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Default voice updated successfully',
      voice: {
        id: updatedVoice.id,
        voice_name: updatedVoice.voice_name,
        elevenlabs_voice_id: updatedVoice.elevenlabs_voice_id,
        is_default: updatedVoice.is_default
      }
    });

  } catch (error) {
    console.error('Error setting default voice:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to set default voice',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Delete a voice (cannot delete default voice if it's the only one)
 * DELETE /voices/:id
 */
export const deleteVoice = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user.id;
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Voice ID is required'
    });
  }

  try {
    // Check if voice exists and belongs to user
    const voice = await prisma.userVoice.findFirst({
      where: {
        id: id,
        user_id: userId
      }
    });

    if (!voice) {
      return res.status(404).json({
        success: false,
        message: 'Voice not found'
      });
    }

    // Check if this is the only voice for the user
    const voiceCount = await prisma.userVoice.count({
      where: { user_id: userId }
    });

    if (voiceCount === 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your only voice. Please create another voice first.'
      });
    }

    // If deleting the default voice, set another voice as default
    if (voice.is_default) {
      const otherVoice = await prisma.userVoice.findFirst({
        where: {
          user_id: userId,
          id: { not: id }
        },
        orderBy: { created_at: 'asc' }
      });

      if (otherVoice) {
        await prisma.userVoice.update({
          where: { id: otherVoice.id },
          data: { is_default: true }
        });
        console.log(`Set voice ${otherVoice.id} as new default after deleting ${id}`);
      }
    }

    // Delete the voice
    await prisma.userVoice.delete({
      where: { id: id }
    });

    console.log(`Deleted voice ${id} for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Voice deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting voice:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete voice',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}); 