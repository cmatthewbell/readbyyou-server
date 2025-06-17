import express from 'express';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  try {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  } catch (error) {
    console.error('Logging middleware error:', error);
    next(error);
  }
});

// Routes
app.use('/api/v1', routes);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Express server running on http://localhost:${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/api/v1/health`);
}); 