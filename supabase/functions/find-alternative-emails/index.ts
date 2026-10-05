// Supabase Edge Function: find-alternative-emails
//
// For buyers whose email bounced, look for other addresses on the buyer's own
// website (home page and contact/about pages) and among their saved extra
// contacts. Candidates are checked for a mail server (MX record) and stored in
// public.email_alternatives for staff to Use or Dismiss in Outreach → Bounced.
// Nothing is emailed and the buyer record is not changed here.
//
// Only the buyer's own site is searched: the saved "Website:" from their notes,
// a "Source:" link on the same site, or their email domain when it clearly
// matches the company name (never a mail provider or ISP domain).
//
// Auth: signed-in staff with an editing role (Admin / Owner, Sales Executive, Export Manager),
//       or the internal x-automation-secret (Vault) used by scheduled jobs.
// Body: { "clientIds": ["LEAD-2026-0001", ...] }  (up to 20 per call)
// Deploy: supabase functions deploy find-alternative-emails --no-verify-jwt   (auth is checked in code)

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const MAX_CLIENTS = 20;
const MAX_PAGES_PER_CLIENT = 7;
const PAGE_TIMEOUT_MS = 7000;
const MAX_PAGE_BYTES = 1_500_000;
const CONTACT_PATHS = ['/contact', '/contact-us', '/contactus', '/contact.html', '/contact-us.html', '/about', '/about-us'];

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.fr', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com',
  'gmx.com', 'gmx.de', 'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'rediffmail.com', 'zoho.com',
]);
// Addresses that show up on websites but are never a buyer's inbox.
const JUNK_DOMAINS = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|sentry(-next)?\.(io|wixpress\.com)|wixpress\.com|wix\.com|godaddy\.com|squarespace\.com|cloudflare\.com|w3\.org|schema\.org|googleapis\.com|gstatic\.com|latofonts\.com|mysite\.com)$/i;
const FILE_SUFFIX = /\.(png|jpe?g|gif|webp|svg|ico|bmp|js|css|pdf|woff2?|ttf|mp4)$/i;
const EMAIL_RE = /[a-z0-9._%+\-]{1,64}@[a-z0-9.\-]{1,190}\.[a-z]{2,24}/gi;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function words(company: string) {
  return (company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w.length >= 4 && !['trading', 'company', 'limited', 'group', 'international', 'foods', 'food', 'import', 'export', 'general', 'enterprise', 'enterprises', 'corporation', 'industries'].includes(w));
}

function domainMatchesCompany(domain: string, company: string) {
  const label = domain.toLowerCase().split('.').slice(0, -1).join('.');
  return words(company).some((w) => label.includes(w));
}

function safeUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    // Public websites only: no IP literals, localhost or internal names.
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')
        || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    return url;
  } catch {
    return null;
  }
}

function sameSite(a: string, b: string) {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return strip(a) === strip(b);
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KTC-TradeManager/1.0; contact lookup)', Accept: 'text/html' },
    });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html') || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - off)), off); off += c.length; if (off >= size) break; }
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractEmails(html: string) {
  const text = html
    .replace(/&#0*64;|&#x0*40;|&commat;/gi, '@')
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, '.')
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, '.')
    .replace(/%40/g, '@');
  const found = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/^[._%+\-]+/, '').replace(/[.\-]+$/, '');
    const [local, domain] = email.split('@');
    if (!local || !domain || FILE_SUFFIX.test(email) || JUNK_DOMAINS.test(domain)) continue;
    if (/^(u00|x22|x27|2f)/.test(local) || /^\d+x$/.test(local)) continue;
    found.add(email);
  }
  return found;
}

function contactLinks(html: string, base: URL) {
  const links = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (!/contact|about|reach|enquir|inquir/i.test(href)) continue;
    try {
      const url = new URL(href, base);
      if (sameSite(url.hostname, base.hostname) && /^https?:$/.test(url.protocol)) links.add(url.href.split('#')[0]);
    } catch { /* ignore */ }
  }
  return [...links].slice(0, 3);
}

