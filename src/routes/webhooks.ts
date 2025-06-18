import { Router } from 'express';
import { handleRevenueCatWebhook } from '../controllers/subscriptionController';

const router = Router();

// POST /webhooks/revenuecat - Handle RevenueCat subscription events
router.post('/revenuecat', handleRevenueCatWebhook);

export default router; 