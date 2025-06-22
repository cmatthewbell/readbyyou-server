import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { ApiResponse } from '../types';
import { asyncHandler } from '../utils/asyncHandler';

// JWT Token interfaces
interface TokenPayload {
  userId: string;
  email: string;
  provider: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      provider: string;
      provider_id: string;
    }
  }
}

// JWT Helper Functions
const generateTokens = (payload: TokenPayload): AuthTokens => {
  const accessToken = jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '30d' }
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60 // 15 minutes in seconds
  };
};



// Google OAuth login
export const googleAuth = (req: Request, res: Response, next: NextFunction) => {
  // Force account selection by passing prompt=select_account to Google OAuth
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'  // This forces Google to show account selection
  })(req, res, next);
};

// Apple OAuth login  
export const appleAuth = passport.authenticate('apple', {
  scope: ['name', 'email']
});

// OAuth callback handler - handles both Google and Apple
export const authCallback = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  // Determine provider from the URL path
  const provider = req.path.includes('google') ? 'google' : 'apple';
  
  // Get the redirect_uri from query params (sent by the mobile app)
  const mobileRedirectUri = req.query.redirect_uri as string;
  
  return new Promise((resolve) => {
    passport.authenticate(provider, async (err: any, profile: any) => {
      if (err) {
        console.error(`${provider} auth error:`, err);
        const errorUrl = mobileRedirectUri 
          ? `${mobileRedirectUri}?error=${encodeURIComponent('Authentication failed')}`
          : `readbyyouclient://auth/callback?error=${encodeURIComponent('Authentication failed')}`;
        res.redirect(errorUrl);
        return resolve(undefined);
      }

      if (!profile) {
        const errorUrl = mobileRedirectUri 
          ? `${mobileRedirectUri}?error=${encodeURIComponent('Authentication cancelled')}`
          : `readbyyouclient://auth/callback?error=${encodeURIComponent('Authentication cancelled')}`;
        res.redirect(errorUrl);
        return resolve(undefined);
      }

      try {
        // Check if user exists in our database
        let existingUser = await prisma.user.findUnique({
          where: { email: profile.emails[0].value },
          include: { profile: true }
        });

        let isNewUser = false;
        let userId: string;
        let userEmail: string;
        let userProvider: string;
        let userProfile;

        // Create user if doesn't exist
        if (!existingUser) {
          const newUser = await prisma.user.create({
            data: {
              email: profile.emails[0].value,
              provider_id: profile.id,
              provider: provider
            }
          });

          // Create empty profile for new user
          userProfile = await prisma.userProfile.create({
            data: {
              user_id: newUser.id,
              onboarding_step: 'GENDER',
              onboarding_completed: false
            }
          });

          userId = newUser.id;
          userEmail = newUser.email;
          userProvider = newUser.provider;
          isNewUser = true;
        } else {
          userProfile = existingUser.profile;
          
          // If user exists but has no profile, create one (edge case)
          if (!userProfile) {
            userProfile = await prisma.userProfile.create({
              data: {
                user_id: existingUser.id,
                onboarding_step: 'GENDER',
                onboarding_completed: false
              }
            });
          }

          userId = existingUser.id;
          userEmail = existingUser.email;
          userProvider = existingUser.provider;
        }

        // Generate JWT tokens
        const tokens = generateTokens({
          userId,
          email: userEmail,
          provider: userProvider
        });

        // Store refresh token in database
        await prisma.refreshToken.create({
          data: {
            token: tokens.refreshToken,
            user_id: userId,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
          }
        });

        // Build success redirect URL using the mobile redirect URI
        const baseUrl = mobileRedirectUri || 'readbyyouclient://auth/callback';
        const params = new URLSearchParams({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn.toString(),
          isNewUser: isNewUser.toString(),
          onboardingRequired: (isNewUser || !userProfile.onboarding_completed).toString(),
          userId: userId
        });
        
        if (isNewUser || !userProfile.onboarding_completed) {
          params.set('onboardingStep', userProfile.onboarding_step || 'GENDER');
        }

        console.log(`Redirecting to: ${baseUrl}?${params.toString()}`);
        res.redirect(`${baseUrl}?${params.toString()}`);
        return resolve(undefined);

      } catch (error) {
        console.error('Database error during auth:', error);
        const errorUrl = mobileRedirectUri 
          ? `${mobileRedirectUri}?error=${encodeURIComponent('Database error')}`
          : `readbyyouclient://auth/callback?error=${encodeURIComponent('Database error')}`;
        res.redirect(errorUrl);
        return resolve(undefined);
      }
    })(req, res, next);
  });
});

