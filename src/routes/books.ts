import { Router } from 'express';
import { createBook, getUserBooks, getBook, deleteBook } from '../controllers/bookController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// GET /books - Get all books for authenticated user with pagination
router.get('/', authenticateUser, getUserBooks);

// GET /books/:id - Get a single book by ID
router.get('/:id', authenticateUser, getBook);

// DELETE /books/:id - Delete a book and all its associated storage
router.delete('/:id', authenticateUser, deleteBook);

// POST /books/create - Create a new book from images (requires authentication)
router.post('/create', authenticateUser, createBook);

export default router; 