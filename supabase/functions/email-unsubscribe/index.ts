// Supabase Edge Function: email-unsubscribe
//
// Linked from the footer (and List-Unsubscribe header) of every automated email.
// Adds the address to email_suppressions and stops any active sequences.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (HMAC key read from Vault)
// Deploy:  supabase functions deploy email-unsubscribe --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function expectedToken(secret: string, email: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function page(title: string, message: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Georgia,serif;background:#F7F5EF;color:#1d2a22;display:flex;min-height:100vh;
align-items:center;justify-content:center;margin:0;padding:16px}main{max-width:460px;background:#fff;
border-top:4px solid #14432A;padding:32px;border-radius:6px}h1{font-size:22px;color:#14432A;margin-top:0}
p{line-height:1.6}</style></head><body><main><h1>${title}</h1><p>${message}</p>
<p style="font-size:13px;color:#666">Kassam Trading Company, Port Qasim, Karachi</p></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const email = (url.searchParams.get('e') || '').trim().toLowerCase();
  const token = url.searchParams.get('t') || '';

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: secret } = await db.rpc('ktc_automation_secret');

  if (!email.includes('@') || !secret || token !== await expectedToken(String(secret), email)) {
    return page('Link not valid', 'This unsubscribe link is incomplete or has expired. Reply to any of our emails with "unsubscribe" and we will remove you.', 400);
  }
  await db.from('email_suppressions').upsert({ email, reason: 'unsubscribed' }, { onConflict: 'email', ignoreDuplicates: true });
  await db.from('email_sequence_enrollments')
    .update({ status: 'Stopped', stop_reason: 'unsubscribed', updated_at: new Date().toISOString() })
    .eq('to_email', email)
    .eq('status', 'Active');
  await db.from('email_automation_queue')
    .update({ status: 'Skipped', error: 'unsubscribed', processed_at: new Date().toISOString() })
    .eq('to_email', email)
    .eq('status', 'Queued');

  // One-click unsubscribe from mail clients arrives as a POST; they ignore the body.
  if (req.method === 'POST') return new Response('ok');
  return page('You have been unsubscribed', `${email} will no longer receive marketing emails from Kassam Trading Company.`);
});
