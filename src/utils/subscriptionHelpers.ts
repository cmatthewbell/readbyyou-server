import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Find user by RevenueCat user ID
export async function findUserByRevenueCatId(revenueCatUserId: string) {
  return await prisma.user.findFirst({
    where: {
      subscription: {
        revenuecat_user_id: revenueCatUserId
      }
    },
    include: {
      subscription: true
    }
  });
}

// Activate user subscription
export async function activateSubscription(
  revenueCatUserId: string, 
  expiresAt: Date,
  planType?: string
) {
  // First, try to find existing subscription
  const existingSubscription = await prisma.subscription.findUnique({
    where: {
      revenuecat_user_id: revenueCatUserId
    }
  });

  if (existingSubscription) {
    // Update existing subscription
    return await prisma.subscription.update({
      where: {
        revenuecat_user_id: revenueCatUserId
      },
      data: {
        is_active: true,
        expires_at: expiresAt,
        plan_type: planType,
        updated_at: new Date()
      }
    });
  } else {
    // This shouldn't happen if user is properly created with subscription
    console.error(`No subscription found for RevenueCat user ID: ${revenueCatUserId}`);
    return null;
  }
}

// Deactivate user subscription
export async function deactivateSubscription(revenueCatUserId: string) {
  return await prisma.subscription.update({
    where: {
      revenuecat_user_id: revenueCatUserId
    },
    data: {
      is_active: false,
      updated_at: new Date()
    }
  });
}

// Extend subscription (for renewals)
export async function extendSubscription(
  revenueCatUserId: string,
  newExpiresAt: Date,
  planType?: string
) {
  return await prisma.subscription.update({
    where: {
      revenuecat_user_id: revenueCatUserId
    },
    data: {
      is_active: true,
      expires_at: newExpiresAt,
      plan_type: planType,
      renewal_count: {
        increment: 1
      },
      last_renewal_at: new Date(),
      updated_at: new Date()
    }
  });
}

// Create subscription for new user (when they first sign up)
export async function createSubscription(
  userId: string,
  revenueCatUserId: string,
  isActive: boolean = false,
  expiresAt?: Date,
  planType?: string
) {
  return await prisma.subscription.create({
    data: {
      user_id: userId,
      revenuecat_user_id: revenueCatUserId,
      is_active: isActive,
      expires_at: expiresAt,
      plan_type: planType
    }
  });
}

// Check if user has active subscription
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({
    where: {
      user_id: userId
    }
  });

  if (!subscription) return false;

  // Check if subscription is active and not expired
  const now = new Date();
  return subscription.is_active && 
         (!subscription.expires_at || subscription.expires_at > now);
} 