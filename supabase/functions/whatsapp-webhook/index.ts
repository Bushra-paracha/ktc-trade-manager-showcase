// Supabase Edge Function: whatsapp-webhook
//
// Receives incoming WhatsApp messages from the Meta Cloud API and stores them in
// public.inbound_whatsapp. A database trigger links known buyers, creates the
// follow-up task and holds unknown numbers for review (migration 202609270030).
//
//   GET  — Meta's one-time verification (hub.verify_token must match WHATSAPP_VERIFY_TOKEN)
//   POST — every request must carry a valid X-Hub-Signature-256 made with WHATSAPP_APP_SECRET
//
// Media is never downloaded: only its type and file name are recorded.
//
// Secrets: WHATSAPP_APP_SECRET (Meta app → Settings → Basic → App secret),
//          WHATSAPP_VERIFY_TOKEN (any long random string, also entered in Meta),
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy:  supabase functions deploy whatsapp-webhook --no-verify-jwt
// Meta:    WhatsApp → Configuration → Webhook
//          Callback URL https://your-project-ref.supabase.co/functions/v1/whatsapp-webhook
//          Verify token = WHATSAPP_VERIFY_TOKEN, then subscribe to "messages".

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET')?.trim() ?? '';
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN')?.trim() ?? '';

type MetaMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { filename?: string; caption?: string };
  audio?: unknown;
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string };
  location?: { name?: string; address?: string };
};

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validSignature(raw: string, header: string | null) {
  if (!APP_SECRET || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, header.slice('sha256='.length));
}

function messageText(m: MetaMessage) {
  switch (m.type) {
    case 'text': return m.text?.body ?? '';
    case 'image': return `[photo]${m.image?.caption ? ` ${m.image.caption}` : ''}`;
    case 'video': return `[video]${m.video?.caption ? ` ${m.video.caption}` : ''}`;
    case 'document': return `[document: ${m.document?.filename ?? 'file'}]${m.document?.caption ? ` ${m.document.caption}` : ''}`;
    case 'audio': return '[voice note]';
    case 'button': return m.button?.text ?? '';
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
    case 'reaction': return `[reaction ${m.reaction?.emoji ?? ''}]`;
    case 'location': return `[location] ${[m.location?.name, m.location?.address].filter(Boolean).join(', ')}`;
    default: return `[${m.type ?? 'message'}]`;
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const ok = VERIFY_TOKEN
      && url.searchParams.get('hub.mode') === 'subscribe'
      && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN;
    return ok
      ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
      : new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const rows: Record<string, unknown>[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const names = new Map<string, string>(
        (value.contacts ?? []).map((c: any) => [String(c.wa_id), c.profile?.name ?? null]),
      );
      for (const m of (value.messages ?? []) as MetaMessage[]) {
        if (!m?.id || !m?.from) continue;
        rows.push({
          wa_message_id: m.id,
          from_phone: `+${String(m.from).replace(/\D/g, '')}`,
          from_name: names.get(String(m.from)) ?? null,
          message_type: m.type ?? null,
          body: messageText(m).slice(0, 5000),
          received_at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
      // Delivery/read receipts (value.statuses) are ignored for now.
    }
  }

  if (rows.length) {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Meta retries deliveries; the unique message id makes that harmless.
    const { error } = await db.from('inbound_whatsapp').upsert(rows, { onConflict: 'wa_message_id', ignoreDuplicates: true });
    if (error) {
      console.error('whatsapp-webhook insert failed', error.message);
      return new Response('Storage error', { status: 500 }); // Meta will retry
    }
  }

  return new Response('ok', { status: 200 });
});
