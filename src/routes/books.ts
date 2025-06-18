import { Router } from 'express';
import { createBook } from '../controllers/bookController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// POST /books/create - Create a new book from images (requires authentication)
router.post('/create', authenticateUser, createBook);

export default router; 