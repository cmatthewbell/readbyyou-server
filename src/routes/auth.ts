import { Router } from 'express';
import { getAuthUrl, handleAuthCallback, getUserInfo, logout, getAuthStatus } from '../controllers/authController';
import { 
  getOnboardingStatus,
  updateAgeGroup,
  updateName,
  updateBookCategories,
  updateReadingTime,
  updateVoice,
  generateVoiceDemo,
  completeVoiceDemo,
  handlePremiumTrial,
  completeOnboarding 
} from '../controllers/onboardingController';
import { authenticateUser, optionalAuth } from '../middleware/auth';

const router = Router();

// GET /auth/login/:provider - Get OAuth URL for Google or Apple
router.get('/login/:provider', getAuthUrl);

// GET /auth/callback - Handle OAuth callback from Supabase
router.get('/callback', handleAuthCallback);

// GET /auth/me - Get current user info (requires authentication)
router.get('/me', authenticateUser, getUserInfo);

// GET /auth/status - Get auth status for routing decisions (optional auth)
router.get('/status', optionalAuth, getAuthStatus);

// POST /auth/logout - Logout user (requires authentication)
router.post('/logout', authenticateUser, logout);

// Onboarding routes
// POST /auth/onboarding/age-group - Submit age group selection
router.post('/onboarding/age-group', authenticateUser, updateAgeGroup);

// POST /auth/onboarding/name - Submit name
router.post('/onboarding/name', authenticateUser, updateName);

// POST /auth/onboarding/book-categories - Submit book category preferences
router.post('/onboarding/book-categories', authenticateUser, updateBookCategories);

// POST /auth/onboarding/reading-time - Submit daily reading time preference
router.post('/onboarding/reading-time', authenticateUser, updateReadingTime);

// POST /auth/onboarding/voice - Submit voice recording/upload for cloning
router.post('/onboarding/voice', authenticateUser, updateVoice);

// POST /auth/onboarding/voice-demo/generate - Generate voice demo audio
router.post('/onboarding/voice-demo/generate', authenticateUser, generateVoiceDemo);

// POST /auth/onboarding/voice-demo - Mark voice demo as completed
router.post('/onboarding/voice-demo', authenticateUser, completeVoiceDemo);

// POST /auth/onboarding/premium-trial - Handle premium trial signup
router.post('/onboarding/premium-trial', authenticateUser, handlePremiumTrial);

// POST /auth/onboarding/referral-source - Submit referral source and complete onboarding
router.post('/onboarding/referral-source', authenticateUser, completeOnboarding);

// GET /auth/onboarding/status - Get current onboarding status
router.get('/onboarding/status', authenticateUser, getOnboardingStatus);

export default router;