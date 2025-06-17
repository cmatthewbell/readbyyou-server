import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import prisma from '../config/database';
import { ApiResponse } from '../types';

export const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Authorization header missing or invalid',
        error: 'UNAUTHORIZED'
      };
      return res.status(401).json(errorResponse);
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('Token verification failed:', error);
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Invalid or expired token',
        error: 'UNAUTHORIZED'
      };
      return res.status(401).json(errorResponse);
    }

    // Get user from database
    const dbUser = await prisma.user.findUnique({
      where: { email: user.email! },
      include: {
        profile: true
      }
    });

    if (!dbUser) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'User not found in database',
        error: 'USER_NOT_FOUND'
      };
      return res.status(404).json(errorResponse);
    }

    // Attach user to request
    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      provider: dbUser.provider,
      provider_id: dbUser.provider_id
    };

    return next();
  } catch (error) {
    console.error('Authentication error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Authentication failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return res.status(500).json(errorResponse);
  }
};

export const requireOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    if (!req.user) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'User not authenticated',
        error: 'UNAUTHORIZED'
      };
      return res.status(401).json(errorResponse);
    }

    const userProfile = await prisma.userProfile.findUnique({
      where: { user_id: req.user.id }
    });

    if (!userProfile || !userProfile.onboarding_completed) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Onboarding not completed',
        error: 'ONBOARDING_REQUIRED'
      };
      return res.status(403).json(errorResponse);
    }

    return next();
  } catch (error) {
    console.error('Onboarding check error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to check onboarding status',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return res.status(500).json(errorResponse);
  }
}; 