// Supabase Edge Function: run-email-automation
//
// Called every 10 minutes by pg_cron (see migration 202609270001).
//   1. Sends due steps of active sequences (new-lead drip, website-inquiry auto-reply)
//   2. Queues monthly broadcasts that are due AND approved
//   3. Drains the broadcast queue
// Everything goes through Brevo, respects email_suppressions, stops a sequence
// when the lead replies / bounces / moves on in the CRM, and never exceeds
// DAILY_SEND_LIMIT Brevo sends per day (default 80, sized for the 10,000-credit
// Starter plan running Sep 2026 – Jan 2027; raise it if you buy more credits).
//
// Secrets: BREVO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the shared
// cron/unsubscribe secret is generated in Vault by the migration)
// Optional: DAILY_SEND_LIMIT
// Deploy:  supabase functions deploy run-email-automation --no-verify-jwt
//          (auth is enforced by the x-automation-secret header instead)

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Company mailbox used for one-to-one sequence emails (send_via = 'smtp'), e.g.
// exports@ on the cPanel mail server. Sent over SMTPS port 465 (Supabase blocks
// outbound 25 and 587). The email then sits in that mailbox's Sent folder.
const SMTP_HOST = (Deno.env.get('SMTP_HOST') ?? '').trim();
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') || '465');
const SMTP_USER = (Deno.env.get('SMTP_USER') ?? '').trim().toLowerCase();
const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD') ?? '';
const DAILY_SEND_LIMIT = Number(Deno.env.get('DAILY_SEND_LIMIT') || '80');
const PKT_OFFSET_HOURS = 5;
const RUN_BUDGET_MS = 100_000; // stay under the cron request timeout

// Shared secret lives in Supabase Vault (created by the migration); the
// service role reads it through the ktc_automation_secret() function.
let cachedSecret: string | null = null;
async function automationSecret(db: SupabaseClient): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const { data, error } = await db.rpc('ktc_automation_secret');
  if (error || !data) throw new Error(`Automation secret unavailable: ${error?.message ?? 'not found'}`);
  cachedSecret = String(data);
  return cachedSecret;
}

