import { Router } from 'express';
import { getIndex } from '../controllers/indexController';
import healthRoutes from './health';
import authRoutes from './auth';

const router = Router();

// Root route
router.get('/', getIndex);

// Health routes
router.use('/health', healthRoutes);

// Auth routes
router.use('/auth', authRoutes);

export default router; 