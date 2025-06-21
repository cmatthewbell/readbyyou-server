import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as JwtStrategy, ExtractJwt, StrategyOptions, VerifiedCallback } from 'passport-jwt';
import prisma from './database';

// Import Apple strategy (no official types available)
const AppleStrategy = require('@nicokaiser/passport-apple').Strategy;

// JWT Strategy for protecting routes - following industry best practices
const jwtOptions: StrategyOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_ACCESS_SECRET!,
  // Remove issuer/audience - not standard for simple apps and can cause issues
  // Most production apps don't use these unless in complex multi-service environments
};

passport.use(new JwtStrategy(jwtOptions, async (payload: any, done: VerifiedCallback) => {
  try {
    // The payload structure should match what we generate in authController
    // We generate: { userId, email, provider }
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { profile: true }
    });

    if (user) {
      // Just return the Prisma user object directly - standard approach
      // Cast to any to satisfy TypeScript
      return done(null, user as any);
    } else {
      return done(null, false);
    }
  } catch (error) {
    console.error('JWT Strategy error:', error);
    return done(error, false);
  }
}));

// Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: `${process.env.BASE_URL || 'http://localhost:8080'}/api/v1/auth/google/callback`
}, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
  try {
    return done(null, profile);
  } catch (error) {
    return done(error);
  }
}));

// Apple OAuth Strategy
passport.use(new AppleStrategy({
  clientID: process.env.APPLE_CLIENT_ID!,
  teamID: process.env.APPLE_TEAM_ID!,
  keyID: process.env.APPLE_KEY_ID!,
  key: process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  callbackURL: `${process.env.BASE_URL || 'http://localhost:8080'}/api/v1/auth/apple/callback`,
  scope: ['name', 'email']
}, async (accessToken: string, refreshToken: string, idToken: any, profile: any, done: any) => {
  try {
    return done(null, profile);
  } catch (error) {
    return done(error);
  }
}));

export default passport; 