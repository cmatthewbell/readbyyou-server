import { Router } from 'express';
import { getIndex } from '../controllers/indexController';
import healthRoutes from './health';
import authRoutes from './auth';
import onboardingRoutes from './onboarding';
import webhookRoutes from './webhooks';
import bookRoutes from './books';
import voiceRoutes from './voices';

const router = Router();

// Root route
router.get('/', getIndex);

// Health routes
router.use('/health', healthRoutes);

// Auth routes
router.use('/auth', authRoutes);

// Onboarding routes (requires authentication)
router.use('/onboarding', onboardingRoutes);

// Book routes (requires authentication)
router.use('/books', bookRoutes);

// Voice routes (requires authentication)
router.use('/voices', voiceRoutes);

// Webhook routes (no auth required)
router.use('/webhooks', webhookRoutes);

export default router; 