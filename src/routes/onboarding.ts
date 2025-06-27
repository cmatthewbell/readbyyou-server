import { Router } from 'express';
import multer from 'multer';
import { 
  getOnboardingStatus,
  updateGender,
  updateAgeGroup,
  updateName,
  updateBookCategories,
  updateReadingTime,
  updateReadingStat,
  updateNotificationPage,
  updateVoice,
  completeVoiceDemo,
  getVoiceDemo,
  handlePremiumTrial,
  completeOnboarding,
  goBackToPreviousStep
} from '../controllers/onboardingController';
import { authenticateUser } from '../middleware/auth';

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const router = Router();

// All onboarding routes require JWT authentication
router.get('/status', authenticateUser, getOnboardingStatus);
router.post('/back', authenticateUser, goBackToPreviousStep);
router.post('/gender', authenticateUser, updateGender);
router.post('/age-group', authenticateUser, updateAgeGroup);
router.post('/name', authenticateUser, updateName);
router.post('/book-categories', authenticateUser, updateBookCategories);
router.post('/reading-time', authenticateUser, updateReadingTime);
router.post('/reading-stat', authenticateUser, updateReadingStat);
router.post('/notification-page', authenticateUser, updateNotificationPage);
router.post('/voice', authenticateUser, upload.single('audioFile'), updateVoice);
router.get('/voice-demo', authenticateUser, getVoiceDemo);
router.post('/voice-demo', authenticateUser, completeVoiceDemo);
router.post('/premium-trial', authenticateUser, handlePremiumTrial);
router.post('/referral-source', authenticateUser, completeOnboarding);

export default router; 