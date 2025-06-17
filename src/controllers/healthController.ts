import { Request, Response } from 'express';
import { ApiResponse } from '../types';

export const getHealth = (req: Request, res: Response) => {
  try {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
    };

    const response: ApiResponse = {
      success: true,
      message: 'Service is healthy',
      data: healthData
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Health check error:', error);
    
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Health check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };

    res.status(500).json(errorResponse);
  }
};

export const getStatus = (req: Request, res: Response) => {
  try {
    const response: ApiResponse = {
      success: true,
      message: 'ReadByYou Server is running',
      data: {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Status check error:', error);
    
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Status check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };

    res.status(500).json(errorResponse);
  }
}; 