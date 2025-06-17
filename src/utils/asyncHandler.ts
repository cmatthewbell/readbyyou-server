import { Request, Response, NextFunction } from 'express';

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const createResponse = <T>(
  success: boolean, 
  message: string, 
  data?: T, 
  error?: string
) => {
  return {
    success,
    message,
    data,
    error,
    timestamp: new Date().toISOString()
  };
}; 