const mxCache = new Map<string, boolean>();
async function hasMx(domain: string) {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  let ok = false;
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, { headers: { Accept: 'application/dns-json' } });
    const body = await res.json();
    ok = Array.isArray(body?.Answer) && body.Answer.some((a: { type: number }) => a.type === 15);
  } catch { ok = false; }
  mxCache.set(domain, ok);
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // Staff with an editing role, or the internal automation key (scheduled jobs / testing).
  const { data: secret } = await db.rpc('ktc_automation_secret');
  const internal = Boolean(secret) && req.headers.get('x-automation-secret') === secret;
  if (!internal) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await db.auth.getUser(jwt);
    if (!auth?.user) return json({ error: 'Sign in again' }, 401);
    const { data: profile } = await db.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
    if (!['Admin / Owner', 'Sales Executive', 'Export Manager'].includes(profile?.role)) return json({ error: 'Not authorised' }, 403);
  }

  let clientIds: string[] = [];
  try {
    const body = await req.json();
    clientIds = (Array.isArray(body?.clientIds) ? body.clientIds : []).map(String).slice(0, MAX_CLIENTS);
  } catch { /* empty */ }
  if (!clientIds.length) return json({ error: 'No buyers given' }, 400);

  const { data: clients, error } = await db.from('clients').select('id, company, email, notes').in('id', clientIds);
  if (error) return json({ error: error.message }, 500);
  const { data: suppressed } = await db.from('email_suppressions').select('email');
  const blocked = new Set((suppressed || []).map((s: { email: string }) => s.email.toLowerCase()));

  const results = [];
  for (const client of clients || []) {
    const current = String(client.email || '').toLowerCase().split(/[\s,;]+/).filter((e) => e.includes('@'));
    const { data: bounces } = await db.from('email_messages').select('to_email').eq('client_id', client.id).eq('status', 'Bounced');
    const bad = new Set([...current, ...(bounces || []).map((b: { to_email: string }) => String(b.to_email).toLowerCase())]);

    // The buyer's own website, never their mail provider's.
    const notes = String(client.notes || '');
    const sites: URL[] = [];
    const website = safeUrl(/website:\s*(\S+)/i.exec(notes)?.[1]);
    if (website) sites.push(website);
    const source = safeUrl(/source:\s*(\S+)/i.exec(notes)?.[1]);
    if (source && (!website || sameSite(source.hostname, website.hostname) || domainMatchesCompany(source.hostname, client.company))) sites.push(source);
    const emailDomain = current[0]?.split('@')[1];
    if (!sites.length && emailDomain && !FREE_MAIL.has(emailDomain) && domainMatchesCompany(emailDomain, client.company)) {
      const guess = safeUrl(emailDomain);
      if (guess) sites.push(guess);
    }

    const candidates = new Map<string, { source: 'website' | 'contact'; url: string | null }>();
    const visited = new Set<string>();
    for (const site of sites) {
      const queue = [site.href, ...CONTACT_PATHS.map((p) => new URL(p, site.origin).href)];
      while (queue.length && visited.size < MAX_PAGES_PER_CLIENT) {
        const url = queue.shift()!;
        if (visited.has(url)) continue;
        visited.add(url);
        const html = await fetchPage(url);
        if (!html) continue;
        for (const email of extractEmails(html)) if (!candidates.has(email)) candidates.set(email, { source: 'website', url });
        if (url === site.href) for (const link of contactLinks(html, site)) if (!visited.has(link)) queue.unshift(link);
      }
    }

    const { data: contacts } = await db.from('client_contacts').select('email').eq('client_id', client.id).not('email', 'is', null);
    for (const c of contacts || []) {
      const email = String(c.email).toLowerCase();
      if (!candidates.has(email)) candidates.set(email, { source: 'contact', url: null });
    }

    const rows = [];
    for (const [email, meta] of candidates) {
      if (bad.has(email) || blocked.has(email)) continue;
      rows.push({
        client_id: client.id,
        bounced_email: current[0] || null,
        candidate_email: email,
        source: meta.source,
        source_url: meta.url,
        mx_ok: await hasMx(email.split('@')[1]),
      });
    }
    // Keep the most useful few: working domains first, then the buyer's own domain.
    const siteHosts = sites.map((s) => s.hostname.replace(/^www\./, ''));
    rows.sort((a, b) => Number(b.mx_ok) - Number(a.mx_ok)
      || Number(siteHosts.some((h) => b.candidate_email.endsWith(`@${h}`))) - Number(siteHosts.some((h) => a.candidate_email.endsWith(`@${h}`))));
    const keep = rows.filter((r) => r.mx_ok).slice(0, 8);
    if (keep.length) {
      await db.from('email_alternatives').upsert(keep, { onConflict: 'client_id,candidate_email', ignoreDuplicates: true });
    }
    await db.from('clients').update({ alternatives_checked_at: new Date().toISOString() }).eq('id', client.id);
    results.push({
      client_id: client.id,
      searched: [...new Set(sites.map((s) => s.hostname))],
      pages: visited.size,
      found: keep.length,
    });
  }

  return json({ results });
});
