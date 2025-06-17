import { Router } from 'express';
import { getHealth, getStatus } from '../controllers/healthController';

const router = Router();

// GET /health - Health check endpoint
router.get('/', getHealth);

// GET /health/status - Extended status check
router.get('/status', getStatus);

export default router; 