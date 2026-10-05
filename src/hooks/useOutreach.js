import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchAll } from '../lib/fetchAll';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const ZOHO_SENDER_FALLBACK = [
  'staff@example.com',
  'staff@example.com',
  'staff@example.com',
  'staff@example.com',
  'staff@example.com',
].map((email) => ({
  id: `zoho:${email}`,
  email,
  name: 'NBMT Trading',
  active: true,
  provider: 'zoho',
}));

// ---------- Templates ----------
export function useEmailTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) setError(error.message);
    else setTemplates(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  return { templates, loading, error, refetch: fetchTemplates };
}

export async function createEmailTemplate({
  name, subject, bodyHtml, attachmentPath = null, attachmentName = null,
}) {
  const { data, error } = await supabase
    .from('email_templates')
    .insert([{
      name: name.trim(),
      subject: subject.trim(),
      body_html: bodyHtml,
      category: 'Custom',
      attachment_path: attachmentPath,
      attachment_name: attachmentName,
    }])
    .select()
    .single();

  return { data, error: error?.message || null };
}

// Edit a saved template. attachment: undefined = keep, null = remove,
// { path, name } = replace. The old PDF is removed from storage once the row is saved.
export async function updateEmailTemplate(template, { name, subject, bodyHtml, attachment }) {
  const updates = {
    name: name.trim(),
    subject: subject.trim(),
    body_html: bodyHtml,
    updated_at: new Date().toISOString(),
  };
  if (attachment !== undefined) {
    updates.attachment_path = attachment?.path || null;
    updates.attachment_name = attachment?.name || null;
  }
  const { data, error } = await supabase
    .from('email_templates')
    .update(updates)
    .eq('id', template.id)
    .select()
    .single();
  if (!error && attachment !== undefined && template.attachment_path && template.attachment_path !== attachment?.path) {
    await supabase.storage.from('email-attachments').remove([template.attachment_path]);
  }
  return { data, error: error?.message || null };
}

export async function deleteEmailTemplate(template) {
  const { error } = await supabase.from('email_templates').delete().eq('id', template.id);
  if (!error && template.attachment_path) {
    await supabase.storage.from('email-attachments').remove([template.attachment_path]);
  }
  return { error: error?.message || null };
}

