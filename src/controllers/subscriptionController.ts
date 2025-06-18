import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';

const prisma = new PrismaClient();

// POST /webhooks/revenuecat - Handle RevenueCat webhook events
export const handleRevenueCatWebhook = asyncHandler(async (req: Request, res: Response) => {
  const { event } = req.body;

  if (!event) {
    return res.status(400).json({
      success: false,
      message: 'Invalid webhook payload'
    });
  }

  try {
    // Handle different RevenueCat events
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
        // User has active subscription
        await handleSubscriptionActive(event);
        break;
        
      case 'CANCELLATION':
      case 'EXPIRATION':
      case 'BILLING_ISSUE':
        // User lost subscription access
        await handleSubscriptionInactive(event);
        break;
        
      default:
        console.log(`Unhandled RevenueCat event type: ${event.type}`);
    }

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });

  } catch (error: any) {
    console.error('RevenueCat webhook error:', error);
    return res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

// Helper function to handle active subscription
async function handleSubscriptionActive(event: any) {
  const userId = event.app_user_id; // This should match your user ID
  
  if (!userId) {
    console.log('No user ID in webhook event');
    return;
  }

  // Update user subscription status in your database
  console.log(`User ${userId} has active subscription`);
  
  // You can store subscription details if needed
  // For now, we'll just log it since RevenueCat handles the validation
}

// Helper function to handle inactive subscription  
async function handleSubscriptionInactive(event: any) {
  const userId = event.app_user_id;
  
  if (!userId) {
    console.log('No user ID in webhook event');
    return;
  }

  console.log(`User ${userId} lost subscription access`);
  
  // Handle subscription cancellation/expiration if needed
} 