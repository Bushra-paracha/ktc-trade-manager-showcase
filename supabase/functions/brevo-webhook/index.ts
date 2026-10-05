// Supabase Edge Function: brevo-webhook
//
// Receives webhook events from Brevo (delivered, opened, click, hard_bounce,
// soft_bounce, etc.) and updates the corresponding row in email_messages.
//
// Set this function's URL as the webhook endpoint in Brevo:
// Brevo Dashboard -> Settings -> Webhooks -> Add a webhook
// URL: https://<your-project-ref>.supabase.co/functions/v1/brevo-webhook
// Events to enable: Delivered, Opened, Click, Hard bounce, Soft bounce, Spam

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Maps Brevo event names to email_messages columns/status values.
// Brevo has used both snake_case (hard_bounce) and camelCase (hardBounce)
// naming across API versions, so both are mapped here for safety.
const EVENT_MAP = {
  delivered: { status: 'Delivered', timestampField: 'delivered_at' },
  opened: { status: 'Opened', timestampField: 'opened_at', countField: 'open_count' },
  uniqueOpened: { status: 'Opened', timestampField: 'opened_at', countField: 'open_count' },
  click: { status: 'Clicked', timestampField: 'clicked_at', countField: 'click_count' },
  hard_bounce: { status: 'Bounced', timestampField: 'bounced_at', captureReason: true },
  hardBounce: { status: 'Bounced', timestampField: 'bounced_at', captureReason: true },
  soft_bounce: { status: 'Bounced', timestampField: 'bounced_at', captureReason: true },
  softBounce: { status: 'Bounced', timestampField: 'bounced_at', captureReason: true },
  blocked: { status: 'Bounced', timestampField: 'bounced_at', captureReason: true },
  invalid: { status: 'Bounced', timestampField: 'bounced_at', captureReason: true },
  spam: { status: 'Bounced', timestampField: 'bounced_at', captureReason: true },
  error: { status: 'Bounced', timestampField: 'bounced_at', captureReason: true },
};

// Status priority — don't downgrade a "better" status to a "worse" one
// e.g. if already Clicked, a later "delivered" event shouldn't revert it to Delivered
const STATUS_RANK = {
  Pending: 0,
  Sent: 1,
  Delivered: 2,
  Opened: 3,
  Clicked: 4,
  Replied: 5,
  Bounced: 6,
  Failed: 6,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    // Brevo sends either a single event object or an array, depending on config
    const events = Array.isArray(payload) ? payload : [payload];

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const results = [];

    for (const event of events) {
      const brevoMessageId = event['message-id'] || event.messageId || event['X-Mailin-custom'];
      const eventType = event.event; // e.g. "delivered", "opened", "click", "hard_bounce"

      if (!brevoMessageId || !eventType) {
        results.push({ skipped: true, reason: 'missing message-id or event', event });
        continue;
      }

      const mapping = EVENT_MAP[eventType];
      if (!mapping) {
        results.push({ skipped: true, reason: `unhandled event type: ${eventType}` });
        continue;
      }

      // Find the matching message row
      const { data: existing, error: findError } = await supabase
        .from('email_messages')
        .select('id, status, open_count, click_count, to_email')
        .eq('brevo_message_id', brevoMessageId)
        .maybeSingle();

      if (findError || !existing) {
        results.push({ skipped: true, reason: 'no matching message found', brevoMessageId });
        continue;
      }

      const update = {};

      // Only update status if the new status is "higher rank" (more advanced in funnel)
      const currentRank = STATUS_RANK[existing.status] ?? 0;
      const newRank = STATUS_RANK[mapping.status] ?? 0;
      if (newRank >= currentRank) {
        update.status = mapping.status;
      }

      if (mapping.timestampField) {
        update[mapping.timestampField] = new Date().toISOString();
      }

      if (mapping.countField) {
        update[mapping.countField] = (existing[mapping.countField] || 0) + 1;
      }

      if (mapping.captureReason) {
        // Brevo includes the failure reason under different keys depending
        // on the event/version; check the common ones and fall back gracefully.
        const reason = event.reason || event.error || event.details || event['tag'] || null;
        if (reason) {
          update.bounce_reason = String(reason);
        } else {
          update.bounce_reason = `${eventType} (no detailed reason provided by Brevo)`;
        }
      }

      const { error: updateError } = await supabase
        .from('email_messages')
        .update(update)
        .eq('id', existing.id);

      // Permanently undeliverable or complained: never email this address again
      // from the automations. (Soft bounces are temporary and are not suppressed.)
      const SUPPRESS_EVENTS = { hard_bounce: 'hard_bounce', hardBounce: 'hard_bounce', invalid: 'hard_bounce', blocked: 'hard_bounce', spam: 'spam' };
      const suppressReason = SUPPRESS_EVENTS[eventType];
      const toEmail = String(existing.to_email || event.email || '').trim().toLowerCase();
      if (suppressReason && toEmail.includes('@')) {
        await supabase.from('email_suppressions')
          .upsert({ email: toEmail, reason: suppressReason }, { onConflict: 'email', ignoreDuplicates: true });
        await supabase.from('email_sequence_enrollments')
          .update({ status: 'Stopped', stop_reason: suppressReason, updated_at: new Date().toISOString() })
          .eq('to_email', toEmail)
          .eq('status', 'Active');
      }

      results.push({ updated: !updateError, messageId: existing.id, eventType, error: updateError?.message });
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
