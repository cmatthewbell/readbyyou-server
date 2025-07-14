import { Router } from 'express';
import { authenticateUser } from '../middleware/auth';
import { requireActiveSubscription } from '../middleware/subscription';
import { getUserBooks, getBook, streamBookAudio, updateBookProgress, addPagesToBook, changeBookVoice, deleteBook, createBook } from '../controllers/bookController';

const router = Router();

router.get('/', authenticateUser, requireActiveSubscription, getUserBooks);

// Get specific book
router.get('/:id', authenticateUser, requireActiveSubscription, getBook);

// Stream book audio
router.get('/:id/stream', authenticateUser, requireActiveSubscription, streamBookAudio);

// Update book progress
router.patch('/:id/progress', authenticateUser, requireActiveSubscription, updateBookProgress);

// Add pages to book
router.post('/:id/add-pages', authenticateUser, requireActiveSubscription, addPagesToBook);

// Change book voice
router.post('/:id/change-voice', authenticateUser, requireActiveSubscription, changeBookVoice);

// Delete book
router.delete('/:id', authenticateUser, requireActiveSubscription, deleteBook);

// Create new book
router.post('/create', authenticateUser, requireActiveSubscription, createBook);

export default router; 