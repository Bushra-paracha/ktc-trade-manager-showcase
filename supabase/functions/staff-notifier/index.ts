// Supabase Edge Function: staff-notifier
//
// Called every 10 minutes by pg_cron (migration 202609270030).
//   1. Queues overdue-reply alerts and daily digests (database functions)
//   2. Sends due buyer_notifications (shipment update emails, migration 202609270041);
//      content is built at send time by shipment_email_content() and each email is
//      recorded in email_messages so Brevo tracking and the buyer timeline see it
//   3. Sends pending staff_notifications:
//      - email through Brevo (always available)
//      - WhatsApp through approved Meta templates (skipped, not retried, while a
//        template is missing or the Meta token is invalid; email still goes out)
//
// Each staff member chooses channels, digest hour and time zone in Settings.
//
// Secrets: BREVO_API_KEY, META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: STAFF_NOTIFY_SENDER (default exports@example.com)
// Deploy:  supabase functions deploy staff-notifier --no-verify-jwt
//          (auth: x-automation-secret header from Vault, or a signed-in Admin / Owner)
//
// Meta templates (category Utility, English), body text with numbered variables:
//   ktc_new_inquiry       New inquiry for Kassam Trading: {{1}} ({{2}}) via {{3}}. Interest: {{4}}. Please reply by {{5}}.
//   ktc_buyer_message     {{1}} sent a new {{2}} message: {{3}}. Open KTC Trade Manager to reply.
//   ktc_followup_overdue  Reminder: the reply to {{1}} ({{2}}) was due {{3}} and is still open.
//   ktc_daily_digest      KTC today: {{1}} new inquiries, {{2}} replies overdue, {{3}} buyers to follow up,
//                         {{4}} orders to update, {{5}} shipments due soon, {{6}} messages to check.
//   ktc_enquiry_review    New enquiry to review: {{1}} ({{2}}) via {{3}}. Interest: {{4}}. Open KTC Trade Manager to approve or reject.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const META_TOKEN = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')?.trim() ?? '';
const META_PHONE_ID = Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID')?.trim() ?? '';
const SENDER = Deno.env.get('STAFF_NOTIFY_SENDER') || 'exports@example.com';
// Buyer replies to shipment emails go here.
const REPLY_TO_EMAIL = Deno.env.get('REPLY_TO_EMAIL') || 'outreach@example.com';

const GRAPH = 'https://graph.facebook.com/v23.0';
// WhatsApp Business Account that owns the templates (set META_WHATSAPP_BUSINESS_ACCOUNT_ID for a new number).
const WABA_ID = Deno.env.get('META_WHATSAPP_BUSINESS_ACCOUNT_ID')?.trim() || '1308239590982353';
const MAX_ATTEMPTS = 3;
const BATCH = 60;

const TEMPLATES: Record<string, string> = {
  new_inquiry: 'ktc_new_inquiry',
  buyer_message: 'ktc_buyer_message',
  followup_overdue: 'ktc_followup_overdue',
  daily_digest: 'ktc_daily_digest',
  enquiry_review: 'ktc_enquiry_review',
};

type Job = {
  id: string;
  channel: 'email' | 'whatsapp';
  kind: string;
  recipient: string;
  subject: string;
  body: string;
  template_params: unknown[];
  attempts: number;
};

type WhatsAppState = {
  error: string | null;
  templates: Map<string, { status: string; language: string }>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Meta rejects template values with new lines, tabs or 4+ spaces in a row.
function templateValue(value: unknown) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return (text || '-').slice(0, 900);
}

async function authorised(req: Request, db: SupabaseClient) {
  const { data: secret } = await db.rpc('ktc_automation_secret');
  if (secret && req.headers.get('x-automation-secret') === secret) return true;
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth?.user) return false;
  const { data: profile } = await db.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
  return profile?.role === 'Admin / Owner';
}

