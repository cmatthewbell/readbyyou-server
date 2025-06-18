import { Router } from 'express';
import { createVoice, getUserVoices, setDefaultVoice, deleteVoice } from '../controllers/voiceController';
import { authenticateUser } from '../middleware/auth';
import { requireSubscription } from '../middleware/subscription';

const router = Router();

// GET /voices?cursor=voice-id&limit=10 - Get paginated voices for authenticated user
router.get('/', authenticateUser, requireSubscription, getUserVoices);

// POST /voices/create - Create a new voice with single audio file (10-second recording from iPhone or uploaded MP3)
router.post('/create', authenticateUser, requireSubscription, createVoice);

// PATCH /voices/:id/set-default - Set a voice as default
router.patch('/:id/set-default', authenticateUser, requireSubscription, setDefaultVoice);

// DELETE /voices/:id - Delete a voice
router.delete('/:id', authenticateUser, requireSubscription, deleteVoice);

export default router; 