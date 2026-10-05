import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Enquiries waiting for (or past) a staff decision: WhatsApp Business messages from new
// numbers and website form submissions (migration 202610020001).
export const OPEN_STATUSES = ['awaiting_form', 'pending'];

export function useEnquiryReviews(view = 'open') {
  const [reviews, setReviews] = useState([]);
  const [messages, setMessages] = useState({});
  const [outbox, setOutbox] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase.from('enquiry_reviews').select('*').order('created_at', { ascending: false }).limit(200);
    query = view === 'open' ? query.in('status', OPEN_STATUSES) : query.in('status', ['approved', 'rejected']);
    const { data, error: loadError } = await query;
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const rows = data || [];
    setReviews(rows);

    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const [{ data: chat }, { data: sent }] = await Promise.all([
        supabase.from('inbound_whatsapp').select('id, enquiry_id, body, message_type, received_at, risk_flags')
          .in('enquiry_id', ids).order('received_at'),
        supabase.from('whatsapp_outbox').select('id, enquiry_id, kind, status, last_error, created_at, sent_at')
          .in('enquiry_id', ids).order('created_at'),
      ]);
      setMessages(groupBy(chat || [], 'enquiry_id'));
      setOutbox(groupBy(sent || [], 'enquiry_id'));
    } else {
      setMessages({});
      setOutbox({});
    }
    setLoading(false);
  }, [view]);

  useEffect(() => {
    load();
  }, [load]);

  return { reviews, messages, outbox, loading, error, reload: load };
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    (acc[row[key]] ||= []).push(row);
    return acc;
  }, {});
}

export async function approveEnquiry(id, note, message) {
  const { data, error } = await supabase.rpc('approve_enquiry', {
    p_id: id, p_note: note || null, p_message: message || null,
  });
  return { data, error: error?.message || null };
}

export async function rejectEnquiry(id, reason) {
  const { data, error } = await supabase.rpc('reject_enquiry', { p_id: id, p_reason: reason || null });
  return { data, error: error?.message || null };
}

export async function updateEnquiry(id, fields) {
  const { error } = await supabase.rpc('update_enquiry', { p_id: id, p_data: fields });
  return { error: error?.message || null };
}

export async function countOpenEnquiries() {
  const { count } = await supabase.from('enquiry_reviews')
    .select('id', { count: 'exact', head: true }).in('status', OPEN_STATUSES);
  return count || 0;
}

// Fills the same placeholders as public.enquiry_text(), for previews in the app.
export function fillEnquiryText(template, review, settings) {
  const firstName = String(review?.contact_name || '').trim().split(/\s+/)[0] || 'there';
  const director = settings?.director_whatsapp || '';
  return String(template || '')
    .replaceAll('{name}', firstName)
    .replaceAll('{ref}', review?.ref || '')
    .replaceAll('{link}', `${String(settings?.form_base_url || '').replace(/\/$/, '')}/enquiry/${review?.form_token || ''}`)
    .replaceAll('{director_name}', settings?.director_name || '')
    .replaceAll('{director_whatsapp}', director)
    .replaceAll('{director_link}', `https://wa.me/${director.replace(/\D/g, '')}`);
}

// Greeting for the WhatsApp Business app (manual mode): the app can't fill in names, so
// {name} is dropped and {link} is the quote form with ?via=whatsapp.
export function appGreetingText(settings) {
  const link = `${String(settings?.form_base_url || '').replace(/\/$/, '')}/quote?via=whatsapp`;
  return String(settings?.greeting_text || '')
    .replace(/\s*\{name\}/g, '')
    .replaceAll('{ref}', '')
    .replaceAll('{link}', link)
    .replaceAll('{director_name}', settings?.director_name || '')
    .trim();
}

export function whatsappLink(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
