// Supabase Edge Function: send-whatsapp-outbox
//
// Sends buyer WhatsApp messages queued in public.whatsapp_outbox (migration 202610020001):
// the greeting + form link for new enquiries, "we received your enquiry", and the
// approval hand-off to the Director. Called every minute by pg_cron (ktc-whatsapp-outbox).
//
// Meta only allows free-text messages within 24 hours of the buyer's last message
// (customer service window). Inside the window the text is sent as is; outside it the
// row's approved template is used (e.g. ktc_enquiry_approved), otherwise the row is
// marked needs_template so staff can send it from the WhatsApp Business app.
//
// Also queues staff alerts for WhatsApp enquiries whose form is still empty after 2 hours.
//
// Secrets: META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID (the WhatsApp Business number),
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Auth:    x-automation-secret header (Vault ktc_automation_secret) or a signed-in Admin / Owner
// Deploy:  supabase functions deploy send-whatsapp-outbox --no-verify-jwt
//
// Meta template (category Utility, English), body text:
//   ktc_enquiry_approved  Hello {{1}}, your enquiry {{2}} with Kassam Trading Company has been reviewed.
//                         Please message our Director, {{3}}, directly on WhatsApp at {{4}} to discuss
//                         pricing and shipment details.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const META_TOKEN = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')?.trim() ?? '';
const META_PHONE_ID = Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID')?.trim() ?? '';
const GRAPH = 'https://graph.facebook.com/v23.0';
const MAX_ATTEMPTS = 3;
const BATCH = 30;
const WINDOW_MS = 24 * 60 * 60 * 1000;

type Job = {
  id: string;
  to_phone: string;
  kind: string;
  body: string;
  template_name: string | null;
  template_params: unknown[];
  enquiry_id: string | null;
  attempts: number;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const digits = (value: string) => value.replace(/\D/g, '');

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

// Latest message we received from this number (free text is allowed for 24 h after it).
async function lastInbound(db: SupabaseClient, phone: string) {
  const d = digits(phone);
  const { data } = await db.from('inbound_whatsapp').select('from_phone, received_at')
    .order('received_at', { ascending: false }).limit(200)
    .like('from_phone', `%${d.slice(-9)}`);
  const match = (data ?? []).find((row: { from_phone: string }) => digits(row.from_phone) === d);
  return match ? new Date(match.received_at).getTime() : 0;
}

async function send(job: Job, inWindow: boolean) {
  const payload = inWindow
    ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(job.to_phone), type: 'text',
        text: { preview_url: true, body: job.body.slice(0, 4096) } }
    : { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(job.to_phone), type: 'template',
        template: {
          name: job.template_name, language: { code: 'en' },
          components: [{ type: 'body', parameters: (Array.isArray(job.template_params) ? job.template_params : [])
            .map((value) => ({ type: 'text', text: templateValue(value) })) }],
        } };
  const res = await fetch(`${GRAPH}/${META_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.error?.code;
    // 132001 template missing / not approved; 131047 outside the 24-hour window.
    const needsTemplate = code === 132001 || code === 131047;
    throw Object.assign(new Error(`Meta ${res.status}: ${body?.error?.message ?? 'request failed'}`), { needsTemplate });
  }
  return body?.messages?.[0]?.id as string | undefined;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!(await authorised(req, db))) return json({ error: 'Not authorised' }, 401);

  const { data: staleAlerts } = await db.rpc('queue_stale_enquiry_alerts');

  if (!META_TOKEN || !META_PHONE_ID) {
    return json({ skipped: 'Meta WhatsApp is not configured yet; messages stay queued', staleAlerts });
  }

  const { data: jobs, error } = await db.from('whatsapp_outbox')
    .select('id, to_phone, kind, body, template_name, template_params, enquiry_id, attempts')
    .in('status', ['pending', 'failed']).lt('attempts', MAX_ATTEMPTS)
    .lte('scheduled_for', new Date().toISOString())
    .order('created_at').limit(BATCH);
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  const needTemplate: string[] = [];
  for (const job of (jobs ?? []) as Job[]) {
    const { data: claimed } = await db.from('whatsapp_outbox')
      .update({ attempts: job.attempts + 1, status: 'failed', last_error: 'sending' })
      .eq('id', job.id).eq('attempts', job.attempts).select('id').maybeSingle(); // one sender per row
    if (!claimed) continue;

    const inWindow = Date.now() - (await lastInbound(db, job.to_phone)) < WINDOW_MS;
    if (!inWindow && !job.template_name) {
      await db.from('whatsapp_outbox').update({
        status: 'needs_template',
        last_error: 'More than 24 hours since the buyer last wrote; send it from the WhatsApp Business app.',
      }).eq('id', job.id);
      needTemplate.push(job.id);
      continue;
    }

    try {
      const waId = await send(job, inWindow);
      await db.from('whatsapp_outbox').update({
        status: 'sent', sent_at: new Date().toISOString(), wa_message_id: waId ?? null, last_error: null,
      }).eq('id', job.id);
      sent += 1;

      // Buyer timeline once the enquiry has become a CRM buyer.
      if (job.enquiry_id) {
        const { data: enquiry } = await db.from('enquiry_reviews').select('client_id, inquiry_id')
          .eq('id', job.enquiry_id).maybeSingle();
        if (enquiry?.client_id) {
          await db.rpc('log_interaction', {
            p_client_id: enquiry.client_id, p_inquiry_id: enquiry.inquiry_id, p_channel: 'whatsapp',
            p_direction: 'out', p_summary: `WhatsApp sent: ${job.body.slice(0, 180)}`, p_detail: job.body,
            p_source_table: 'whatsapp_outbox', p_source_id: job.id,
          });
        }
      }
    } catch (err) {
      const e = err as Error & { needsTemplate?: boolean };
      const last = job.attempts + 1 >= MAX_ATTEMPTS;
      await db.from('whatsapp_outbox').update({
        status: e.needsTemplate ? 'needs_template' : 'failed',
        last_error: e.message.slice(0, 500),
        scheduled_for: new Date(Date.now() + (last ? 0 : (job.attempts + 1) * 5 * 60 * 1000)).toISOString(),
      }).eq('id', job.id);
      if (e.needsTemplate) needTemplate.push(job.id);
    }
  }

  return json({ processed: jobs?.length ?? 0, sent, needTemplate: needTemplate.length, staleAlerts });
});
