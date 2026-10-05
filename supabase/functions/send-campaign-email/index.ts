// Supabase Edge Function: send-campaign-email
//
// Sends a single email via Brevo's transactional email API,
// then records the result in the email_messages table.
//
// Expects a POST body:
// {
//   "messageId": "<uuid of row in email_messages>"
// }
//
// The row must already exist in email_messages with status 'Pending',
// containing: to_email, to_name, subject, sender_email, and the
// rendered HTML body (passed separately as "html" in the request).
//
// The row is claimed (Pending -> Sending) before anything is sent, so a repeated
// request for the same row (the browser retrying after a dropped connection) gets
// 409 { alreadyHandled, status } instead of sending the email twice.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ZOHO_CLIENT_ID = Deno.env.get('ZOHO_CLIENT_ID');
const ZOHO_CLIENT_SECRET = Deno.env.get('ZOHO_CLIENT_SECRET');
const ZOHO_REFRESH_TOKEN = Deno.env.get('ZOHO_REFRESH_TOKEN');
const ZOHO_SULTAN_CLIENT_ID = Deno.env.get('ZOHO_SULTAN_CLIENT_ID');
const ZOHO_SULTAN_CLIENT_SECRET = Deno.env.get('ZOHO_SULTAN_CLIENT_SECRET');
const ZOHO_SULTAN_REFRESH_TOKEN = Deno.env.get('ZOHO_SULTAN_REFRESH_TOKEN');
const ZOHO_TRADING_CLIENT_ID = Deno.env.get('ZOHO_TRADING_CLIENT_ID');
const ZOHO_TRADING_CLIENT_SECRET = Deno.env.get('ZOHO_TRADING_CLIENT_SECRET');
const ZOHO_TRADING_REFRESH_TOKEN = Deno.env.get('ZOHO_TRADING_REFRESH_TOKEN');
const ZOHO_EXPORT_CLIENT_ID = Deno.env.get('ZOHO_EXPORT_CLIENT_ID');
const ZOHO_EXPORT_CLIENT_SECRET = Deno.env.get('ZOHO_EXPORT_CLIENT_SECRET');
const ZOHO_EXPORT_REFRESH_TOKEN = Deno.env.get('ZOHO_EXPORT_REFRESH_TOKEN');
const ZOHO_NAZIMA_CLIENT_ID = Deno.env.get('ZOHO_NAZIMA_CLIENT_ID');
const ZOHO_NAZIMA_CLIENT_SECRET = Deno.env.get('ZOHO_NAZIMA_CLIENT_SECRET');
const ZOHO_NAZIMA_REFRESH_TOKEN = Deno.env.get('ZOHO_NAZIMA_REFRESH_TOKEN');
const ZOHO_ACCOUNTS_URL = Deno.env.get('ZOHO_ACCOUNTS_URL') || 'https://accounts.zoho.com';
const ZOHO_MAIL_API_URL = Deno.env.get('ZOHO_MAIL_API_URL') || 'https://mail.zoho.com';
const ZOHO_SENDER_EMAILS = Deno.env.get('ZOHO_SENDER_EMAILS') || '';
// Buyer replies to CRM emails go here (Brevo path; Zoho/NBMT replies stay in the NBMT mailbox).
const REPLY_TO_EMAIL = Deno.env.get('REPLY_TO_EMAIL') || 'outreach@example.com';

type EmailMessage = {
  sender_email: string;
  to_email: string;
  to_name?: string | null;
  subject: string;
  campaign_id?: string | null;
};

type ZohoSendMailDetail = {
  fromAddress?: unknown;
};

type ZohoAccount = {
  accountId?: string;
  emailAddress?: unknown;
  sendMailDetails?: ZohoSendMailDetail[];
};

type ZohoAttachment = {
  storeName: string;
  attachmentName: string;
  attachmentPath: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function configuredZohoSenders() {
  return ZOHO_SENDER_EMAILS.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes('@'));
}

function isZohoSender(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail.endsWith('@nbmttrading.com')
    || configuredZohoSenders().includes(normalizedEmail);
}

function normalizeZohoAddress(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized.includes('@') ? normalized : null;
  }
  if (!value || typeof value !== 'object') return null;

  const address = value as Record<string, unknown>;
  for (const key of ['address', 'emailAddress', 'fromAddress', 'mailId']) {
    const normalized = normalizeZohoAddress(address[key]);
    if (normalized) return normalized;
  }
  return null;
}

