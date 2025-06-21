import { Router } from 'express';
import { 
  googleAuth, 
  appleAuth, 
  authCallback, 
  getUserInfo, 
  logout, 
  getAuthStatus,
  refreshToken
} from '../controllers/authController';
import { authenticateUser, optionalAuth } from '../middleware/auth';

const router = Router();

// OAuth login routes (public)
router.get('/google', googleAuth);
router.get('/apple', appleAuth);

// OAuth callback routes (public)
router.get('/google/callback', authCallback);
router.get('/apple/callback', authCallback);

// JWT token management (public)
router.post('/refresh', refreshToken);

// User management routes (require JWT authentication)
router.get('/user', authenticateUser, getUserInfo);
router.post('/logout', logout); // Logout doesn't require auth since it just invalidates tokens
router.get('/status', optionalAuth, getAuthStatus); // Optional auth for status check

export default router;