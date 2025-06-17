import { Router } from 'express';
import { getAuthUrl, handleAuthCallback, getUserInfo, logout } from '../controllers/authController';
import { 
  getOnboardingStatus,
  updateGender,
  updateAgeGroup,
  updateName,
  updateBookCategories,
  updateReadingTime,
  completeOnboarding 
} from '../controllers/onboardingController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// GET /auth/login/:provider - Get OAuth URL for Google or Apple
router.get('/login/:provider', getAuthUrl);

// GET /auth/callback - Handle OAuth callback from Supabase
router.get('/callback', handleAuthCallback);

// GET /auth/me - Get current user info (requires authentication)
router.get('/me', authenticateUser, getUserInfo);

// POST /auth/logout - Logout user (requires authentication)
router.post('/logout', authenticateUser, logout);

// Onboarding routes
// POST /auth/onboarding/gender - Submit gender selection
router.post('/onboarding/gender', authenticateUser, updateGender);

// POST /auth/onboarding/age-group - Submit age group selection
router.post('/onboarding/age-group', authenticateUser, updateAgeGroup);

// POST /auth/onboarding/name - Submit name
router.post('/onboarding/name', authenticateUser, updateName);

// POST /auth/onboarding/book-categories - Submit book category preferences
router.post('/onboarding/book-categories', authenticateUser, updateBookCategories);

// POST /auth/onboarding/reading-time - Submit daily reading time preference
router.post('/onboarding/reading-time', authenticateUser, updateReadingTime);

// POST /auth/onboarding/referral-source - Submit referral source and complete onboarding
router.post('/onboarding/referral-source', authenticateUser, completeOnboarding);

// GET /auth/onboarding/status - Get current onboarding status
router.get('/onboarding/status', authenticateUser, getOnboardingStatus);

export default router;