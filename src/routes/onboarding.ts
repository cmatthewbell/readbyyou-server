import { Router } from 'express';
import { 
  getOnboardingStatus,
  updateGender,
  updateAgeGroup,
  updateName,
  updateBookCategories,
  updateReadingTime,
  updateVoice,
  generateVoiceDemo,
  completeVoiceDemo,
  handlePremiumTrial,
  completeOnboarding,
  goBackToPreviousStep
} from '../controllers/onboardingController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// All onboarding routes require JWT authentication
router.get('/status', authenticateUser, getOnboardingStatus);
router.post('/back', authenticateUser, goBackToPreviousStep);
router.post('/gender', authenticateUser, updateGender);
router.post('/age-group', authenticateUser, updateAgeGroup);
router.post('/name', authenticateUser, updateName);
router.post('/book-categories', authenticateUser, updateBookCategories);
router.post('/reading-time', authenticateUser, updateReadingTime);
router.post('/voice', authenticateUser, updateVoice);
router.post('/voice-demo/generate', authenticateUser, generateVoiceDemo);
router.post('/voice-demo', authenticateUser, completeVoiceDemo);
router.post('/premium-trial', authenticateUser, handlePremiumTrial);
router.post('/referral-source', authenticateUser, completeOnboarding);

export default router; 