import { createClient } from 'npm:@supabase/supabase-js@2';
import { simpleParser } from 'npm:mailparser@3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const IMAP_HOST = Deno.env.get('IMAP_HOST');
const IMAP_PORT = Number(Deno.env.get('IMAP_PORT') || '993');
// Per mailbox per run; the saved UID marker makes the next run continue from here.
const MAX_MESSAGES_PER_RUN = 120;
// When the saved marker is unusable, look back this far (de-duplicated by UID).
const CATCH_UP_DAYS = 21;
// The domain's DNS records were wiped on 2026-10-01, so mail.kassamtradingcompany.com
// stopped resolving. Fall back to the cPanel server's address (cloud313.corpservers.net)
// until the MX / mail records are restored; remove once DNS is fixed.
const HOST_FALLBACK: Record<string, string> = { 'mail.kassamtradingcompany.com': '149.28.151.147' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Mailbox = { user: string; pass: string; host: string | null; port: number | null; sequenceMailbox: boolean };

function parseMailboxes(): Mailbox[] {
  const raw = Deno.env.get('IMAP_MAILBOXES') || '';
  const boxes: Mailbox[] = raw.split(',').map(e => e.trim()).filter(Boolean).map(e => {
    const idx = e.indexOf(':');
    return { user: e.slice(0, idx), pass: e.slice(idx + 1), host: null, port: null, sequenceMailbox: false };
  }).filter(m => m.user && m.pass);
  // The company mailbox that sends the follow-up sequences (SMTP_USER /
  // SMTP_PASSWORD, e.g. exports@ on cPanel) is also read over IMAP so replies
  // stop the sequence, whatever IMAP_HOST the other mailboxes use.
  const sUser = (Deno.env.get('SMTP_USER') || '').trim();
  const sPass = Deno.env.get('SMTP_PASSWORD') || '';
  const sHost = (Deno.env.get('SMTP_IMAP_HOST') || Deno.env.get('SMTP_HOST') || '').trim();
  if (sUser && sPass && sHost && !boxes.some(b => b.user.toLowerCase() === sUser.toLowerCase())) {
    boxes.push({ user: sUser, pass: sPass, host: sHost, port: 993, sequenceMailbox: true });
  }
  return boxes;
}

function decodeHeader(str) {
  if (!str) return '';
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, encoded) => {
    try {
      let raw;
      if (enc.toUpperCase() === 'B') {
        const bin = atob(encoded.replace(/\s/g, ''));
        raw = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
      } else {
        const qp = encoded.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        raw = new Uint8Array([...qp].map(c => c.charCodeAt(0)));
      }
      try { return new TextDecoder(charset).decode(raw); } catch { return new TextDecoder('utf-8').decode(raw); }
    } catch { return str; }
  });
}

