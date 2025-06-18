import { Router } from 'express';
import { createBook, getUserBooks, getBook, deleteBook, streamBookAudio, updateBookProgress, addPagesToBook, changeBookVoice } from '../controllers/bookController';
import { authenticateUser } from '../middleware/auth';
import { requireSubscription } from '../middleware/subscription';

const router = Router();

// GET /books - Get all books for authenticated user with pagination
router.get('/', authenticateUser, requireSubscription, getUserBooks);

// GET /books/:id - Get a single book by ID
router.get('/:id', authenticateUser, requireSubscription, getBook);

// GET /books/:id/stream - Stream book audio with range request support
router.get('/:id/stream', authenticateUser, requireSubscription, streamBookAudio);

// PATCH /books/:id/progress - Update book listening progress
router.patch('/:id/progress', authenticateUser, requireSubscription, updateBookProgress);

// POST /books/:id/add-pages - Add pages to an existing book
router.post('/:id/add-pages', authenticateUser, requireSubscription, addPagesToBook);

// POST /books/:id/change-voice - Change the voice of an existing book
router.post('/:id/change-voice', authenticateUser, requireSubscription, changeBookVoice);

// DELETE /books/:id - Delete a book and all its associated storage
router.delete('/:id', authenticateUser, requireSubscription, deleteBook);

// POST /books/create - Create a new book from images (requires authentication)
router.post('/create', authenticateUser, requireSubscription, createBook);

export default router; 