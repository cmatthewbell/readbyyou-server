import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';

export const requireSubscription = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    if (!req.user) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'User not authenticated',
        error: 'UNAUTHORIZED'
      };
      return res.status(401).json(errorResponse);
    }

    // Check subscription status with RevenueCat
    const hasActiveSubscription = await checkUserSubscription(req.user.id);

    if (!hasActiveSubscription) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'This feature requires an active premium subscription',
        error: 'SUBSCRIPTION_REQUIRED'
      };
      return res.status(402).json(errorResponse);
    }

    // User has active subscription, continue
    return next();

  } catch (error) {
    console.error('Subscription check error:', error);
    
    // If RevenueCat is down, fail closed for security
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Unable to verify subscription status',
      error: 'SUBSCRIPTION_CHECK_FAILED'
    };
    return res.status(503).json(errorResponse);
  }
};

/**
 * Check if user has active subscription via RevenueCat
 */
async function checkUserSubscription(userId: string): Promise<boolean> {
  const revenueCatApiKey = process.env.REVENUECAT_API_KEY;
  
  if (!revenueCatApiKey) {
    console.warn('RevenueCat API key not configured');
    return false; // Fail closed if not configured
  }

  try {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${userId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${revenueCatApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        // User not found in RevenueCat = no subscription
        return false;
      }
      throw new Error(`RevenueCat API error: ${response.status}`);
    }

    const data = await response.json() as any;
    
    // Check if user has any active entitlements
    const entitlements = data.subscriber?.entitlements;
    if (!entitlements) return false;

    // Look for any active premium entitlement
    for (const [key, entitlement] of Object.entries(entitlements)) {
      const ent = entitlement as any;
      if (ent.expires_date === null || new Date(ent.expires_date) > new Date()) {
        console.log(`User ${userId} has active entitlement: ${key}`);
        return true;
      }
    }

    return false;

  } catch (error) {
    console.error('Error checking RevenueCat subscription:', error);
    throw error;
  }
} 