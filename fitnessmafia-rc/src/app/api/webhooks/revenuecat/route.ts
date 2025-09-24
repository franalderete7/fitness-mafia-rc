import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Environment variables (replace with your actual values)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://whjbyzeaiwnsxxsexiir.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoamJ5emVhaXduc3h4c2V4aWlyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODIyNzExMywiZXhwIjoyMDczODAzMTEzfQ.VuBfJNbj6YZ87dHRGInT6Qs70ecnW_IrRPShFZsAdSQ';
const REVENUECAT_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoamJ5emVhaXduc3h4c2V4aWlyIiwicm9s';

// Initialize Supabase client with service key for full access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// RevenueCat webhook event types
type RevenueCatEventType = 
  | 'TEST'
  | 'INITIAL_PURCHASE'
  | 'RENEWAL' 
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'NON_RENEWING_PURCHASE'
  | 'SUBSCRIPTION_PAUSED'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE'
  | 'TRANSFER'
  | 'SUBSCRIPTION_EXTENDED'
  | 'TEMPORARY_ENTITLEMENT_GRANT'
  | 'REFUND_REVERSED'
  | 'INVOICE_ISSUANCE'
  | 'VIRTUAL_CURRENCY_TRANSACTION';

interface RevenueCatEvent {
  type: RevenueCatEventType;
  id: string;
  app_id: string;
  app_user_id: string;
  original_app_user_id: string;
  event_timestamp_ms: number;
  product_id?: string;
  entitlement_ids?: string[];
  entitlement_id?: string; // deprecated but might still be present
  period_type?: 'TRIAL' | 'INTRO' | 'NORMAL' | 'PROMOTIONAL' | 'PREPAID';
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  store: 'APP_STORE' | 'PLAY_STORE' | 'AMAZON' | 'PROMOTIONAL' | 'STRIPE' | 'MAC_APP_STORE';
  environment: 'SANDBOX' | 'PRODUCTION';
  transaction_id?: string;
  original_transaction_id?: string;
  cancel_reason?: 'UNSUBSCRIBE' | 'BILLING_ERROR' | 'DEVELOPER_INITIATED' | 'PRICE_INCREASE' | 'CUSTOMER_SUPPORT' | 'UNKNOWN';
  expiration_reason?: 'UNSUBSCRIBE' | 'BILLING_ERROR' | 'DEVELOPER_INITIATED' | 'PRICE_INCREASE' | 'CUSTOMER_SUPPORT' | 'UNKNOWN' | 'SUBSCRIPTION_PAUSED';
  grace_period_expiration_at_ms?: number | null;
  auto_resume_at_ms?: number | null;
  is_trial_conversion?: boolean;
  new_product_id?: string;
  presented_offering_id?: string;
  price?: number;
  currency?: string;
  price_in_purchased_currency?: number;
  tax_percentage?: number;
  commission_percentage?: number;
  takehome_percentage?: number;
  country_code?: string;
  offer_code?: string;
  is_family_share?: boolean;
  transferred_from?: string[];
  transferred_to?: string[];
  renewal_number?: number;
  aliases?: string[];
  subscriber_attributes?: Record<string, any>;
}

interface RevenueCatWebhook {
  api_version: string;
  event: RevenueCatEvent;
}

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = crypto
      .createHmac('sha1', secret)
      .update(payload)
      .digest('hex');
    
    // RevenueCat sends signature in format "sha1=<hash>"
    const formattedExpected = `sha1=${expectedSignature}`;
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(formattedExpected)
    );
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}

// Get raw body as string for signature verification
async function getRawBody(request: Request): Promise<string> {
  return request.text();
}

// Handle subscription events
async function handleSubscriptionEvent(event: RevenueCatEvent): Promise<void> {
  const {
    type,
    app_user_id,
    product_id,
    entitlement_ids,
    entitlement_id,
    store,
    purchased_at_ms,
    expiration_at_ms,
    period_type,
    transaction_id,
    original_transaction_id,
    cancel_reason,
    expiration_reason,
    grace_period_expiration_at_ms,
    id: event_id,
    event_timestamp_ms
  } = event;

  // Use entitlement_ids if available, fallback to deprecated entitlement_id
  const entitlements = entitlement_ids || (entitlement_id ? [entitlement_id] : []);
  
  if (!product_id || entitlements.length === 0) {
    console.log('Skipping event - missing product_id or entitlements:', type);
    return;
  }

  // Process each entitlement
  for (const entitlementId of entitlements) {
    await processSubscriptionEntitlement({
      event,
      app_user_id,
      product_id,
      entitlement_id: entitlementId,
      store,
      event_id,
      event_timestamp_ms
    });
  }
}

interface ProcessSubscriptionParams {
  event: RevenueCatEvent;
  app_user_id: string;
  product_id: string;
  entitlement_id: string;
  store: string;
  event_id: string;
  event_timestamp_ms: number;
}

