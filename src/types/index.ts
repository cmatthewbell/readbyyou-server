import { AgeGroup, ReadingTime, ReferralSource, OnboardingStep, BookCategory } from '@prisma/client';

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version?: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
}

export interface RequestUser {
  id: string;
  email: string;
  provider: string;
  provider_id: string;
}

export interface OnboardingProgressRequest {
  gender?: string;
  age_group?: AgeGroup;
  first_name?: string;
  daily_reading_time?: ReadingTime;
  referral_source?: ReferralSource;
  book_categories?: BookCategory[];
  current_step: OnboardingStep;
}

export interface OnboardingCompleteRequest {
  gender: string;
  age_group: AgeGroup;
  first_name: string;
  daily_reading_time: ReadingTime;
  referral_source: ReferralSource;
  book_categories: BookCategory[];
}

export interface OnboardingStatusResponse {
  onboarding_completed: boolean;
  current_step: OnboardingStep;
  profile?: {
    gender?: string;
    age_group?: AgeGroup;
    first_name?: string;
    daily_reading_time?: ReadingTime;
    referral_source?: ReferralSource;
    book_categories?: BookCategory[];
  };
}

// Book category display names mapping
export const BOOK_CATEGORY_LABELS: Record<BookCategory, string> = {
  ROMANTASY: 'Romantasy',
  DARK_ROMANCE: 'Dark Romance',
  CONTEMPORARY_ROMANCE: 'Contemporary Romance',
  YA_FANTASY: 'Young Adult (YA) Fantasy',
  THRILLER_MYSTERY: 'Thriller / Mystery',
  SAD_GIRL_FICTION: 'Sad Girl Fiction',
  LGBTQ_ROMANCE: 'LGBTQ+ Romance',
  CLASSIC_LIT: 'Classic Lit',
  COZY_MYSTERY: 'Cozy Mystery',
  SCI_FI_DYSTOPIAN: 'Sci-Fi / Dystopian',
  HISTORICAL_ROMANCE: 'Historical Romance',
  SMUT_SPICE: 'Smut / Spice',
  ENEMIES_TO_LOVERS: 'Enemies to Lovers',
  COMING_OF_AGE: 'Coming-of-Age',
  FANTASY_NON_ROMANTIC: 'Fantasy (non-romantic)'
};

// Auth types
export interface AuthCallbackRequest {
  code?: string;
  state?: string;
  error?: string;
  provider: 'google' | 'apple';
}

export interface AuthResponse {
  user: RequestUser;
  token: string;
  onboarding_required: boolean;
}

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
} 