import { Request, Response } from 'express';
import { PrismaClient, OnboardingStep, AgeGroup, ReadingTime, ReferralSource, BookCategory } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const prisma = new PrismaClient();

// Initialize ElevenLabs client
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Helper function to validate onboarding step progression
const validateStepProgression = (currentStep: OnboardingStep, requiredStep: OnboardingStep): boolean => {
  const stepOrder = [
    OnboardingStep.AGE,
    OnboardingStep.NAME,
    OnboardingStep.CATEGORIES,
    OnboardingStep.READING_TIME,
    OnboardingStep.VOICE,
    OnboardingStep.VOICE_DEMO,
    OnboardingStep.PREMIUM_TRIAL,
    OnboardingStep.REFERRAL,
    OnboardingStep.COMPLETED
  ];
  
  const currentIndex = stepOrder.indexOf(currentStep);
  const requiredIndex = stepOrder.indexOf(requiredStep);
  
  return currentIndex === requiredIndex;
};

// GET /auth/onboarding/status - Get current onboarding status
export const getOnboardingStatus = asyncHandler(async (req: Request, res: Response) => {
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

// POST /auth/onboarding/age-group - Submit age group selection
export const updateAgeGroup = asyncHandler(async (req: Request, res: Response) => {
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
export const updateName = asyncHandler(async (req: Request, res: Response) => {
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
export const updateBookCategories = asyncHandler(async (req: Request, res: Response) => {
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
export const updateReadingTime = asyncHandler(async (req: Request, res: Response) => {
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
      onboarding_step: OnboardingStep.VOICE
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

// POST /auth/onboarding/voice - Submit voice recording/upload for cloning
export const updateVoice = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }
  
  const { voice_name, audio_file_url } = req.body;

  if (!voice_name || typeof voice_name !== 'string' || voice_name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Voice name is required'
    });
  }

  if (!audio_file_url || typeof audio_file_url !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Audio file URL is required'
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

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.VOICE)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid onboarding step progression'
    });
  }

  try {
    // Create voice clone with ElevenLabs Instant Voice Cloning API
    // Note: audio_file_url should be converted to a readable stream for the API
    const response = await fetch(audio_file_url);
    const audioBuffer = await response.arrayBuffer();
    const audioBlob = new Blob([audioBuffer]);
    
    const voiceClone = await elevenlabs.voices.ivc.create({
      name: voice_name.trim(),
      files: [audioBlob as File], // Convert to File-like object
      description: `Voice clone for ${profile.first_name || 'user'}`
    });

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
        voice_name: voice_name.trim(),
        audio_file_url,
        elevenlabs_voice_id: voiceClone.voiceId,
        is_default: !existingDefaultVoice // First voice becomes default
      }
    });

    // Update onboarding step
    await prisma.userProfile.update({
      where: { user_id: userId },
      data: {
        onboarding_step: OnboardingStep.VOICE_DEMO
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Voice created and cloned successfully with ElevenLabs',
      data: {
        currentStep: OnboardingStep.VOICE_DEMO,
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
        audio_file_url,
        elevenlabs_voice_id: `placeholder_${Date.now()}`, // Placeholder ID
        is_default: true
      }
    });

    // Update onboarding step even if voice cloning failed
    await prisma.userProfile.update({
      where: { user_id: userId },
      data: {
        onboarding_step: OnboardingStep.VOICE_DEMO
      }
    });

    return res.status(207).json({
      success: true,
      message: 'Voice saved but cloning failed. Please try again later.',
      data: {
        currentStep: OnboardingStep.VOICE_DEMO,
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

// POST /auth/onboarding/voice-demo - Mark voice demo as completed
export const completeVoiceDemo = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'User profile not found'
    });
  }

  if (!validateStepProgression(profile.onboarding_step, OnboardingStep.VOICE_DEMO)) {
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
    message: 'Voice demo completed',
    data: {
      currentStep: updatedProfile.onboarding_step
    }
  });
});

// POST /auth/onboarding/premium-trial - Handle premium trial signup
export const handlePremiumTrial = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { trial_started } = req.body; // Optional - frontend can indicate if trial was started

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

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      onboarding_step: OnboardingStep.REFERRAL
    }
  });

  return res.status(200).json({
    success: true,
    message: 'Premium trial step completed',
    data: {
      currentStep: updatedProfile.onboarding_step,
      trial_started: trial_started || false
    }
  });
});

// POST /auth/onboarding/referral-source - Submit referral source and complete onboarding
export const completeOnboarding = asyncHandler(async (req: Request, res: Response) => {
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