function stripReplyChain(text) {
  const lines = text.split('\n');
  const clean = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('>')) break;
    if (/^On .{10,} wrote:/.test(line.trim())) break;
    clean.push(line);
  }
  return clean.join('\n').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Allowed callers: the pg_cron schedule (shared secret) or a signed-in CRM user.
  const authDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: secret } = await authDb.rpc('ktc_automation_secret');
  const cronCall = Boolean(secret) && req.headers.get('x-automation-secret') === secret;
  if (!cronCall) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await authDb.auth.getUser(jwt);
    if (!auth?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  console.log('check-email-replies: starting');
  const mailboxes = parseMailboxes();
  console.log('Mailboxes:', mailboxes.map(m => m.user).join(', '));

  let ImapFlow;
  try {
    const mod = await import('npm:imapflow@1');
    ImapFlow = mod.ImapFlow;
    console.log('ImapFlow loaded OK');
  } catch (err) {
    return new Response(JSON.stringify({ error: 'ImapFlow import failed', detail: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results = [];

  for (const mb of mailboxes) {
    const result = { mailbox: mb.user, inInbox: null, newestInInbox: null, checked: 0, newReplies: 0, newInbound: 0, errors: [] };
    let client;
    try {
      const host = mb.host || IMAP_HOST;
      const connectTo = async (address) => {
        const c = new ImapFlow({
          host: address, port: mb.port || IMAP_PORT, secure: true,
          auth: { user: mb.user, pass: mb.pass },
          logger: false, tls: { rejectUnauthorized: false, servername: host },
        });
        await c.connect();
        return c;
      };
      try {
        client = await connectTo(host);
      } catch (err) {
        const fallback = HOST_FALLBACK[String(host).toLowerCase()];
        if (!fallback || !/ENOTFOUND|EAI_AGAIN/i.test(err.message)) throw err;
        console.log(`${host} not resolving; using ${fallback}`);
        client = await connectTo(fallback);
        result.via = fallback;
      }
      console.log('Connected to:', mb.user);

      const { data: syncState } = await supabase
        .from('imap_sync_state').select('*').eq('mailbox', mb.user).maybeSingle();

      const lock = await client.getMailboxLock('INBOX');
      const uidNext = Number(client.mailbox?.uidNext || 0);
      // Messages currently kept in INBOX (0 means mail is forwarded elsewhere).
      result.inInbox = Number(client.mailbox?.exists ?? 0);
      // Date of the newest message in INBOX, to spot mail that stopped arriving.
      if (result.inInbox > 0) {
        try {
          const newest = await client.fetchOne('*', { internalDate: true });
          result.newestInInbox = newest?.internalDate ? new Date(newest.internalDate).toISOString() : null;
        } catch (_) { /* diagnostic only */ }
      }
      const savedUid = Number(syncState?.last_uid || 0);
      // A marker at or past UIDNEXT can never match a new message (it sat at
      // 999999 from July to September 2026, so only the newest email per run was
      // stored). Fall back to the last few weeks; stored UIDs are skipped below.
      const markerValid = savedUid > 0 && (!uidNext || savedUid < uidNext);
      let highestUid = markerValid ? savedUid : 0;
      let capped = false;

      try {
        const found = markerValid
          ? await client.search({ uid: `${savedUid + 1}:*` }, { uid: true })
          : await client.search({
            // A newly added sequence mailbox starts from yesterday rather than
            // importing weeks of old mail into the inbox review queue.
            since: new Date(Date.now() - (mb.sequenceMailbox && !syncState ? 1 : CATCH_UP_DAYS) * 86400000),
          }, { uid: true });
        // "n:*" also returns the newest message when n is past it, so filter.
        const uids = (found || []).filter((uid) => !markerValid || uid > savedUid).sort((a, b) => a - b);
        capped = uids.length > MAX_MESSAGES_PER_RUN;
        const batch = uids.slice(0, MAX_MESSAGES_PER_RUN);

        for await (const msg of (batch.length
          ? client.fetch(batch.join(','), { envelope: true, uid: true, source: true }, { uid: true })
          : [])) {
          result.checked++;
          const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
          const fromName = decodeHeader(msg.envelope?.from?.[0]?.name || '');
          const subject = decodeHeader(msg.envelope?.subject || '(no subject)');
          const uid = msg.uid;
          if (uid > highestUid) highestUid = uid;
          if (!from) continue;

          const ourMailboxes = mailboxes.map(m => m.user.toLowerCase());
          if (ourMailboxes.includes(from)) continue;

          const { data: existing } = await supabase
            .from('inbound_emails').select('id')
            .eq('mailbox', mb.user).eq('imap_uid', String(uid)).maybeSingle();
          if (existing) continue;

          // Use mailparser to properly parse the raw email. Attachments are never
          // opened or stored; only their file names are kept for risk checks.
          let bodyText = '(Could not decode email body)';
          let attachmentNames = [];
          let sentAt = msg.envelope?.date ? new Date(msg.envelope.date) : new Date();
          try {
            const parsed = await simpleParser(msg.source);
            attachmentNames = (parsed.attachments || [])
              .map((a) => a.filename || a.contentType || 'attachment')
              .slice(0, 20);
            if (parsed.date) sentAt = parsed.date;
            console.log(`UID ${uid}: text=${parsed.text?.slice(0,50)} html=${parsed.html ? 'yes' : 'no'}`);
            if (parsed.text && parsed.text.trim().length > 5) {
              bodyText = stripReplyChain(parsed.text.trim()).slice(0, 5000);
            } else if (parsed.html) {
              // Strip HTML tags
              const stripped = parsed.html
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
                .replace(/\s+/g, ' ').trim();
              bodyText = stripReplyChain(stripped).slice(0, 5000);
            }
          } catch (parseErr) {
            console.error(`UID ${uid}: mailparser error: ${parseErr.message}`);
          }

          console.log(`UID ${uid} final body: "${bodyText.slice(0, 100)}"`);

          const { data: candidates } = await supabase
            .from('email_messages').select('id, status')
            .ilike('to_email', `%${from}%`)
            .order('sent_at', { ascending: false }).limit(1);

          if (candidates?.length) {
            const matched = candidates[0];
            const { error: insertErr } = await supabase.from('email_replies').insert([{
              message_id: matched.id, from_email: from,
              subject, body_text: bodyText, imap_uid: String(uid),
            }]);
            if (!insertErr) {
              result.newReplies++;
              await supabase.from('email_messages')
                .update({ status: 'Replied', replied_at: new Date().toISOString() })
                .eq('id', matched.id);
            }
          } else {
            result.newInbound++;
          }

          // The process_inbound_email trigger links the buyer (exact address,
          // never a shared broker address), flags risks and creates the task.
          await supabase.from('inbound_emails').insert([{
            mailbox: mb.user, from_email: from,
            from_name: fromName || null, subject,
            body_text: bodyText, imap_uid: String(uid),
            received_at: sentAt.toISOString(),
            attachment_names: attachmentNames,
          }]);
        }
      } finally {
        lock.release();
      }

      // Nothing left to read: move the marker to the end of the mailbox.
      const marker = capped || !uidNext ? highestUid : Math.max(highestUid, uidNext - 1);
      await supabase.from('imap_sync_state').upsert(
        { mailbox: mb.user, last_uid: String(marker), last_checked_at: new Date().toISOString() },
        { onConflict: 'mailbox' }
      );

      await client.logout();
      console.log(`Done ${mb.user}: checked=${result.checked} replies=${result.newReplies} inbound=${result.newInbound}`);

    } catch (err) {
      console.error('Error:', mb.user, err.message);
      result.errors.push(err.message);
      try { await client?.logout(); } catch (_) {}
    }

    results.push(result);
  }

  return new Response(JSON.stringify({ results }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