// Refresh token endpoint with rotation
export const refreshToken = asyncHandler(async (req: Request, res: Response): Promise<any> => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Refresh token required'
    };
    return res.status(400).json(errorResponse);
  }

  try {
    // Verify refresh token JWT
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as TokenPayload;
    
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
      // Token doesn't exist or is expired - revoke all tokens for this user (security measure)
      await prisma.refreshToken.deleteMany({
        where: { user_id: decoded.userId }
      });
      
      const errorResponse: ApiResponse = {
        success: false,
        message: 'Invalid or expired refresh token'
      };
      return res.status(401).json(errorResponse);
    }

    // Generate new tokens
    const newTokens = generateTokens({
      userId: decoded.userId,
      email: decoded.email,
      provider: decoded.provider
    });

    // Remove old refresh token (token rotation for security)
    await prisma.refreshToken.delete({
      where: { id: storedToken.id }
    });

    // Store new refresh token
    await prisma.refreshToken.create({
      data: {
        token: newTokens.refreshToken,
        user_id: decoded.userId,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });

    const response: ApiResponse = {
      success: true,
      message: 'Tokens refreshed successfully',
      data: newTokens
    };
    return res.status(200).json(response);

  } catch (error) {
    console.error('Refresh token error:', error);
    
    // If JWT is invalid, try to revoke any tokens with the same signature
    try {
      const decoded = jwt.decode(refreshToken) as any;
      if (decoded?.userId) {
        await prisma.refreshToken.deleteMany({
          where: { user_id: decoded.userId }
        });
      }
    } catch (decodeError) {
      // Ignore decode errors
    }

    const errorResponse: ApiResponse = {
      success: false,
      message: 'Invalid refresh token'
    };
    return res.status(401).json(errorResponse);
  }
});

// Get current user info (requires authentication via JWT middleware)
export const getUserInfo = asyncHandler(async (req: Request, res: Response): Promise<any> => {
  // User is already authenticated and attached to req.user by JWT middleware
  if (!req.user) {
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Authentication required'
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
      message: 'User not found'
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
});

// Logout user from all devices (invalidate all refresh tokens for user)
export const logoutFromAllDevices = asyncHandler(async (req: Request, res: Response): Promise<any> => {
  // This endpoint requires authentication since we need to know which user's tokens to invalidate
  if (!req.user) {
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Authentication required'
    };
    return res.status(401).json(errorResponse);
  }

  try {
    // Delete ALL refresh tokens for this user
    const deletedTokens = await prisma.refreshToken.deleteMany({
      where: { user_id: req.user.id }
    });

    console.log(`Logout from all devices: Invalidated ${deletedTokens.count} refresh token(s) for user ${req.user.id}`);

    const response: ApiResponse = {
      success: true,
      message: 'Logged out from all devices successfully',
      data: {
        tokensInvalidated: deletedTokens.count
      }
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Logout from all devices error:', error);
    const errorResponse: ApiResponse = {
      success: false,
      message: 'Failed to logout from all devices',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return res.status(500).json(errorResponse);
  }
});

// Logout user (invalidate refresh token)
export const logout = asyncHandler(async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // First, try to decode the token to get user info (even if expired)
      let userId: string | null = null;
      try {
        const decoded = jwt.decode(refreshToken) as any;
        if (decoded?.userId) {
          userId = decoded.userId;
        }
      } catch (decodeError) {
        // If we can't decode, we'll just delete by token value
      }

      // Delete the specific refresh token from database
      const deletedToken = await prisma.refreshToken.deleteMany({
        where: { token: refreshToken }
      });

      // Security measure: If we have the user ID and the token was found,
      // this indicates a valid logout request. For extra security in high-risk scenarios,
      // you could invalidate ALL tokens for this user by uncommenting below:
      // if (userId && deletedToken.count > 0) {
      //   await prisma.refreshToken.deleteMany({
      //     where: { user_id: userId }
      //   });
      // }

      console.log(`Logout: Invalidated ${deletedToken.count} refresh token(s)`);
    }

    // Always return success - don't reveal whether token existed or not
    // This prevents token enumeration attacks
    const response: ApiResponse = {
      success: true,
      message: 'Logged out successfully'
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Logout error:', error);
    
    // Still return success to prevent information leakage
    // In production, you don't want to reveal internal errors for logout
    const response: ApiResponse = {
      success: true,
      message: 'Logged out successfully'
    };
    return res.status(200).json(response);
  }
});

// Get auth status for routing decisions (uses optional auth middleware)
export const getAuthStatus = asyncHandler(async (req: Request, res: Response): Promise<any> => {
  let isAuthenticated = false;
  let user = null;

  if (req.user) {
    isAuthenticated = true;
    user = {
      id: req.user.id,
      email: req.user.email,
      provider: req.user.provider
    };
  }

  const response: ApiResponse = {
    success: true,
    message: 'Auth status retrieved',
    data: {
      isAuthenticated,
      user
    }
  };

  return res.status(200).json(response);
}); 