export async function uploadTemplatePdf(file) {
  if (file.type !== 'application/pdf') return { error: 'Only PDF files are supported.' };
  if (file.size > 10 * 1024 * 1024) return { error: 'PDF must be 10 MB or smaller.' };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${window.crypto.randomUUID()}/${safeName}`;
  const { error } = await supabase.storage
    .from('email-attachments')
    .upload(path, file, { contentType: 'application/pdf', upsert: false });
  return error
    ? { error: error.message }
    : { data: { path, name: file.name } };
}

async function callSenderManager(action, payload = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-email-senders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Sender management failed');
  return data;
}

export function useEmailSenders() {
  const [senders, setSenders] = useState([]);
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callSenderManager('list');
      const configuredSenders = (data.senders || []).filter((sender) => sender.active !== false);
      const senderMap = new Map(configuredSenders.map((sender) => [sender.email.toLowerCase(), sender]));
      for (const sender of ZOHO_SENDER_FALLBACK) {
        if (!senderMap.has(sender.email)) senderMap.set(sender.email, sender);
      }
      setSenders([...senderMap.values()]);
      setDomains(data.domains || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { senders, domains, loading, error, refetch };
}

export const addEmailDomain = (domain) => callSenderManager('add-domain', { domain });
export const verifyEmailDomain = (domain) => callSenderManager('verify-domain', { domain });
export const addEmailSender = ({ email, name }) => callSenderManager('add-sender', { email, name });

// ---------- Campaigns + Messages ----------
export function useEmailMessages() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checkingReplies, setCheckingReplies] = useState(false);
  const [checkError, setCheckError] = useState(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await fetchAll(() => supabase
      .from('email_messages')
      .select('*, clients(company, country), email_replies(*)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true }));

    if (error) setError(error.message);
    else setMessages(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const [checkResult, setCheckResult] = useState(null);

  // Calls the check-email-replies Edge Function, which connects to the
  // KTC mailboxes via IMAP and matches new replies to sent messages.
  const checkForReplies = useCallback(async () => {
    setCheckingReplies(true);
    setCheckError(null);
    setCheckResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-email-replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        setCheckError(data.error || 'Failed to check replies');
      } else {
        setCheckResult(data);
        await fetchMessages();
      }
      setCheckingReplies(false);
      return data;
    } catch (err) {
      setCheckError(err.message);
      setCheckingReplies(false);
      return { error: err.message };
    }
  }, [fetchMessages]);

  return { messages, loading, error, refetch: fetchMessages, checkForReplies, checkingReplies, checkError, checkResult };
}

// Calls the sync-brevo-templates Edge Function to pull in any templates
// created directly in Brevo's own template editor.
export async function syncTemplatesFromBrevo() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-brevo-templates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    return { error: data.error || 'Failed to sync templates' };
  }
  return { data };
}
export function renderTemplate(str, client) {
  if (!str) return '';
  return str
    .replace(/\{\{company\}\}/g, client.company || '')
    .replace(/\{\{contact\}\}/g, client.contact || 'Sir/Madam')
    .replace(/\{\{country\}\}/g, client.country || '')
    .replace(/\{\{city\}\}/g, client.city || '');
}

// A dropped connection (Safari: "Load failed", Chrome: "Failed to fetch") is retried a few
// times before the email is reported as failed.
const NETWORK_ERROR = /load failed|failed to fetch|networkerror|network request failed|network connection was lost/i;
const RETRY_DELAYS_MS = [1500, 4000, 8000];
const HANDLED_STATUSES = ['Sending', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Replied'];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isNetworkError = (error) => Boolean(error) && NETWORK_ERROR.test(String(error.message || error));

// Saves the Pending row. The id is made here, so a retry after a dropped connection
// can't create a second row: if the first insert did arrive, the retry hits a duplicate key.
async function insertPendingMessage(row) {
  for (let attempt = 0; ; attempt += 1) {
    const { error } = await supabase.from('email_messages').insert([row]);
    if (!error || error.code === '23505') return null;
    if (!isNetworkError(error) || attempt >= RETRY_DELAYS_MS.length) return error;
    await wait(RETRY_DELAYS_MS[attempt]);
  }
}

// Asks send-campaign-email to send one row. The function claims the row before sending, so
// a retried request is answered 409 "already sending/sent" instead of emailing twice.
async function callSendFunction(messageId, html) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-campaign-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ messageId, html }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { success: true };
      if (res.status === 409 && data.alreadyHandled) {
        return HANDLED_STATUSES.includes(data.status)
          ? { success: true }
          : { success: false, error: data.error || 'Already handled' };
      }
      return { success: false, error: data.error || 'Send failed' };
    } catch (err) {
      if (!isNetworkError(err)) return { success: false, error: err.message };
      if (attempt >= RETRY_DELAYS_MS.length) {
        return { success: false, error: 'Connection lost. Check Email history: if this one is not marked Sent, send to this buyer again when you are back online.' };
      }
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// Creates one email_messages row per selected client, then calls the
// send-campaign-email Edge Function for each one.
export async function sendOutreachEmails({
  clients, subjectTemplate, bodyTemplate, senderEmail, campaignId = null,
  attachmentPath = null, attachmentName = null,
}) {
  const results = [];

  for (const client of clients) {
    const subject = renderTemplate(subjectTemplate, client);
    const html = renderTemplate(bodyTemplate, client);
    const id = window.crypto.randomUUID();

    // 1. Insert the message row as "Pending"
    const insertError = await insertPendingMessage({
      id,
      campaign_id: campaignId,
      client_id: client.id,
      to_email: client.email,
      to_name: client.contact,
      subject,
      body_html: html,
      sender_email: senderEmail,
      attachment_path: attachmentPath,
      attachment_name: attachmentName,
      status: 'Pending',
    });
    if (insertError) {
      results.push({
        client: client.company,
        success: false,
        error: isNetworkError(insertError) ? 'Connection lost before saving; nothing was sent.' : insertError.message,
      });
      continue;
    }

    // 2. Call the Edge Function to actually send via Brevo
    const result = await callSendFunction(id, html);
    results.push({ client: client.company, ...result });
  }

  return results;
}

// Retries a single failed/bounced message by re-calling the send function
// against the SAME email_messages row, reusing its stored body_html so the
// original content (with merge tags already applied) is sent again exactly as before.
export async function retryMessage(message) {
  if (!message.body_html) {
    return { success: false, error: 'No stored email content to retry (this message was sent before retry support was added).' };
  }

  // Reset status to Pending before retrying, so it's clear a retry is in-flight
  const { error } = await supabase.from('email_messages').update({ status: 'Pending', bounce_reason: null }).eq('id', message.id);
  if (error) return { success: false, error: error.message };

  return callSendFunction(message.id, message.body_html);
}

// ---------- Last-emailed lookup ----------
// Lightweight hook for pages (like Clients) that just need to know when a
// client was last successfully emailed, without loading full message/reply data.
const SENT_STATUSES = ['Sent', 'Delivered', 'Opened', 'Clicked', 'Replied'];

export function useLastEmailedByClient() {
  const [lastEmailedByClient, setLastEmailedByClient] = useState(new Map());
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('email_messages')
      .select('client_id, created_at, status')
      .in('status', SENT_STATUSES)
      .order('created_at', { ascending: false });

    if (!error && rows) {
      const map = new Map();
      for (const row of rows) {
        // Rows are ordered most-recent-first, so the first time we see a
        // client_id is their most recent successfully sent email.
        if (row.client_id && !map.has(row.client_id)) {
          map.set(row.client_id, row.created_at);
        }
      }
      setLastEmailedByClient(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { lastEmailedByClient, loading, refetch: fetchData };
}

// Builds the same client_id -> last-sent-date map from an already-loaded
// list of email_messages (e.g. from useEmailMessages), so pages that already
// have messages loaded don't need a second query.
export function buildLastEmailedMap(messages) {
  const map = new Map();
  for (const message of messages) {
    if (!message.client_id || !SENT_STATUSES.includes(message.status)) continue;
    const at = message.sent_at || message.created_at;
    if (!at) continue;
    const existing = map.get(message.client_id);
    if (!existing || new Date(at) > new Date(existing)) {
      map.set(message.client_id, at);
    }
  }
  return map;
}

export function formatDaysAgo(dateStr) {
  if (!dateStr) return null;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

// Retries every currently Failed message in one go, returning a summary.
export async function retryAllFailed(failedMessages) {
  const results = [];
  for (const msg of failedMessages) {
    const result = await retryMessage(msg);
    results.push({ id: msg.id, company: msg.clients?.company || msg.to_email, ...result });
  }
  return results;
}
