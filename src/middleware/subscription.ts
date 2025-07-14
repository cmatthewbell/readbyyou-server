import { Request, Response, NextFunction } from 'express';
import { hasActiveSubscription } from '../utils/subscriptionHelpers';

// Middleware to check if user has active subscription
export const requireActiveSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user has active subscription using local database
    const hasActive = await hasActiveSubscription(req.user.id);
    
    if (!hasActive) {
      return res.status(403).json({
        success: false,
        message: 'Active subscription required'
      });
    }

    // User has active subscription, continue
    return next();
    
  } catch (error: any) {
    console.error('Subscription middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to verify subscription status'
    });
  }
}; 