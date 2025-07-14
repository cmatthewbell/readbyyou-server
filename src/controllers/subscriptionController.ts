import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { 
  findUserByRevenueCatId,
  activateSubscription,
  deactivateSubscription,
  extendSubscription
} from '../utils/subscriptionHelpers';

// Interface for RevenueCat webhook event structure
interface RevenueCatWebhookEvent {
  api_version: string;
  event: {
    id: string;
    type: string;
    event_timestamp_ms: number;
    app_user_id: string;
    original_app_user_id: string;
    aliases: string[];
    environment: 'SANDBOX' | 'PRODUCTION';
    store: string;
    product_id?: string;
    entitlement_ids?: string[];
    purchased_at_ms?: number;
    expiration_at_ms?: number;
    grace_period_expiration_at_ms?: number;
    cancellation_reason?: string;
    is_trial_conversion?: boolean;
    price?: number;
    currency?: string;
    subscriber_attributes?: Record<string, any>;
    transaction_id?: string;
    original_transaction_id?: string;
  };
}

// Set to track processed webhook events (prevents duplicates)
const processedEvents = new Set<string>();

// POST /webhooks/revenuecat - Handle RevenueCat webhook events
export const handleRevenueCatWebhook = asyncHandler(async (req: Request, res: Response) => {
  // 1. Verify webhook authentication
  const authHeader = req.headers.authorization;
  const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
  
  if (!authHeader || !expectedAuth || authHeader !== expectedAuth) {
    console.error('RevenueCat webhook: Invalid authorization header');
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  // 2. Validate webhook payload
  const webhookData: RevenueCatWebhookEvent = req.body;
  
  if (!webhookData.event || !webhookData.event.id || !webhookData.event.type || !webhookData.event.app_user_id) {
    console.error('RevenueCat webhook: Invalid payload structure');
    return res.status(400).json({
      success: false,
      message: 'Invalid webhook payload'
    });
  }

  const { event } = webhookData;
  
  // 3. Prevent duplicate event processing
  if (processedEvents.has(event.id)) {
    console.log(`RevenueCat webhook: Event ${event.id} already processed, skipping`);
    return res.status(200).json({
      success: true,
      message: 'Event already processed'
    });
  }

  try {
    // 4. Find user by RevenueCat user ID
    const user = await findUserByRevenueCatId(event.app_user_id);
    
    if (!user) {
      console.error(`RevenueCat webhook: User not found for app_user_id: ${event.app_user_id}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // 5. Handle different event types
    console.log(`Processing RevenueCat event: ${event.type} for user: ${user.id}`);
    
    switch (event.type) {
      case 'INITIAL_PURCHASE':
        await handleInitialPurchase(event, user.id);
        break;
        
      case 'RENEWAL':
        await handleRenewal(event, user.id);
        break;
        
      case 'PRODUCT_CHANGE':
        await handleProductChange(event, user.id);
        break;
        
      case 'CANCELLATION':
        await handleCancellation(event, user.id);
        break;
        
      case 'EXPIRATION':
        await handleExpiration(event, user.id);
        break;
        
      case 'BILLING_ISSUE':
        await handleBillingIssue(event, user.id);
        break;
        
      default:
        console.log(`RevenueCat webhook: Unhandled event type: ${event.type}`);
    }

    // 6. Mark event as processed
    processedEvents.add(event.id);

    // 7. Return success response (RevenueCat retries on non-2xx)
    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });

  } catch (error: any) {
    console.error('RevenueCat webhook processing error:', error);
    return res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

// Helper function to handle initial purchase
async function handleInitialPurchase(event: RevenueCatWebhookEvent['event'], userId: string) {
  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
  const planType = event.product_id;
  
  console.log(`User ${userId} made initial purchase: ${planType}`);
  
  await activateSubscription(event.app_user_id, expiresAt!, planType);
}

// Helper function to handle renewal
async function handleRenewal(event: RevenueCatWebhookEvent['event'], userId: string) {
  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
  const planType = event.product_id;
  
  console.log(`User ${userId} renewed subscription: ${planType}`);
  
  await extendSubscription(event.app_user_id, expiresAt!, planType);
}

// Helper function to handle product change
async function handleProductChange(event: RevenueCatWebhookEvent['event'], userId: string) {
  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
  const planType = event.product_id;
  
  console.log(`User ${userId} changed product: ${planType}`);
  
  await activateSubscription(event.app_user_id, expiresAt!, planType);
}

// Helper function to handle cancellation
async function handleCancellation(event: RevenueCatWebhookEvent['event'], userId: string) {
  console.log(`User ${userId} cancelled subscription. Reason: ${event.cancellation_reason}`);
  
  // Note: User may still have access until expiration_at_ms
  // We don't deactivate immediately on cancellation
  console.log(`Subscription will remain active until: ${event.expiration_at_ms ? new Date(event.expiration_at_ms) : 'N/A'}`);
}

// Helper function to handle expiration
async function handleExpiration(event: RevenueCatWebhookEvent['event'], userId: string) {
  console.log(`User ${userId} subscription expired`);
  
  await deactivateSubscription(event.app_user_id);
}

// Helper function to handle billing issues
async function handleBillingIssue(event: RevenueCatWebhookEvent['event'], userId: string) {
  console.log(`User ${userId} has billing issue`);
  
  // Keep subscription active during grace period if it exists
  const gracePeriodEnd = event.grace_period_expiration_at_ms ? new Date(event.grace_period_expiration_at_ms) : null;
  
  if (gracePeriodEnd && gracePeriodEnd > new Date()) {
    console.log(`User ${userId} still in grace period until: ${gracePeriodEnd}`);
    // Keep subscription active
  } else {
    console.log(`User ${userId} grace period expired or not available, deactivating subscription`);
    await deactivateSubscription(event.app_user_id);
  }
} 