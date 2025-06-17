import { Request, Response } from 'express';
import { supabase, supabaseAdmin } from '../config/supabase';
import prisma from '../config/database';
import { ApiResponse, AuthResponse, AuthCallbackRequest } from '../types';

export const getAuthUrl = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    
    if (!provider || !['google', 'apple'].includes(provider)) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Invalid provider. Use "google" or "apple"',
        error: 'INVALID_PROVIDER'
      };
      res.status(400).json(errorResponse);
      return;
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider as 'google' | 'apple',
      options: {
        redirectTo: `${process.env.SUPABASE_URL}/auth/v1/callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });

    if (error) {
      console.error('OAuth URL generation error:', error);
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Failed to generate OAuth URL',
        error: error.message
      };
      res.status(500).json(errorResponse);
      return;
    }

    const response: ApiResponse = {
      success: true,
      message: 'OAuth URL generated successfully',
      data: {
        auth_url: data.url,
        provider
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Auth URL error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to initiate OAuth',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(errorResponse);
  }
};

export const handleAuthCallback = async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const authError = req.query.error as string;

    if (authError) {
      console.error('OAuth callback error:', authError);
      const errorResponse: ApiResponse = {
        success: false,
        message: 'OAuth authentication failed',
        error: authError
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (!code) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Authorization code missing',
        error: 'MISSING_CODE'
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Exchange code for session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.user) {
      console.error('Code exchange error:', error);
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Failed to exchange code for session',
        error: error?.message || 'Unknown error'
      };
      res.status(400).json(errorResponse);
      return;
    }

    const { user, session } = data;

    // Check if user exists in our database
    let dbUser = await prisma.user.findUnique({
      where: { email: user.email! }
    });

    // Create user if doesn't exist
    if (!dbUser) {
      const provider = user.app_metadata.provider || 'unknown';
      const providerId = user.user_metadata.provider_id || user.id;

      dbUser = await prisma.user.create({
        data: {
          email: user.email!,
          provider_id: providerId,
          provider: provider
        }
      });

      // Create empty profile for new user
      await prisma.userProfile.create({
        data: {
          user_id: dbUser.id,
          onboarding_step: 'GENDER',
          onboarding_completed: false
        }
      });
    }

    const authResponse: AuthResponse = {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        provider: dbUser.provider,
        provider_id: dbUser.provider_id
      },
      token: session.access_token,
      onboarding_required: true // Will check this properly later
    };

    const response: ApiResponse<AuthResponse> = {
      success: true,
      message: 'Authentication successful',
      data: authResponse
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Auth callback error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Authentication callback failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(errorResponse);
  }
};

export const getUserInfo = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'User not authenticated',
        error: 'UNAUTHORIZED'
      };
      res.status(401).json(errorResponse);
      return;
    }

    // Get user with profile
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        profile: true
      }
    });

    if (!user) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'User not found',
        error: 'USER_NOT_FOUND'
      };
      res.status(404).json(errorResponse);
      return;
    }

    const response: ApiResponse = {
      success: true,
      message: 'User info retrieved successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          provider: user.provider,
          created_at: user.created_at
        },
        profile: user.profile ? {
          onboarding_completed: user.profile.onboarding_completed,
          onboarding_step: user.profile.onboarding_step
        } : null
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Get user info error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to retrieve user info',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(errorResponse);
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      // Sign out from Supabase
      const { error } = await supabase.auth.admin.signOut(token);
      
      if (error) {
        console.error('Logout error:', error);
      }
    }

    const response: ApiResponse = {
      success: true,
      message: 'Logged out successfully'
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Logout error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Logout failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(errorResponse);
  }
}; 