async function loadWhatsApp(): Promise<WhatsAppState> {
  const templates = new Map<string, { status: string; language: string }>();
  if (!META_TOKEN || !META_PHONE_ID) return { error: 'Meta WhatsApp is not configured', templates };
  try {
    const res = await fetch(`${GRAPH}/${WABA_ID}/message_templates?fields=name,status,language&limit=200`, {
      headers: { Authorization: `Bearer ${META_TOKEN}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: `Meta ${res.status}: ${body?.error?.message ?? 'request failed'}`, templates };
    for (const t of body?.data ?? []) {
      if (Object.values(TEMPLATES).includes(t.name)) templates.set(t.name, { status: t.status, language: t.language });
    }
    return { error: null, templates };
  } catch (err) {
    return { error: `Meta unreachable: ${err instanceof Error ? err.message : String(err)}`, templates };
  }
}

async function sendWhatsApp(job: Job, wa: WhatsAppState) {
  const name = TEMPLATES[job.kind];
  const template = wa.templates.get(name);
  if (wa.error) return { skipped: wa.error };
  if (!template || template.status !== 'APPROVED') {
    return { skipped: `Template ${name} is ${template ? template.status.toLowerCase() : 'not created'} in Meta` };
  }
  const res = await fetch(`${GRAPH}/${META_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: job.recipient.replace(/\D/g, ''),
      type: 'template',
      template: {
        name,
        language: { code: template.language },
        components: [{
          type: 'body',
          parameters: (Array.isArray(job.template_params) ? job.template_params : [])
            .map((value) => ({ type: 'text', text: templateValue(value) })),
        }],
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta ${res.status}: ${body?.error?.message ?? 'send failed'}`);
  return { sent: true };
}

async function sendEmail(job: Job) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY is not configured');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1F2A24">
<p>${escapeHtml(job.body).replace(/\n/g, '<br>')}</p>
<p style="color:#97A199;font-size:12px;margin-top:24px">KTC Trade Manager · change these alerts in Settings → My notifications</p>
</div>`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: SENDER, name: 'KTC Trade Manager' },
      to: [{ email: job.recipient }],
      subject: job.subject,
      htmlContent: html,
      textContent: `${job.body}\n\nKTC Trade Manager`,
      tags: ['ktc-trade-manager', 'staff-notification', job.kind],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${body?.message ?? 'send failed'}`);
  return { sent: true };
}

// Buyer-facing transactional email (shipment updates). Returns the email_messages id.
async function sendBuyerEmail(db: SupabaseClient, content: Record<string, string>) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY is not configured');
  const { data: row, error: insertError } = await db
    .from('email_messages')
    .insert([{
      client_id: content.client_id ?? null,
      to_email: content.to,
      to_name: content.to_name ?? null,
      subject: content.subject,
      body_html: content.html,
      sender_email: content.sender_email,
      status: 'Pending',
      automation_kind: 'transactional',
    }])
    .select('id')
    .single();
  if (insertError || !row) throw new Error(`Could not record message: ${insertError?.message}`);

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: content.sender_email, name: content.sender_name },
      to: [{ email: content.to, name: content.to_name || undefined }],
      replyTo: { email: REPLY_TO_EMAIL },
      subject: content.subject,
      htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1F2A24">${content.html}</div>`,
      tags: ['ktc-trade-manager', 'buyer-transactional'],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    await db.from('email_messages').update({ status: 'Failed', bounce_reason: JSON.stringify(body).slice(0, 500) }).eq('id', row.id);
    throw new Error(`Brevo ${res.status}: ${body?.message ?? 'send failed'}`);
  }
  await db.from('email_messages')
    .update({ status: 'Sent', sent_at: new Date().toISOString(), brevo_message_id: body?.messageId ?? null, delivery_provider: 'brevo' })
    .eq('id', row.id);
  return row.id as string;
}

async function sendBuyerNotifications(db: SupabaseClient) {
  const counts = { sent: 0, failed: 0, skipped: 0 };
  const { data: due } = await db
    .from('buyer_notifications')
    .select('id, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(20);

  for (const item of due ?? []) {
    const { data: claimed } = await db
      .from('buyer_notifications')
      .update({ attempts: item.attempts + 1 })
      .eq('id', item.id)
      .eq('attempts', item.attempts)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    try {
      const { data: content, error } = await db.rpc('shipment_email_content', { p_notification_id: item.id });
      if (error) throw new Error(error.message);
      if (!content || content.skip) {
        counts.skipped++;
        await db.from('buyer_notifications').update({ status: 'skipped', last_error: content?.skip ?? 'no content' }).eq('id', item.id);
        continue;
      }
      const messageId = await sendBuyerEmail(db, content);
      counts.sent++;
      await db.from('buyer_notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString(), email_message_id: messageId, last_error: null })
        .eq('id', item.id);
    } catch (err) {
      counts.failed++;
      await db.from('buyer_notifications')
        .update({ status: 'failed', last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
        .eq('id', item.id);
    }
  }
  return counts;
}

Deno.serve(async (req) => {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!(await authorised(req, db))) return json({ error: 'Unauthorized' }, 401);

  const queued: Record<string, unknown> = {};
  for (const fn of ['queue_overdue_followups', 'queue_daily_digests']) {
    const { data, error } = await db.rpc(fn);
    queued[fn] = error ? `error: ${error.message}` : data;
  }

  const buyerEmails = await sendBuyerNotifications(db);

  const { data: jobs, error } = await db
    .from('staff_notifications')
    .select('id, channel, kind, recipient, subject, body, template_params, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH);
  if (error) return json({ error: error.message, queued }, 500);

  let wa: WhatsAppState | null = null;
  const counts = { sent: 0, failed: 0, skipped: 0 };

  for (const job of (jobs ?? []) as Job[]) {
    const { data: claimed } = await db
      .from('staff_notifications')
      .update({ attempts: job.attempts + 1 })
      .eq('id', job.id)
      .eq('attempts', job.attempts)
      .select('id')
      .maybeSingle();
    if (!claimed) continue; // another run picked it up

    try {
      let result: { sent?: boolean; skipped?: string };
      if (job.channel === 'whatsapp') {
        wa ??= await loadWhatsApp();
        result = await sendWhatsApp(job, wa);
      } else {
        result = await sendEmail(job);
      }
      if (result.skipped) {
        counts.skipped++;
        await db.from('staff_notifications').update({ status: 'skipped', last_error: result.skipped }).eq('id', job.id);
      } else {
        counts.sent++;
        await db.from('staff_notifications')
          .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
      }
    } catch (err) {
      counts.failed++;
      await db.from('staff_notifications')
        .update({ status: 'failed', last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
        .eq('id', job.id);
    }
  }

  return json({
    ok: true,
    queued,
    buyerEmails,
    ...counts,
    whatsapp: wa && {
      error: wa.error,
      templates: Object.fromEntries(Object.values(TEMPLATES).map((name) => [name, wa!.templates.get(name)?.status ?? 'missing'])),
    },
  });
});
