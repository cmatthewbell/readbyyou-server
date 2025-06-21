import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { ApiResponse } from '../types';

// Remove the custom Express.User interface - we'll use the Prisma user object directly
// This is the standard approach that most Node.js apps use

// JWT Authentication middleware - replaces session-based auth
export const authenticateUser = (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate('jwt', { session: false }, (err: any, user: any) => {
    if (err) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Authentication error',
        error: err.message
      };
      res.status(500).json(errorResponse);
      return;
    }

    if (!user) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Authentication required',
        error: 'Invalid or expired token'
      };
      res.status(401).json(errorResponse);
      return;
    }

    req.user = user;
    next();
  })(req, res, next);
};

// Optional authentication - doesn't fail if no token
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(); // No token, continue without user
    return;
  }

  passport.authenticate('jwt', { session: false }, (err: any, user: any) => {
    if (err) {
      console.error('Optional auth error:', err);
      next(); // Continue without user on error
      return;
    }

    if (user) {
      req.user = user;
    }
    
    next();
  })(req, res, next);
};

// Require completed onboarding
export const requireOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Authentication required'
      };
      res.status(401).json(errorResponse);
      return;
    }

    // Get user profile to check onboarding status
    const userProfile = await prisma.userProfile.findUnique({
      where: { user_id: req.user.id }
    });

    if (!userProfile || !userProfile.onboarding_completed) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Onboarding required',
        data: {
          onboardingStep: userProfile?.onboarding_step || 'AGE',
          onboardingCompleted: false
        }
      };
      res.status(403).json(errorResponse);
      return;
    }

    next();
  } catch (error) {
    console.error('Onboarding check error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to check onboarding status',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(errorResponse);
    return;
  }
};

// Utility function to verify refresh token
export const verifyRefreshToken = async (refreshToken: string): Promise<{ userId: string; email: string } | null> => {
  try {
    // Verify the JWT signature
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any;
    
    // Check if refresh token exists in database and is not expired
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        token: refreshToken,
        user_id: decoded.userId,
        expires_at: {
          gt: new Date()
        }
      }
    });

    if (!storedToken) {
      return null;
    }

    return {
      userId: decoded.userId,
      email: decoded.email
    };
  } catch (error) {
    console.error('Refresh token verification error:', error);
    return null;
  }
};

// Utility function to revoke refresh token
export const revokeRefreshToken = async (refreshToken: string): Promise<boolean> => {
  try {
    const result = await prisma.refreshToken.deleteMany({
      where: { token: refreshToken }
    });
    
    return result.count > 0;
  } catch (error) {
    console.error('Error revoking refresh token:', error);
    return false;
  }
}; 