type Merge = {
  email: string;
  contact?: string | null;
  company?: string | null;
  country?: string | null;
  product?: string | null;
  quantity?: string | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const norm = (email?: string | null) => (email || '').trim().toLowerCase();

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function monthLabel(date = new Date()) {
  const pkt = new Date(date.getTime() + PKT_OFFSET_HOURS * 3600_000);
  return pkt.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function render(template: string, m: Merge, html: boolean) {
  const values: Record<string, string> = {
    contact: m.contact?.trim() || 'Sir/Madam',
    company: m.company?.trim() || 'your company',
    country: m.country?.trim() || '',
    product: m.product?.trim() || 'our products',
    quantity: m.quantity?.trim() || '',
    month: monthLabel(),
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => {
    if (!(key in values)) return whole;
    return html ? escapeHtml(values[key]) : values[key];
  });
}

async function unsubscribeToken(email: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(cachedSecret ?? ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(norm(email)));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function unsubscribeUrl(email: string) {
  const token = await unsubscribeToken(email);
  return `${SUPABASE_URL}/functions/v1/email-unsubscribe?e=${encodeURIComponent(norm(email))}&t=${token}`;
}

// Broadcasts are real marketing mail: full unsubscribe link + List-Unsubscribe header.
function withMarketingFooter(html: string, unsubUrl: string) {
  return `${html}
<p style="margin-top:28px;font-size:12px;color:#777">Kassam Trading Company, Port Qasim, Karachi, Pakistan.
If you would rather not receive these emails, <a href="${unsubUrl}" style="color:#777">unsubscribe here</a>.</p>`;
}

// Sequences are written as one-to-one business emails. Gmail sends mail that looks
// like bulk marketing (unsubscribe links, List-Unsubscribe headers, styled HTML,
// bullet lists) to the Promotions tab, so these go out as plain paragraphs with a
// plain-text opt-out that works by replying.
function withPersonalFooter(html: string) {
  return `${html}
<p>If you would prefer not to hear from us again, just reply "unsubscribe".</p>`;
}

// Plain-text alternative part; mail with only an HTML part looks more like a newsletter.
function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Replies like "unsubscribe" / "remove me" / "stop emailing" are honoured as opt-outs.
const OPT_OUT_REPLY = /\b(unsubscribe|remove me|stop (emailing|sending)|do not (email|contact)|not interested)\b/i;

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

class DailyCap {
  constructor(public remaining: number) {}
  get exhausted() { return this.remaining <= 0; }
}

async function sentTodayCount(db: SupabaseClient) {
  const pktNow = new Date(Date.now() + PKT_OFFSET_HOURS * 3600_000);
  const pktMidnightUtc = new Date(
    Date.UTC(pktNow.getUTCFullYear(), pktNow.getUTCMonth(), pktNow.getUTCDate()) - PKT_OFFSET_HOURS * 3600_000,
  );
  const { count } = await db
    .from('email_messages')
    .select('id', { count: 'exact', head: true })
    .in('delivery_provider', ['brevo', 'smtp'])
    .gte('sent_at', pktMidnightUtc.toISOString());
  return count ?? 0;
}

// Exact, case-insensitive match for ilike (escape its wildcards).
const ilikeExact = (email: string) => norm(email).replace(/[\\%_]/g, (c) => `\\${c}`);

// Unfilled placeholders like [PRICE] or [VALIDITY DATE] block a broadcast.
const PLACEHOLDER = /\[[A-Z][A-Z0-9 /_-]*\]/;

async function isSuppressed(db: SupabaseClient, email: string) {
  const { data } = await db.from('email_suppressions').select('email').eq('email', norm(email)).maybeSingle();
  return Boolean(data);
}

const attachmentCache = new Map<string, { name: string; content: string }>();
async function loadAttachment(db: SupabaseClient, path?: string | null, name?: string | null) {
  if (!path) return undefined;
  if (!attachmentCache.has(path)) {
    const { data, error } = await db.storage.from('email-attachments').download(path);
    if (error || !data) throw new Error(`Could not load attachment ${path}: ${error?.message}`);
    attachmentCache.set(path, { name: name || 'attachment.pdf', content: bytesToBase64(new Uint8Array(await data.arrayBuffer())) });
  }
  return attachmentCache.get(path);
}

type SendInput = {
  to: string;
  toName?: string | null;
  clientId?: string | null;
  senderEmail: string;
  senderName: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  attachment?: { name: string; content: string };
  enrollmentId?: string;
  broadcastId?: string;
  kind: 'sequence' | 'broadcast';
  tag: string;
  via?: 'brevo' | 'smtp';
  inReplyTo?: string | null;   // Message-ID of the previous email in this sequence
};

let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
function smtpMailer() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error('SMTP_HOST / SMTP_USER / SMTP_PASSWORD are not set');
  }
  smtpTransport ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return smtpTransport;
}

// Sends from the company's own mailbox: follow-ups thread under the first email,
// and Gmail treats it as ordinary one-to-one mail rather than a bulk send.
async function sendViaSmtp(input: SendInput, html: string) {
  if (norm(input.senderEmail) !== SMTP_USER) {
    throw new Error(`Sequence sender ${input.senderEmail} must match SMTP_USER (${SMTP_USER})`);
  }
  const info = await smtpMailer().sendMail({
    from: { name: input.senderName, address: SMTP_USER },
    to: input.toName ? { name: input.toName, address: input.to } : input.to,
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    html,
    text: htmlToText(html),
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, references: [input.inReplyTo] } : {}),
    ...(input.attachment ? {
      attachments: [{ filename: input.attachment.name, content: input.attachment.content, encoding: 'base64' }],
    } : {}),
  });
  return (info.messageId as string) || null;
}

