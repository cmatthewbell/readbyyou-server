import { Request, Response } from 'express';
import { ApiResponse } from '../types';

export const getIndex = (req: Request, res: Response) => {
  try {
    const response: ApiResponse = {
      success: true,
      message: 'Welcome to ReadByYou Server!',
      data: {
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent')
      }
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Index route error:', error);
    
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to process request',
      error: error instanceof Error ? error.message : 'Unknown error'
    };

    return res.status(500).json(errorResponse);
  }
}; 