import { Router } from 'express';
import { getIndex } from '../controllers/indexController';
import healthRoutes from './health';
import authRoutes from './auth';
import webhookRoutes from './webhooks';
import bookRoutes from './books';

const router = Router();

// Root route
router.get('/', getIndex);

// Health routes
router.use('/health', healthRoutes);

// Auth routes
router.use('/auth', authRoutes);

// Book routes (requires authentication)
router.use('/books', bookRoutes);

// Webhook routes (no auth required)
router.use('/webhooks', webhookRoutes);

export default router; 