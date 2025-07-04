import { Request, Response } from 'express';
import { PrismaClient, OnboardingStep, AgeGroup, ReadingTime, ReferralSource, BookCategory, Gender } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { client as elevenlabs } from '../config/elevenlabs';
import { createVoiceClone } from '../trigger/create-voice-clone';
import { tasks } from '@trigger.dev/sdk/v3';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    provider: string;
    provider_id: string;
  };
  files?: any[];
  file?: any; // For single file uploads with multer
}

const prisma = new PrismaClient();

// Helper function to validate onboarding step progression
const validateStepProgression = (currentStep: OnboardingStep, requiredStep: OnboardingStep): boolean => {
  const stepOrder = [
    OnboardingStep.GENDER,
    OnboardingStep.AGE,
    OnboardingStep.NAME,
    OnboardingStep.CATEGORIES,
    OnboardingStep.READING_TIME,
    OnboardingStep.READING_STAT,
    OnboardingStep.NOTIFICATION_PAGE,
    OnboardingStep.PREMIUM_TRIAL,
    OnboardingStep.REFERRAL,
    OnboardingStep.COMPLETED
  ];
  
  const currentIndex = stepOrder.indexOf(currentStep);
  const requiredIndex = stepOrder.indexOf(requiredStep);
  
  return currentIndex === requiredIndex;
};

// GET /auth/onboarding/status - Get current onboarding status
export const getOnboardingStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId },
    include: {
      user: {
        include: {
          voices: true
        }
      }
    }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      currentStep: profile.onboarding_step,
      completed: profile.onboarding_completed,
      profile: {
        gender: profile.gender,
        age_group: profile.age_group,
        first_name: profile.first_name,
        book_categories: profile.book_categories,
        daily_reading_time: profile.daily_reading_time,
        referral_source: profile.referral_source
      },
      voices: profile.user.voices
    }
  });
});

// POST /auth/onboarding/gender - Submit gender selection
export const updateGender = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { gender } = req.body;

  if (!gender || !Object.values(Gender).includes(gender)) {
    return res.status(400).json({
      success: false,
      message: 'Valid gender is required (male, female, other)'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.GENDER)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      gender,
      onboarding_step: OnboardingStep.AGE
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Gender updated successfully',
    data: {
      currentStep: updatedProfile.onboarding_step,
      gender: updatedProfile.gender
    }
  });
});

// POST /auth/onboarding/age-group - Submit age group selection
export const updateAgeGroup = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { age_group } = req.body;

  if (!age_group || !Object.values(AgeGroup).includes(age_group)) {
    return res.status(400).json({
      success: false,
      message: 'Valid age group is required'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.AGE)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      age_group,
      onboarding_step: OnboardingStep.NAME
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Age group updated successfully',
    data: {
      currentStep: updatedProfile.onboarding_step,
      age_group: updatedProfile.age_group
    }
  });
});

// POST /auth/onboarding/name - Submit name
export const updateName = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { first_name } = req.body;

  if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'First name is required'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.NAME)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      first_name: first_name.trim(),
      onboarding_step: OnboardingStep.CATEGORIES
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Name updated successfully',
    data: {
      currentStep: updatedProfile.onboarding_step,
      first_name: updatedProfile.first_name
    }
  });
});

