import { Router } from 'express';
import { authenticateUser } from '../middleware/auth';
import { requireActiveSubscription } from '../middleware/subscription';
import { getUserVoices, createVoice, setDefaultVoice, deleteVoice } from '../controllers/voiceController';

const router = Router();

router.get('/', authenticateUser, requireActiveSubscription, getUserVoices);

// Create new voice
router.post('/create', authenticateUser, requireActiveSubscription, createVoice);

// Set default voice
router.patch('/:id/set-default', authenticateUser, requireActiveSubscription, setDefaultVoice);

// Delete voice
router.delete('/:id', authenticateUser, requireActiveSubscription, deleteVoice);

export default router; 