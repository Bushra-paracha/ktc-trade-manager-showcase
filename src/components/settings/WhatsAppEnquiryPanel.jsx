import { useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { toE164 } from '../../lib/phone';
import { appGreetingText } from '../../hooks/useEnquiryReviews';

// Settings -> WhatsApp enquiries: who approved buyers are handed to, and the wording of
// the WhatsApp messages (migrations 202610020001, 202610050001). Admins edit; staff can view.
// Manual mode: the number stays on the WhatsApp Business app and staff send the messages;
// API mode: the CRM sends them through the Meta Cloud API.

const TEXTS = {
  manual: [
    ['greeting_text', 'Greeting (becomes the WhatsApp Business app greeting below)'],
    ['approved_text', 'When you approve (you send it from the WhatsApp Business app)'],
    ['rejected_text', 'When you reject (you send this yourself)'],
  ],
  api: [
    ['greeting_text', 'Greeting to a new WhatsApp contact (sent once, with the form link)'],
    ['received_text', 'After they submit the form'],
    ['approved_text', 'When you approve (sent automatically)'],
    ['rejected_text', 'When you reject (you send this yourself)'],
  ],
};

export default function WhatsAppEnquiryPanel({ isAdmin }) {
  const [values, setValues] = useState(null);
  const [stats, setStats] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.from('enquiry_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => setValues(data));
    supabase.from('whatsapp_outbox').select('status').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
      .then(({ data }) => setStats((data || []).reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {})));
  }, []);

  async function save(e) {
    e.preventDefault();
    setMessage(null);
    const phone = toE164(values.director_whatsapp, 'Pakistan');
    if (values.director_whatsapp && !phone.valid) {
      setMessage({ ok: false, text: 'Enter the WhatsApp number with the country code, e.g. +92 300 0000000.' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('enquiry_settings').update({
      whatsapp_mode: values.whatsapp_mode,
      director_name: values.director_name,
      director_whatsapp: phone.value || null,
      greeting_text: values.greeting_text,
      received_text: values.received_text,
      approved_text: values.approved_text,
      rejected_text: values.rejected_text,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setSaving(false);
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: 'Saved.' });
    if (!error) setValues((v) => ({ ...v, director_whatsapp: phone.value }));
  }

  async function copyGreeting() {
    try {
      await navigator.clipboard.writeText(appGreetingText(values));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (!values) return <div className="card"><Loader2 className="spin" size={18} /></div>;

  const manual = values.whatsapp_mode !== 'api';
  const field = (key) => ({
    value: values[key] || '',
    disabled: !isAdmin,
    onChange: (e) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  return (
    <form className="card" style={{ maxWidth: 720 }} onSubmit={save}>
      <div className="card-header">
        <div>
          <h3>WhatsApp enquiries</h3>
          <div className="card-header-sub">
            New contacts on the WhatsApp Business number get a greeting with a short form; their enquiry waits on the
            Approvals page. Approved buyers are asked to WhatsApp the person below.
          </div>
        </div>
      </div>

      <label style={labelStyle}>How WhatsApp messages are sent
        <select className="select-input" {...field('whatsapp_mode')}>
          <option value="manual">From the WhatsApp Business app (you send them)</option>
          <option value="api">Automatically by the CRM (Meta Cloud API connected)</option>
        </select>
      </label>

      {manual && (
        <div style={{ background: 'var(--color-bg)', borderRadius: 8, padding: 14, marginTop: 12, fontSize: 13.5, lineHeight: 1.5 }}>
          <strong>Greeting message for the WhatsApp Business app</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{appGreetingText(values)}</div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={copyGreeting}>
            <Copy size={14} /> {copied ? 'Copied' : 'Copy greeting'}
          </button>
          <p style={{ color: 'var(--color-ink-soft)', marginTop: 8 }}>
            In the WhatsApp Business app: Settings → Business tools → Greeting message → turn it on, paste this text,
            and set Recipients to &quot;Everyone not in address book&quot;. Enquiries from the form appear on the Approvals page;
            after you approve or reject, Approvals gives you the reply with an &quot;Open in WhatsApp&quot; button.
          </p>
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 12, marginTop: 12 }}>
        <label style={labelStyle}>Hand approved buyers to (name)
          <input className="select-input" {...field('director_name')} placeholder="Mr. ..." />
        </label>
        <label style={labelStyle}>Their WhatsApp number
          <input className="select-input" {...field('director_whatsapp')} placeholder="+92 300 0000000" />
        </label>
      </div>

      {TEXTS[manual ? 'manual' : 'api'].map(([key, label]) => (
        <label key={key} style={{ ...labelStyle, marginTop: 12 }}>{label}
          <textarea className="select-input" rows={4} {...field(key)} />
        </label>
      ))}
      <p style={{ fontSize: 12.5, color: 'var(--color-ink-soft)', marginTop: 8 }}>
        Placeholders: {'{name}'} buyer&apos;s first name, {'{ref}'} enquiry number, {'{link}'} form link,
        {' {director_name}'}, {'{director_whatsapp}'}, {'{director_link}'} (wa.me link).
      </p>

      {!manual && stats && (
        <p style={{ fontSize: 13, marginTop: 12 }}>
          Last 30 days: {stats.sent || 0} sent, {stats.pending || 0} queued, {stats.failed || 0} retrying,
          {' '}{stats.needs_template || 0} needing a template. Messages stay queued until the Meta WhatsApp connection is set up.
        </p>
      )}

      {message && <div className={'alert ' + (message.ok ? 'alert-success' : 'alert-danger')} style={{ marginTop: 12 }}>{message.text}</div>}
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      )}
    </form>
  );
}

const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: 'var(--color-ink-soft)' };