function zohoCredentialsForSender(senderEmail: string) {
  const normalizedEmail = senderEmail.trim().toLowerCase();
  if (normalizedEmail === 'staff@example.com') {
    return {
      clientId: ZOHO_SULTAN_CLIENT_ID,
      clientSecret: ZOHO_SULTAN_CLIENT_SECRET,
      refreshToken: ZOHO_SULTAN_REFRESH_TOKEN,
    };
  }
  if (normalizedEmail === 'staff@example.com') {
    return {
      clientId: ZOHO_TRADING_CLIENT_ID,
      clientSecret: ZOHO_TRADING_CLIENT_SECRET,
      refreshToken: ZOHO_TRADING_REFRESH_TOKEN,
    };
  }
  if (normalizedEmail === 'staff@example.com') {
    return {
      clientId: ZOHO_EXPORT_CLIENT_ID,
      clientSecret: ZOHO_EXPORT_CLIENT_SECRET,
      refreshToken: ZOHO_EXPORT_REFRESH_TOKEN,
    };
  }
  if (normalizedEmail === 'staff@example.com') {
    return {
      clientId: ZOHO_NAZIMA_CLIENT_ID,
      clientSecret: ZOHO_NAZIMA_CLIENT_SECRET,
      refreshToken: ZOHO_NAZIMA_REFRESH_TOKEN,
    };
  }

  return {
    clientId: ZOHO_CLIENT_ID,
    clientSecret: ZOHO_CLIENT_SECRET,
    refreshToken: ZOHO_REFRESH_TOKEN,
  };
}

async function zohoAccessToken(senderEmail: string) {
  const credentials = zohoCredentialsForSender(senderEmail);
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    throw new Error(`Zoho OAuth is not configured for ${senderEmail}`);
  }
  const params = new URLSearchParams({
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'refresh_token',
  });
  const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error || 'Could not refresh Zoho access token');
  }
  return data.access_token as string;
}

async function zohoRequest(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${ZOHO_MAIL_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status?.code && data.status.code >= 400) {
    throw new Error(data?.data?.errorCode || data?.status?.description || `Zoho request failed (${response.status})`);
  }
  return data;
}

function zohoAttachmentFromUpload(value: unknown): ZohoAttachment | null {
  if (!value || typeof value !== 'object') return null;

  const uploaded = value as Record<string, unknown>;
  const storeName = typeof uploaded.storeName === 'string' ? uploaded.storeName : null;
  const attachmentName = typeof uploaded.attachmentName === 'string' ? uploaded.attachmentName : null;
  const attachmentPath = typeof uploaded.attachmentPath === 'string' ? uploaded.attachmentPath : null;

  if (!storeName || !attachmentName || !attachmentPath) return null;
  return { storeName, attachmentName, attachmentPath };
}

