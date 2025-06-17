import { Router } from 'express';
import { getIndex } from '../controllers/indexController';
import healthRoutes from './health';

const router = Router();

// Root route
router.get('/', getIndex);

// Health routes
router.use('/health', healthRoutes);

export default router; 