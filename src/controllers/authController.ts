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
      return res.status(400).json(errorResponse);
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
      return res.status(500).json(errorResponse);
    }

    const response: ApiResponse = {
      success: true,
      message: 'OAuth URL generated successfully',
      data: {
        auth_url: data.url,
        provider
      }
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Auth URL error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to initiate OAuth',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return res.status(500).json(errorResponse);
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
      return res.status(400).json(errorResponse);
    }

    if (!code) {
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Authorization code missing',
        error: 'MISSING_CODE'
      };
      return res.status(400).json(errorResponse);
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
      return res.status(400).json(errorResponse);
    }

    const { user, session } = data;

    // Check if user exists in our database
    let existingUser = await prisma.user.findUnique({
      where: { email: user.email! },
      include: {
        profile: true
      }
    });

    let isNewUser = false;
    let userId: string;
    let userEmail: string;
    let userProvider: string;
    let userProviderId: string;
    let userProfile;

    // Create user if doesn't exist
    if (!existingUser) {
      const provider = user.app_metadata.provider || 'unknown';
      const providerId = user.user_metadata.provider_id || user.id;

      // Create user
      const newUser = await prisma.user.create({
        data: {
          email: user.email!,
          provider_id: providerId,
          provider: provider
        }
      });

      // Create empty profile for new user
      userProfile = await prisma.userProfile.create({
        data: {
          user_id: newUser.id,
          onboarding_step: 'AGE',
          onboarding_completed: false
        }
      });

      // Set user data
      userId = newUser.id;
      userEmail = newUser.email;
      userProvider = newUser.provider;
      userProviderId = newUser.provider_id;
      isNewUser = true;
    } else {
      userProfile = existingUser.profile;
      
      // If user exists but has no profile, create one (edge case)
      if (!userProfile) {
        userProfile = await prisma.userProfile.create({
          data: {
            user_id: existingUser.id,
            onboarding_step: 'AGE',
            onboarding_completed: false
          }
        });
      }

      // Set user data from existing user
      userId = existingUser.id;
      userEmail = existingUser.email;
      userProvider = existingUser.provider;
      userProviderId = existingUser.provider_id;
    }

    // At this point, all variables are guaranteed to exist
    const onboardingRequired = !userProfile.onboarding_completed;

    const authResponse: AuthResponse = {
      user: {
        id: userId,
        email: userEmail,
        provider: userProvider,
        provider_id: userProviderId
      },
      token: session.access_token,
      onboarding_required: onboardingRequired,
      is_new_user: isNewUser,
      current_onboarding_step: userProfile.onboarding_step
    };

    const response: ApiResponse<AuthResponse> = {
      success: true,
      message: 'Authentication successful',
      data: authResponse
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Auth callback error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Authentication callback failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return res.status(500).json(errorResponse);
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
      return res.status(401).json(errorResponse);
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
      return res.status(404).json(errorResponse);
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

    return res.status(200).json(response);
  } catch (error) {
    console.error('Get user info error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to retrieve user info',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return res.status(500).json(errorResponse);
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

    return res.status(200).json(response);
  } catch (error) {
    console.error('Logout error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Logout failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return res.status(500).json(errorResponse);
  }
};

// GET /auth/status - Quick status check for routing decisions
export const getAuthStatus = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(200).json({
        success: true,
        data: {
          authenticated: false,
          onboarding_required: true
        }
      });
    }

    // Get user profile
    const profile = await prisma.userProfile.findUnique({
      where: { user_id: req.user.id }
    });

    const response: ApiResponse = {
      success: true,
      message: 'Auth status retrieved successfully',
      data: {
        authenticated: true,
        onboarding_required: !profile?.onboarding_completed,
        current_onboarding_step: profile?.onboarding_step || 'AGE'
      }
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Auth status error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to get auth status',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return res.status(500).json(errorResponse);
  }
}; 