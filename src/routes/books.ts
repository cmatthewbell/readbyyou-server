import { Router } from 'express';
import { createBook, getUserBooks } from '../controllers/bookController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// GET /books - Get all books for authenticated user with pagination
router.get('/', authenticateUser, getUserBooks);

// POST /books/create - Create a new book from images (requires authentication)
router.post('/create', authenticateUser, createBook);

export default router; 