async function sendViaZoho(
  message: EmailMessage,
  html: string,
  attachment?: { name: string; bytes: Uint8Array },
) {
  const token = await zohoAccessToken(message.sender_email);
  const accounts = await zohoRequest('/api/accounts', token);
  const account = (accounts.data || []).find((candidate: ZohoAccount) => {
    const addresses = [
      candidate.emailAddress,
      ...(candidate.sendMailDetails || []).map((detail: ZohoSendMailDetail) => detail.fromAddress),
    ]
      .map(normalizeZohoAddress)
      .filter((address): address is string => address !== null);
    return addresses.includes(message.sender_email.trim().toLowerCase());
  });
  if (!account?.accountId) throw new Error('The selected sender is not available in the connected Zoho account');

  let attachments: ZohoAttachment[] | undefined;
  if (attachment) {
    const form = new FormData();
    const ownedAttachmentBytes = new Uint8Array(attachment.bytes);
    form.append('attach', new Blob([ownedAttachmentBytes.buffer], { type: 'application/pdf' }), attachment.name);
    const uploaded = await zohoRequest(`/api/accounts/${account.accountId}/messages/attachments?uploadType=multipart&isInline=false`, token, {
      method: 'POST',
      body: form,
    });
    const uploadedAttachments = Array.isArray(uploaded.data) ? uploaded.data : [uploaded.data];
    attachments = uploadedAttachments
      .map(zohoAttachmentFromUpload)
      .filter((item): item is ZohoAttachment => item !== null);

    if (attachments.length !== uploadedAttachments.length || attachments.length === 0) {
      throw new Error('Zoho uploaded the PDF but returned incomplete attachment metadata');
    }
  }

  const sent = await zohoRequest(`/api/accounts/${account.accountId}/messages`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromAddress: message.sender_email.trim(),
      toAddress: message.to_email.trim(),
      subject: message.subject,
      content: html,
      mailFormat: 'html',
      ...(attachments ? { attachments } : {}),
    }),
  });
  return sent.data?.messageId || sent.data?.mailId || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let claimedId: string | null = null;
  try {
    const { messageId, html } = await req.json();

    if (!messageId || !html) {
      return new Response(
        JSON.stringify({ error: 'messageId and html are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase service configuration is missing');
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch the message row
    const { data: message, error: fetchError } = await supabase
      .from('email_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (fetchError || !message) {
      return new Response(
        JSON.stringify({ error: 'Message not found', details: fetchError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: claimed } = await supabase
      .from('email_messages')
      .update({ status: 'Sending' })
      .eq('id', messageId)
      .eq('status', 'Pending')
      .select('id')
      .maybeSingle();
    if (!claimed) {
      return new Response(
        JSON.stringify({ error: `This email is already ${String(message.status || 'handled').toLowerCase()}`, alreadyHandled: true, status: message.status }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    claimedId = messageId;

    const senderEmail = String(message.sender_email || '').trim().toLowerCase();
    if (!senderEmail.includes('@')) {
      await supabase.from('email_messages').update({ status: 'Failed' }).eq('id', messageId);
      return new Response(
        JSON.stringify({ error: 'A valid sender email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    // NBMT is a Zoho-managed domain. Never allow an NBMT sender to fall
    // through to Brevo merely because a runtime allowlist is stale.
    const useZoho = isZohoSender(senderEmail);

    let attachment;
    if (message.attachment_path) {
      const { data: pdf, error: pdfError } = await supabase.storage
        .from('email-attachments')
        .download(message.attachment_path);
      if (pdfError || !pdf) {
        await supabase.from('email_messages').update({ status: 'Failed' }).eq('id', messageId);
        return new Response(
          JSON.stringify({ error: 'Could not load the PDF attachment', details: pdfError?.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      attachment = {
        name: message.attachment_name || 'attachment.pdf',
        bytes: new Uint8Array(await pdf.arrayBuffer()),
      };
    }

    let providerMessageId = null;
    let provider = 'zoho';
    if (useZoho) {
      providerMessageId = await sendViaZoho(message as EmailMessage, html, attachment);
    } else {
      provider = 'brevo';
      if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY is not configured');
      const brevoApiKey = BREVO_API_KEY;
      // Never trust a sender address supplied through the browser/database alone.
      const sendersRes = await fetch('https://api.brevo.com/v3/senders', {
        headers: { 'api-key': brevoApiKey, 'Accept': 'application/json' },
      });
      const sendersData = await sendersRes.json().catch(() => ({}));
      const senderAllowed = sendersRes.ok && (sendersData.senders || []).some(
        (sender: { active?: boolean; email?: string }) =>
          sender.active !== false && sender.email?.toLowerCase() === senderEmail,
      );
      if (!senderAllowed) {
        await supabase.from('email_messages').update({ status: 'Failed' }).eq('id', messageId);
        return new Response(
          JSON.stringify({ error: 'Sender is not active or verified in Brevo' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: message.sender_email, name: 'Kassam Trading Company' },
        to: [{ email: message.to_email, name: message.to_name || undefined }],
        subject: message.subject,
        htmlContent: html,
        replyTo: { email: REPLY_TO_EMAIL },
        ...(attachment ? { attachment: [{ name: attachment.name, content: bytesToBase64(attachment.bytes) }] } : {}),
        tags: ['ktc-trade-manager', message.campaign_id ? `campaign-${message.campaign_id}` : 'manual'],
      }),
    });

      const brevoData = await brevoRes.json().catch(async (parseErr) => {
      const rawText = await brevoRes.clone().text().catch(() => '<unreadable>');
      console.error('Failed to parse Brevo response as JSON:', parseErr.message, 'Raw response:', rawText);
      return { parseError: parseErr.message, rawText };
    });

      if (!brevoRes.ok) {
      console.error('Brevo API error:', brevoRes.status, JSON.stringify(brevoData));

      // Mark as failed
      await supabase
        .from('email_messages')
        .update({ status: 'Failed' })
        .eq('id', messageId);

      return new Response(
        JSON.stringify({ error: 'Brevo send failed', details: brevoData }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
      }
      providerMessageId = brevoData.messageId || null;
    }

    const { error: updateError } = await supabase
      .from('email_messages')
      .update({
        status: 'Sent',
        sent_at: new Date().toISOString(),
        brevo_message_id: provider === 'brevo' ? providerMessageId : null,
        delivery_provider: provider,
        provider_message_id: providerMessageId,
      })
      .eq('id', messageId);

    if (updateError) {
      return new Response(
        JSON.stringify({ warning: 'Email sent but failed to update record', details: updateError.message }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, provider, providerMessageId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // Don't leave a claimed row stuck on 'Sending'; Failed rows can be retried from Email history.
    if (supabase && claimedId) {
      await supabase.from('email_messages').update({ status: 'Failed' }).eq('id', claimedId).eq('status', 'Sending');
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
