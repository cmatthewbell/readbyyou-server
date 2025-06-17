import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../types';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    console.error('Global error handler:', {
      error: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });

    const statusCode = res.statusCode !== 200 ? res.statusCode : 500;

    const errorResponse: ErrorResponse = {
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' 
        ? 'Something went wrong!' 
        : error.message,
      statusCode,
      timestamp: new Date().toISOString()
    };

    res.status(statusCode).json(errorResponse);
  } catch (handlerError) {
    console.error('Error in error handler:', handlerError);
    res.status(500).json({
      error: 'Critical Error',
      message: 'Error handler failed',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
};