// Records the message in email_messages (so it shows on the Outreach page and
// gets open/click/bounce tracking from brevo-webhook) and sends it via Brevo.
async function sendEmail(db: SupabaseClient, input: SendInput) {
  const marketing = input.kind === 'broadcast';
  const unsubUrl = marketing ? await unsubscribeUrl(input.to) : null;
  const html = marketing ? withMarketingFooter(input.html, unsubUrl!) : withPersonalFooter(input.html);

  const { data: row, error: insertError } = await db
    .from('email_messages')
    .insert([{
      client_id: input.clientId ?? null,
      to_email: input.to,
      to_name: input.toName ?? null,
      subject: input.subject,
      body_html: html,
      sender_email: input.senderEmail,
      attachment_name: input.attachment?.name ?? null,
      status: 'Pending',
      enrollment_id: input.enrollmentId ?? null,
      broadcast_id: input.broadcastId ?? null,
      automation_kind: input.kind,
    }])
    .select('id')
    .single();
  if (insertError || !row) throw new Error(`Could not record message: ${insertError?.message}`);

  if (input.via === 'smtp') {
    let messageId: string | null;
    try {
      messageId = await sendViaSmtp(input, html);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.from('email_messages').update({ status: 'Failed', bounce_reason: message.slice(0, 500) }).eq('id', row.id);
      throw new Error(`Mailbox send failed: ${message}`);
    }
    await db.from('email_messages').update({
      status: 'Sent',
      sent_at: new Date().toISOString(),
      provider_message_id: messageId,
      delivery_provider: 'smtp',
    }).eq('id', row.id);
    return;
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: input.senderEmail, name: input.senderName },
      to: [{ email: input.to, name: input.toName || undefined }],
      replyTo: { email: input.replyTo || input.senderEmail },
      subject: input.subject,
      htmlContent: html,
      textContent: htmlToText(html),
      ...(marketing ? {
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      } : {}),
      ...(input.attachment ? { attachment: [input.attachment] } : {}),
      tags: ['ktc-trade-manager', `automation-${input.kind}`, input.tag],
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    await db.from('email_messages').update({ status: 'Failed', bounce_reason: JSON.stringify(data).slice(0, 500) }).eq('id', row.id);
    throw new Error(`Brevo rejected the email: ${data?.message || res.status}`);
  }

  await db.from('email_messages').update({
    status: 'Sent',
    sent_at: new Date().toISOString(),
    brevo_message_id: data.messageId ?? null,
    provider_message_id: data.messageId ?? null,
    delivery_provider: 'brevo',
  }).eq('id', row.id);
}

// ---------------------------------------------------------------------------
// 1. Sequences
// ---------------------------------------------------------------------------
// A reply always stops the sequence; an opt-out reply also blocks future emails.
async function replyReason(db: SupabaseClient, email: string, since: string) {
  const [{ data: replies }, { data: inbound }] = await Promise.all([
    db.from('email_replies').select('subject, body_text').ilike('from_email', ilikeExact(email)).limit(20),
    db.from('inbound_emails').select('subject, body_text').ilike('from_email', ilikeExact(email))
      .gte('received_at', since).limit(20),
  ]);
  const optedOut = [...(replies || []), ...(inbound || [])]
    .some((r) => OPT_OUT_REPLY.test(`${r.subject ?? ''}\n${r.body_text ?? ''}`));
  if (optedOut) {
    await db.from('email_suppressions').upsert({ email, reason: 'unsubscribed' }, { onConflict: 'email', ignoreDuplicates: true });
    return 'unsubscribed by reply';
  }
  return 'replied';
}

async function stopReason(db: SupabaseClient, enrollment: any, sequence: any): Promise<string | null> {
  const email = norm(enrollment.to_email);
  if (await isSuppressed(db, email)) return 'suppressed';

  const { data: engaged } = await db
    .from('email_messages')
    .select('status')
    .ilike('to_email', ilikeExact(email))
    .in('status', ['Replied', 'Bounced'])
    .gte('created_at', enrollment.created_at)
    .limit(1);
  if (engaged?.length) {
    if (engaged[0].status === 'Bounced') return 'bounced';
    return await replyReason(db, email, enrollment.created_at);
  }

  const { data: inbound } = await db
    .from('inbound_emails')
    .select('id')
    .ilike('from_email', ilikeExact(email))
    .gte('received_at', enrollment.created_at)
    .limit(1);
  if (inbound?.length) return await replyReason(db, email, enrollment.created_at);

  if (sequence.trigger_event === 'new_lead') {
    const { data: inquiry } = await db
      .from('email_sequence_enrollments')
      .select('id, email_sequences!inner(trigger_event)')
      .eq('email_sequences.trigger_event', 'website_inquiry')
      .eq('to_email', email)
      .limit(1);
    if (inquiry?.length) return 'website inquiry received';
  }

  if (enrollment.client_id) {
    const { data: client } = await db.from('clients').select('status, email').eq('id', enrollment.client_id).maybeSingle();
    if (!client) return 'client deleted';
    if (norm(client.email) !== email) return 'client email changed';
    if ((sequence.stop_on_client_statuses || []).includes(client.status)) return `client status ${client.status}`;
  }
  return null;
}