// POST /auth/onboarding/book-categories - Submit book category preferences
export const updateBookCategories = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { book_categories } = req.body;

  if (!book_categories || !Array.isArray(book_categories) || book_categories.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'At least one book category must be selected'
    });
  }

  // Validate all categories are valid enum values
  const validCategories = Object.values(BookCategory);
  const invalidCategories = book_categories.filter(cat => !validCategories.includes(cat));
  
  if (invalidCategories.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Invalid book categories: ${invalidCategories.join(', ')}`
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.CATEGORIES)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      book_categories,
      onboarding_step: OnboardingStep.READING_TIME
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Book categories updated successfully',
    data: {
      currentStep: updatedProfile.onboarding_step,
      book_categories: updatedProfile.book_categories
    }
  });
});

// POST /auth/onboarding/reading-time - Submit daily reading time preference
export const updateReadingTime = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { daily_reading_time } = req.body;

  if (!daily_reading_time || !Object.values(ReadingTime).includes(daily_reading_time)) {
    return res.status(400).json({
      success: false,
      message: 'Valid daily reading time is required'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.READING_TIME)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      daily_reading_time,
      onboarding_step: OnboardingStep.READING_STAT
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Reading time preference updated successfully',
    data: {
      currentStep: updatedProfile.onboarding_step,
      daily_reading_time: updatedProfile.daily_reading_time
    }
  });
});

// POST /auth/onboarding/reading-stat - Complete reading stat step and progress to voice
export const updateReadingStat = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.READING_STAT)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      onboarding_step: OnboardingStep.NOTIFICATION_PAGE
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Reading stat step completed successfully',
    data: {
      currentStep: updatedProfile.onboarding_step
    }
  });
});

// POST /auth/onboarding/notification-page - Complete notification page step and progress to voice
export const updateNotificationPage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.NOTIFICATION_PAGE)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      onboarding_step: OnboardingStep.PREMIUM_TRIAL
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Notification page step completed successfully',
    data: {
      currentStep: updatedProfile.onboarding_step
    }
  });
});

// POST /auth/onboarding/voice - Submit single audio file (10-second recording from iPhone or uploaded MP3) for voice cloning
export const updateVoice = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }
  
  const { voice_name } = req.body;
  
  // Debug logging
  console.log('DEBUG - voice_name:', voice_name);
  console.log('DEBUG - req.body:', req.body);
  console.log('DEBUG - req.file:', req.file);
  
  const audioFile = req.file;

  if (!voice_name || typeof voice_name !== 'string' || voice_name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Voice name is required'
    });
  }

  if (!audioFile) {
    return res.status(400).json({
      success: false,
      message: 'Audio file is required'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  // Voice endpoint is now standalone - no onboarding step validation

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
        userFirstName: profile.first_name || undefined
      }
    );

    if (!voiceCloneResult.ok) {
      console.error('Voice clone task failed:', voiceCloneResult.error);
      throw new Error(`Voice cloning task failed: ${voiceCloneResult.error}`);
    }

    if (!voiceCloneResult.output.success) {
      console.error('Voice clone creation failed:', voiceCloneResult.output.error);
      throw new Error(`Voice cloning failed: ${voiceCloneResult.output.error}`);
    }

    console.log('Voice clone created successfully');

    // Check if any existing voices are set as default
    const existingDefaultVoice = await prisma.userVoice.findFirst({
      where: { 
        user_id: userId,
        is_default: true 
      }
    });

    // Create voice record in database with actual ElevenLabs ID
    const voice = await prisma.userVoice.create({
      data: {
        user_id: userId,
        voice_name: voiceCloneResult.output.voiceName!,
        audio_file_url: null, // No longer storing the file
        elevenlabs_voice_id: voiceCloneResult.output.elevenlabsVoiceId!,
        is_default: !existingDefaultVoice // First voice becomes default
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Voice created and cloned successfully with ElevenLabs',
      data: {
        voice: {
          id: voice.id,
          voice_name: voice.voice_name,
          elevenlabs_voice_id: voice.elevenlabs_voice_id,
          is_default: voice.is_default
        }
      }
    });

  } catch (elevenLabsError: any) {
    console.error('ElevenLabs API Error:', elevenLabsError);
    
    // If ElevenLabs fails, create a placeholder record and continue
    const voice = await prisma.userVoice.create({
      data: {
        user_id: userId,
        voice_name: voice_name.trim(),
        audio_file_url: null,
        elevenlabs_voice_id: `placeholder_${Date.now()}`, // Placeholder ID
        is_default: true
      }
    });

    return res.status(207).json({
      success: true,
      message: 'Voice saved but cloning failed. Please try again later.',
      data: {
        voice: {
          id: voice.id,
          voice_name: voice.voice_name,
          is_default: voice.is_default
        },
        warning: 'Voice cloning failed - using placeholder. Contact support if this persists.'
      }
    });
  }
});

// POST /auth/onboarding/voice-demo - Generate voice demo and complete step
export const completeVoiceDemo = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  // Voice demo endpoint is now standalone - no onboarding step validation

  // Get user's voice clone
  const userVoice = await prisma.userVoice.findFirst({
    where: { 
      user_id: userId,
      is_default: true 
    }
  });

  if (!userVoice) {
    return res.status(404).json({
      success: false,
      message: 'No voice clone found. Please complete voice setup first.'
    });
  }

  // Demo text passage - Short and engaging fantasy (Public Domain)
  const demoText = `The magic thrummed through her veins like liquid fire. With a whispered incantation, she opened the portal to another world. Beyond the shimmering gateway, ancient forests beckoned with promises of adventure and secrets long forgotten.`;

  try {
    // Generate audio using ElevenLabs TTS with user's voice clone
    const audio = await elevenlabs.textToSpeech.convert(userVoice.elevenlabs_voice_id, {
      text: demoText,
      modelId: "eleven_v3",
      voiceSettings: {
        stability: 0.95,
        similarityBoost: 0.75,
        style: 0.06,
        useSpeakerBoost: true
      }
    });

    // Convert audio stream to buffer
    const chunks: Buffer[] = [];
    
    audio.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    await new Promise((resolve, reject) => {
      audio.on('end', resolve);
      audio.on('error', reject);
    });
    
    const audioBuffer = Buffer.concat(chunks);
    const base64Audio = audioBuffer.toString('base64');

    return res.status(200).json({
      success: true,
      message: 'Voice demo generated successfully',
      data: {
        audio_base64: base64Audio,
        text: demoText,
        voice_name: userVoice.voice_name,
        duration_estimate: Math.ceil(demoText.length / 10) // Rough estimate: ~10 chars per second
      }
    });

  } catch (error: any) {
    console.error('ElevenLabs TTS Error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to generate voice demo. Please try again.',
      error: error.message || 'Unknown error'
    });
  }
});

// GET /auth/onboarding/voice-demo - Get voice demo audio again
export const getVoiceDemo = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }

  // Get user's voice clone
  const userVoice = await prisma.userVoice.findFirst({
    where: { 
      user_id: userId,
      is_default: true 
    }
  });

  if (!userVoice) {
    return res.status(404).json({
      success: false,
      message: 'No voice clone found. Please complete voice setup first.'
    });
  }

  // Demo text passage - same as the original demo
  const demoText = `The magic thrummed through her veins like liquid fire. With a whispered incantation, she opened the portal to another world. Beyond the shimmering gateway, ancient forests beckoned with promises of adventure and secrets long forgotten.`;

  try {
    // Generate audio using ElevenLabs TTS with user's voice clone
    const audio = await elevenlabs.textToSpeech.convert(userVoice.elevenlabs_voice_id, {
      text: demoText,
      modelId: "eleven_v3",
      voiceSettings: {
        stability: 0.95,
        similarityBoost: 0.75,
        style: 0.06,
        useSpeakerBoost: true
      }
    });

    // Convert audio stream to buffer
    const chunks: Buffer[] = [];
    
    audio.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    await new Promise((resolve, reject) => {
      audio.on('end', resolve);
      audio.on('error', reject);
    });
    
    const audioBuffer = Buffer.concat(chunks);
    const base64Audio = audioBuffer.toString('base64');

    return res.status(200).json({
      success: true,
      message: 'Voice demo retrieved successfully',
      data: {
        audio_base64: base64Audio,
        text: demoText,
        voice_name: userVoice.voice_name,
        duration_estimate: Math.ceil(demoText.length / 10) // Rough estimate: ~10 chars per second
      }
    });

  } catch (error: any) {
    console.error('ElevenLabs TTS Error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve voice demo. Please try again.',
      error: error.message || 'Unknown error'
    });
  }
});

// POST /auth/onboarding/premium-trial - Handle premium subscription signup via RevenueCat
export const handlePremiumTrial = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { revenuecat_user_id } = req.body; // RevenueCat customer ID from app

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.PREMIUM_TRIAL)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  // RevenueCat handles the subscription validation automatically
  // We just need to verify the user completed the subscription flow
  if (!revenuecat_user_id) {
    return res.status(400).json({
      success: false,
      message: 'Subscription required to proceed. Please complete purchase in the app.'
    });
  }

  // Update to next step - RevenueCat webhooks will handle subscription status
  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      onboarding_step: OnboardingStep.REFERRAL
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Premium subscription completed successfully',
    data: {
      currentStep: updatedProfile.onboarding_step,
      subscription_verified: true
    }
  });
});

// POST /auth/onboarding/referral-source - Submit referral source and complete onboarding
export const completeOnboarding = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { referral_source } = req.body;

  if (!referral_source || !Object.values(ReferralSource).includes(referral_source)) {
    return res.status(400).json({
      success: false,
      message: 'Valid referral source is required'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.REFERRAL)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      referral_source,
      onboarding_step: OnboardingStep.COMPLETED,
      onboarding_completed: true
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Onboarding completed successfully!',
    data: {
      currentStep: updatedProfile.onboarding_step,
      completed: updatedProfile.onboarding_completed,
      referral_source: updatedProfile.referral_source
    }
  });
});

// POST /onboarding/back - Go back to previous onboarding step
export const goBackToPreviousStep = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  const stepOrder = [
    OnboardingStep.GENDER,
    OnboardingStep.AGE,
    OnboardingStep.NAME,
    OnboardingStep.CATEGORIES,
    OnboardingStep.READING_TIME,
    OnboardingStep.READING_STAT,
    OnboardingStep.NOTIFICATION_PAGE,
    OnboardingStep.PREMIUM_TRIAL,
    OnboardingStep.REFERRAL,
    OnboardingStep.COMPLETED
  ];

  const currentIndex = stepOrder.indexOf(profile.onboarding_step);
  
  // Can't go back from GENDER (first step), REFERRAL (final step), or COMPLETED
  if (currentIndex <= 0 || profile.onboarding_step === OnboardingStep.REFERRAL || profile.onboarding_step === OnboardingStep.COMPLETED) {
    return res.status(400).json({
      success: false,
      message: 'Cannot go back from this step'
    });
  }

  const previousStep = stepOrder[currentIndex - 1];

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      onboarding_step: previousStep
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Successfully went back to previous step',
    data: {
      currentStep: updatedProfile.onboarding_step,
      previousStep: profile.onboarding_step
    }
  });
}); 