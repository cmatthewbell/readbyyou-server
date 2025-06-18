import { Router } from 'express';
import { createBook, getUserBooks, getBook, deleteBook, streamBookAudio, updateBookProgress, addPagesToBook } from '../controllers/bookController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// GET /books - Get all books for authenticated user with pagination
router.get('/', authenticateUser, getUserBooks);

// GET /books/:id - Get a single book by ID
router.get('/:id', authenticateUser, getBook);

// GET /books/:id/stream - Stream book audio with range request support
router.get('/:id/stream', authenticateUser, streamBookAudio);

// PATCH /books/:id/progress - Update book listening progress
router.patch('/:id/progress', authenticateUser, updateBookProgress);

// POST /books/:id/add-pages - Add pages to an existing book
router.post('/:id/add-pages', authenticateUser, addPagesToBook);

// DELETE /books/:id - Delete a book and all its associated storage
router.delete('/:id', authenticateUser, deleteBook);

// POST /books/create - Create a new book from images (requires authentication)
router.post('/create', authenticateUser, createBook);

export default router; 