async function runSequences(db: SupabaseClient, cap: DailyCap, deadline: number) {
  const summary = { sent: 0, stopped: 0, completed: 0, errors: [] as string[] };

  const { data: due } = await db
    .from('email_sequence_enrollments')
    .select('*, email_sequences(*)')
    .eq('status', 'Active')
    .lte('next_send_at', new Date().toISOString())
    .order('next_send_at', { ascending: true })
    .limit(100);

  for (const enrollment of due || []) {
    if (cap.exhausted || Date.now() > deadline) break;
    const sequence = enrollment.email_sequences;
    if (!sequence?.active) continue; // paused sequence: leave enrollments waiting

    const finish = (status: 'Completed' | 'Stopped', reason: string | null) =>
      db.from('email_sequence_enrollments')
        .update({ status, stop_reason: reason, updated_at: new Date().toISOString() })
        .eq('id', enrollment.id);

    try {
      const reason = await stopReason(db, enrollment, sequence);
      if (reason) {
        await finish('Stopped', reason);
        summary.stopped++;
        continue;
      }

      const { data: steps } = await db
        .from('email_sequence_steps')
        .select('*')
        .eq('sequence_id', sequence.id)
        .gt('step_number', enrollment.current_step)
        .order('step_number', { ascending: true })
        .limit(2);
      const step = steps?.[0];
      if (!step) {
        await finish('Completed', null);
        summary.completed++;
        continue;
      }

      const merge: Merge = {
        email: enrollment.to_email,
        contact: enrollment.to_name,
        company: enrollment.company,
        country: enrollment.country,
        product: enrollment.product_interest,
        quantity: enrollment.quantity,
      };

      const via = sequence.send_via === 'smtp' ? 'smtp' : 'brevo';
      let inReplyTo: string | null = null;
      if (via === 'smtp' && enrollment.current_step > 0) {
        const { data: previous } = await db
          .from('email_messages')
          .select('provider_message_id')
          .eq('enrollment_id', enrollment.id)
          .eq('delivery_provider', 'smtp')
          .not('provider_message_id', 'is', null)
          .order('sent_at', { ascending: false })
          .limit(1);
        inReplyTo = previous?.[0]?.provider_message_id ?? null;
      }

      await sendEmail(db, {
        via,
        inReplyTo,
        to: enrollment.to_email,
        toName: enrollment.to_name,
        clientId: enrollment.client_id,
        senderEmail: sequence.sender_email,
        senderName: sequence.sender_name,
        replyTo: sequence.reply_to_email,
        subject: render(step.subject, merge, false),
        html: render(step.body_html, merge, true),
        attachment: await loadAttachment(db, step.attachment_path, step.attachment_name),
        enrollmentId: enrollment.id,
        kind: 'sequence',
        tag: `sequence-${sequence.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      });
      cap.remaining--;
      summary.sent++;

      const nextStep = steps?.[1];
      await db.from('email_sequence_enrollments').update({
        current_step: step.step_number,
        status: nextStep ? 'Active' : 'Completed',
        next_send_at: nextStep
          ? new Date(Date.now() + Number(nextStep.delay_days) * 86400_000).toISOString()
          : enrollment.next_send_at,
        updated_at: new Date().toISOString(),
      }).eq('id', enrollment.id);
      if (!nextStep) summary.completed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${enrollment.to_email}: ${message}`);
      // Back off an hour so one bad address doesn't block the run every 10 minutes.
      await db.from('email_sequence_enrollments')
        .update({ next_send_at: new Date(Date.now() + 3600_000).toISOString(), updated_at: new Date().toISOString() })
        .eq('id', enrollment.id);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// 2. Broadcasts
// ---------------------------------------------------------------------------
function nextRunAt(dayOfMonth: number, hourPkt: number, from = new Date()) {
  // Build the target in PKT, then convert to UTC.
  const pktNow = new Date(from.getTime() + PKT_OFFSET_HOURS * 3600_000);
  let year = pktNow.getUTCFullYear();
  let month = pktNow.getUTCMonth();
  const candidate = () => new Date(Date.UTC(year, month, dayOfMonth, hourPkt) - PKT_OFFSET_HOURS * 3600_000);
  let target = candidate();
  if (target.getTime() <= from.getTime()) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    target = candidate();
  }
  return target;
}

async function queueBroadcasts(db: SupabaseClient) {
  const summary = { queued: 0, skippedNotApproved: [] as string[] };
  const { data: broadcasts } = await db.from('email_broadcasts').select('*').eq('active', true);
  const todayPkt = new Date(Date.now() + PKT_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);

  for (const b of broadcasts || []) {
    if (!b.next_run_at) {
      await db.from('email_broadcasts')
        .update({ next_run_at: nextRunAt(b.day_of_month, b.send_hour_pkt).toISOString() })
        .eq('id', b.id);
      continue;
    }
    if (new Date(b.next_run_at).getTime() > Date.now()) continue;

    if (!b.approved_through || b.approved_through < todayPkt) {
      // Due but prices/copy not approved for this period: hold, check again next run.
      summary.skippedNotApproved.push(b.name);
      continue;
    }
    if (PLACEHOLDER.test(b.subject) || PLACEHOLDER.test(b.body_html)) {
      summary.skippedNotApproved.push(`${b.name} (unfilled placeholder)`);
      continue;
    }

    const runKey = todayPkt.slice(0, 7);
    let query = db.from('clients')
      .select('id, email, contact, company, country, status, products_interest')
      .not('email', 'is', null)
      .in('status', b.audience_statuses);
    if (b.audience_countries?.length) query = query.in('country', b.audience_countries);
    const { data: fetched, error } = await query;
    if (error) throw new Error(`Audience query failed for ${b.name}: ${error.message}`);
    // products_interest is an array column, so match the keyword here.
    const keyword = (b.audience_product_keyword || '').trim().toLowerCase();
    const audience = keyword
      ? (fetched || []).filter((c) => JSON.stringify(c.products_interest ?? '').toLowerCase().includes(keyword))
      : fetched;

    const { data: suppressed } = await db.from('email_suppressions').select('email');
    const blocked = new Set((suppressed || []).map((s) => norm(s.email)));
    const seen = new Set<string>();

    const rows = [];
    for (const c of audience || []) {
      const email = norm(c.email);
      if (!email.includes('@') || blocked.has(email) || seen.has(email)) continue;
      seen.add(email);
      rows.push({
        broadcast_id: b.id, run_key: runKey, client_id: c.id, to_email: email,
        to_name: c.contact, company: c.company, country: c.country,
      });
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error: insertError } = await db
        .from('email_automation_queue')
        .upsert(rows.slice(i, i + 500), { ignoreDuplicates: true, onConflict: 'broadcast_id,run_key,to_email' });
      if (insertError) throw new Error(`Could not queue ${b.name}: ${insertError.message}`);
    }
    summary.queued += rows.length;

    await db.from('email_broadcasts').update({
      last_run_at: new Date().toISOString(),
      next_run_at: nextRunAt(b.day_of_month, b.send_hour_pkt, new Date(Date.now() + 60_000)).toISOString(),
    }).eq('id', b.id);
  }
  return summary;
}

async function drainQueue(db: SupabaseClient, cap: DailyCap, deadline: number) {
  const summary = { sent: 0, skipped: 0, failed: 0 };
  if (cap.exhausted) return summary;

  const { data: items } = await db
    .from('email_automation_queue')
    .select('*, email_broadcasts(*)')
    .eq('status', 'Queued')
    .order('created_at', { ascending: true })
    .limit(Math.min(cap.remaining, 60));

  for (const item of items || []) {
    if (cap.exhausted || Date.now() > deadline) break;
    const b = item.email_broadcasts;
    const done = (status: string, error: string | null = null) =>
      db.from('email_automation_queue').update({ status, error, processed_at: new Date().toISOString() }).eq('id', item.id);

    if (!b?.active) continue;
    if (await isSuppressed(db, item.to_email)) { await done('Skipped', 'suppressed'); summary.skipped++; continue; }

    try {
      const merge: Merge = { email: item.to_email, contact: item.to_name, company: item.company, country: item.country };
      await sendEmail(db, {
        to: item.to_email,
        toName: item.to_name,
        clientId: item.client_id,
        senderEmail: b.sender_email,
        senderName: b.sender_name,
        replyTo: b.reply_to_email,
        subject: render(b.subject, merge, false),
        html: render(b.body_html, merge, true),
        attachment: await loadAttachment(db, b.attachment_path, b.attachment_name),
        broadcastId: b.id,
        kind: 'broadcast',
        tag: `broadcast-${item.run_key}`,
      });
      cap.remaining--;
      await done('Sent');
      summary.sent++;
    } catch (err) {
      await done('Failed', err instanceof Error ? err.message : String(err));
      summary.failed++;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (!BREVO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Missing BREVO_API_KEY, SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const deadline = Date.now() + RUN_BUDGET_MS;
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const secret = await automationSecret(db);
    if (req.headers.get('x-automation-secret') !== secret) return json({ error: 'Unauthorized' }, 401);
    const cap = new DailyCap(DAILY_SEND_LIMIT - await sentTodayCount(db));
    const sequences = await runSequences(db, cap, deadline);
    const broadcastsQueued = await queueBroadcasts(db);
    const broadcastsSent = await drainQueue(db, cap, deadline);
    return json({ ok: true, remainingToday: Math.max(cap.remaining, 0), sequences, broadcastsQueued, broadcastsSent });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