async function processSubscriptionEntitlement({
  event,
  app_user_id,
  product_id,
  entitlement_id,
  store,
  event_id,
  event_timestamp_ms
}: ProcessSubscriptionParams): Promise<void> {
  const {
    type,
    purchased_at_ms,
    expiration_at_ms,
    period_type,
    transaction_id,
    original_transaction_id,
    cancel_reason,
    expiration_reason,
    grace_period_expiration_at_ms
  } = event;

  try {
    // Check if subscription record already exists
    const { data: existingSubscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('app_user_id', app_user_id)
      .eq('entitlement_id', entitlement_id)
      .single();

    const now = new Date();
    const purchasedAt = purchased_at_ms ? new Date(purchased_at_ms) : null;
    const expiresAt = expiration_at_ms ? new Date(expiration_at_ms) : null;
    
    // Determine subscription status based on event type
    let isActive = false;
    let willRenew: boolean | null = null;
    let cancelledAt: Date | null = null;

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
        isActive = expiresAt ? expiresAt > now : true;
        willRenew = true;
        cancelledAt = null;
        break;
        
      case 'CANCELLATION':
        // User cancelled but subscription may still be active until expiration
        isActive = expiresAt ? expiresAt > now : false;
        willRenew = false;
        cancelledAt = now;
        break;
        
      case 'EXPIRATION':
        isActive = false;
        willRenew = false;
        break;
        
      case 'BILLING_ISSUE':
        // Check if in grace period
        const graceExpiry = grace_period_expiration_at_ms ? new Date(grace_period_expiration_at_ms) : null;
        isActive = graceExpiry ? graceExpiry > now : false;
        willRenew = true; // Still attempting to renew
        break;
        
      case 'SUBSCRIPTION_PAUSED':
        isActive = false;
        willRenew = true; // Will resume later
        break;
        
      default:
        // For other event types, determine based on expiration
        isActive = expiresAt ? expiresAt > now : false;
        willRenew = isActive;
    }

    const subscriptionData = {
      app_user_id,
      entitlement_id,
      product_id,
      store: store.toLowerCase(),
      is_active: isActive,
      will_renew: willRenew,
      period_type: period_type?.toLowerCase() || null,
      original_purchase_at: purchasedAt,
      latest_purchase_at: (type === 'INITIAL_PURCHASE' || type === 'RENEWAL') ? purchasedAt : undefined,
      expires_at: expiresAt,
      cancelled_at: cancelledAt,
      rc_subscriber_id: app_user_id,
      rc_event_id: event_id,
      last_event_type: type,
      last_event_at: new Date(event_timestamp_ms),
      raw_event: event,
      updated_at: now
    };

    if (existingSubscription) {
      // Update existing subscription
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update(subscriptionData)
        .eq('id', existingSubscription.id);

      if (updateError) {
        throw updateError;
      }
    } else {
      // Create new subscription record
      const { error: insertError } = await supabase
        .from('subscriptions')
        .insert({
          ...subscriptionData,
          created_at: now
        });

      if (insertError) {
        throw insertError;
      }
    }

    // Update user's premium status
    await updateUserPremiumStatus(app_user_id);

    console.log(`Successfully processed ${type} event for user ${app_user_id}, entitlement ${entitlement_id}`);

  } catch (error) {
    console.error(`Error processing subscription for user ${app_user_id}:`, error);
    throw error;
  }
}

async function updateUserPremiumStatus(app_user_id: string): Promise<void> {
  try {
    // Get all active subscriptions for the user
    const { data: activeSubscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('app_user_id', app_user_id)
      .eq('is_active', true)
      .order('expires_at', { ascending: false });

    if (subsError) {
      throw subsError;
    }

    // Determine premium status
    const hasActiveSubscription = activeSubscriptions && activeSubscriptions.length > 0;
    let premiumExpiresAt: Date | null = null;
    let premiumWillRenew: boolean | null = null;

    if (hasActiveSubscription) {
      // Get the subscription with the latest expiration date
      const latestSubscription = activeSubscriptions[0];
      premiumExpiresAt = latestSubscription.expires_at ? new Date(latestSubscription.expires_at) : null;
      premiumWillRenew = latestSubscription.will_renew;
    }

    // Update user record
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({
        is_premium: hasActiveSubscription,
        premium_expires_at: premiumExpiresAt,
        premium_will_renew: premiumWillRenew,
        updated_at: new Date()
      })
      .eq('app_user_id', app_user_id);

    if (userUpdateError) {
      // If user doesn't exist in users table, log a warning but don't throw
      console.warn(`Could not update user premium status for ${app_user_id}:`, userUpdateError);
    }

  } catch (error) {
    console.error(`Error updating user premium status for ${app_user_id}:`, error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    // Get raw body for signature verification
    const rawBody = await getRawBody(request);

    // Verify webhook signature
    const signature = request.headers.get('x-revenuecat-signature');
    if (!signature) {
      console.error('Missing RevenueCat signature header');
      return Response.json({ error: 'Missing signature' }, { status: 401 });
    }

    if (!verifyWebhookSignature(rawBody, signature, REVENUECAT_WEBHOOK_SECRET)) {
      console.error('Invalid webhook signature');
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Parse the webhook payload
    const webhook: RevenueCatWebhook = JSON.parse(rawBody);
    const { event } = webhook;

    console.log(`Received RevenueCat webhook: ${event.type} for user ${event.app_user_id}`);

    // Handle different event types
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'CANCELLATION':
      case 'UNCANCELLATION':
      case 'EXPIRATION':
      case 'BILLING_ISSUE':
      case 'SUBSCRIPTION_PAUSED':
      case 'PRODUCT_CHANGE':
        await handleSubscriptionEvent(event);
        break;

      case 'TEST':
        console.log('Received test webhook from RevenueCat');
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return Response.json({
      success: true,
      message: `Processed ${event.type} event`
    });

  } catch (error) {
    console.error('Error processing RevenueCat webhook:', error);
    return Response.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}