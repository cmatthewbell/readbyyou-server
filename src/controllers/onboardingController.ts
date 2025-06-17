import { Request, Response } from 'express';
import { PrismaClient, OnboardingStep, AgeGroup, ReadingTime, ReferralSource, BookCategory } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';

const prisma = new PrismaClient();

// Helper function to validate onboarding step progression
const validateStepProgression = (currentStep: OnboardingStep, requiredStep: OnboardingStep): boolean => {
  const stepOrder = [
    OnboardingStep.GENDER,
    OnboardingStep.AGE,
    OnboardingStep.NAME,
    OnboardingStep.CATEGORIES,
    OnboardingStep.PREFERENCES,
    OnboardingStep.COMPLETED
  ];
  
  const currentIndex = stepOrder.indexOf(currentStep);
  const requiredIndex = stepOrder.indexOf(requiredStep);
  
  return currentIndex === requiredIndex;
};

// GET /auth/onboarding/status - Get current onboarding status
export const getOnboardingStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const userProfile = await prisma.userProfile.findUnique({
    where: { user_id: userId },
    select: {
      onboarding_step: true,
      onboarding_completed: true,
      gender: true,
      age_group: true,
      first_name: true,
      book_categories: true,
      daily_reading_time: true,
      referral_source: true
    }
  });

  if (!userProfile) {
    res.status(404).json({ error: 'User profile not found' });
    return;
  }

  res.json({
    current_step: userProfile.onboarding_step,
    completed: userProfile.onboarding_completed,
    profile_data: {
      gender: userProfile.gender,
      age_group: userProfile.age_group,
      first_name: userProfile.first_name,
      book_categories: userProfile.book_categories,
      daily_reading_time: userProfile.daily_reading_time,
      referral_source: userProfile.referral_source
    }
  });
});

// POST /auth/onboarding/gender - Submit gender selection
export const updateGender = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { gender } = req.body;

  if (!gender || !['male', 'female', 'non_binary', 'prefer_not_to_say'].includes(gender)) {
    res.status(400).json({ error: 'Valid gender is required' });
    return;
  }

  const userProfile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!userProfile) {
    res.status(404).json({ error: 'User profile not found' });
    return;
  }

  if (!validateStepProgression(userProfile.onboarding_step, OnboardingStep.GENDER)) {
    res.status(400).json({ 
      error: 'Invalid step progression',
      current_step: userProfile.onboarding_step,
      required_step: OnboardingStep.GENDER
    });
    return;
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      gender,
      onboarding_step: OnboardingStep.AGE
    }
  });

  res.json({
    message: 'Gender updated successfully',
    next_step: OnboardingStep.AGE,
    profile: updatedProfile
  });
});

// POST /auth/onboarding/age-group - Submit age group selection
export const updateAgeGroup = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { age_group } = req.body;

  if (!age_group || !Object.values(AgeGroup).includes(age_group)) {
    res.status(400).json({ error: 'Valid age group is required' });
    return;
  }

  const userProfile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!userProfile) {
    res.status(404).json({ error: 'User profile not found' });
    return;
  }

  if (!validateStepProgression(userProfile.onboarding_step, OnboardingStep.AGE)) {
    res.status(400).json({ 
      error: 'Invalid step progression',
      current_step: userProfile.onboarding_step,
      required_step: OnboardingStep.AGE
    });
    return;
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      age_group,
      onboarding_step: OnboardingStep.NAME
    }
  });

  res.json({
    message: 'Age group updated successfully',
    next_step: OnboardingStep.NAME,
    profile: updatedProfile
  });
});

// POST /auth/onboarding/name - Submit name
export const updateName = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { first_name } = req.body;

  if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0) {
    res.status(400).json({ error: 'Valid first name is required' });
    return;
  }

  const userProfile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!userProfile) {
    res.status(404).json({ error: 'User profile not found' });
    return;
  }

  if (!validateStepProgression(userProfile.onboarding_step, OnboardingStep.NAME)) {
    res.status(400).json({ 
      error: 'Invalid step progression',
      current_step: userProfile.onboarding_step,
      required_step: OnboardingStep.NAME
    });
    return;
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      first_name: first_name.trim(),
      onboarding_step: OnboardingStep.CATEGORIES
    }
  });

  res.json({
    message: 'Name updated successfully',
    next_step: OnboardingStep.CATEGORIES,
    profile: updatedProfile
  });
});

// POST /auth/onboarding/book-categories - Submit book category preferences
export const updateBookCategories = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { book_categories } = req.body;

  if (!Array.isArray(book_categories) || book_categories.length === 0) {
    res.status(400).json({ error: 'At least one book category must be selected' });
    return;
  }

  // Validate all categories are valid enum values
  const validCategories = Object.values(BookCategory);
  const invalidCategories = book_categories.filter(cat => !validCategories.includes(cat));
  
  if (invalidCategories.length > 0) {
    res.status(400).json({ 
      error: 'Invalid book categories',
      invalid_categories: invalidCategories,
      valid_categories: validCategories
    });
    return;
  }

  const userProfile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!userProfile) {
    res.status(404).json({ error: 'User profile not found' });
    return;
  }

  if (!validateStepProgression(userProfile.onboarding_step, OnboardingStep.CATEGORIES)) {
    res.status(400).json({ 
      error: 'Invalid step progression',
      current_step: userProfile.onboarding_step,
      required_step: OnboardingStep.CATEGORIES
    });
    return;
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      book_categories,
      onboarding_step: OnboardingStep.PREFERENCES
    }
  });

  res.json({
    message: 'Book categories updated successfully',
    next_step: OnboardingStep.PREFERENCES,
    profile: updatedProfile
  });
});

// POST /auth/onboarding/reading-time - Submit daily reading time preference
export const updateReadingTime = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { daily_reading_time, referral_source } = req.body;

  if (!daily_reading_time || !Object.values(ReadingTime).includes(daily_reading_time)) {
    res.status(400).json({ error: 'Valid daily reading time is required' });
    return;
  }

  if (!referral_source || !Object.values(ReferralSource).includes(referral_source)) {
    res.status(400).json({ error: 'Valid referral source is required' });
    return;
  }

  const userProfile = await prisma.userProfile.findUnique({
    where: { user_id: userId }
  });

  if (!userProfile) {
    res.status(404).json({ error: 'User profile not found' });
    return;
  }

  if (!validateStepProgression(userProfile.onboarding_step, OnboardingStep.PREFERENCES)) {
    res.status(400).json({ 
      error: 'Invalid step progression',
      current_step: userProfile.onboarding_step,
      required_step: OnboardingStep.PREFERENCES
    });
    return;
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { user_id: userId },
    data: {
      daily_reading_time,
      referral_source,
      onboarding_step: OnboardingStep.COMPLETED,
      onboarding_completed: true
    }
  });

  res.json({
    message: 'Onboarding completed successfully!',
    completed: true,
    profile: updatedProfile
  });
});

// Legacy endpoint for backward compatibility
export const completeOnboarding = updateReadingTime; 