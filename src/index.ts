import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import './config/passport'; // Initialize Passport strategies

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/v1/auth', require('./routes/auth').default);
app.use('/api/v1/books', require('./routes/books').default);
app.use('/api/v1/voices', require('./routes/voices').default);
app.use('/api/v1/webhooks', require('./routes/webhooks').default);
app.use('/api/v1/health', require('./routes/health').default);
app.use('/api/v1', require('./routes/index').default);

// Error handling middleware
app.use(require('./middleware/errorHandler').errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Base URL: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
}); 