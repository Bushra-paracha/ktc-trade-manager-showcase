import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Copy, Globe, Loader2, Mail, MessageCircle, Pencil,
  RefreshCw, ShieldCheck, XCircle,
} from 'lucide-react';
import Modal from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import {
  approveEnquiry, fillEnquiryText, rejectEnquiry, updateEnquiry, useEnquiryReviews, whatsappLink,
} from '../hooks/useEnquiryReviews';

const STATUS_LABEL = {
  awaiting_form: 'Waiting for their form',
  pending: 'Ready to review',
  approved: 'Approved',
  rejected: 'Rejected',
};
const SENT_LABEL = { greeting: 'Greeting + form link', received: '"We received your enquiry"', approved: 'Hand-off to Director', custom: 'Message' };
const SEND_STATE = {
  pending: 'queued',
  sent: 'sent',
  failed: 'retrying',
  needs_template: 'not sent: needs an approved template or the WhatsApp Business app',
};
const EDIT_FIELDS = [
  ['contact_name', 'Contact name'], ['company', 'Company'], ['country', 'Country'], ['email', 'Email'],
  ['product', 'Product'], ['quantity', 'Quantity'], ['destination_port', 'Destination port'],
];

function when(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function useEnquirySettings() {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    supabase.from('enquiry_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => setSettings(data));
  }, []);
  return settings;
}

function Pill({ tone = 'neutral', children }) {
  const tones = {
    neutral: { background: 'var(--color-bg)', color: 'var(--color-ink-soft)' },
    accent: { background: 'var(--color-accent-soft)', color: 'var(--color-ink)' },
    success: { background: 'var(--color-success-soft)', color: 'var(--color-success)' },
    danger: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' },
  };
  return (
    <span style={{ ...tones[tone], borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function CopyBox({ text }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, background: 'var(--color-bg)', borderRadius: 8, padding: 12, lineHeight: 1.5 }}>{text}</div>
      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={copy}>
        <Copy size={14} /> {copied ? 'Copied' : 'Copy message'}
      </button>
    </div>
  );
}

export default function Approvals() {
  const { canEdit } = useAuth();
  const [view, setView] = useState('open');
  const { reviews, messages, outbox, loading, error, reload } = useEnquiryReviews(view);
  const settings = useEnquirySettings();
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [editing, setEditing] = useState(null);

  const missingDirector = settings && !settings.director_whatsapp;

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="eyebrow">WhatsApp & website</span>
          <h1>Approvals</h1>
          <p>
            New enquiries wait here until you approve or reject them. Approving adds the buyer to the CRM and asks
            them on WhatsApp to message {settings?.director_name || 'the Director'} directly.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={reload}><RefreshCw size={16} /> Refresh</button>
      </div>

      {missingDirector && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} /> Add the Director&apos;s WhatsApp number in Settings → WhatsApp enquiries before approving WhatsApp enquiries.
        </div>
      )}

      <div className="tabs">
        <div className={'tab' + (view === 'open' ? ' active' : '')} onClick={() => setView('open')} role="button">Waiting</div>
        <div className={'tab' + (view === 'decided' ? ' active' : '')} onClick={() => setView('decided')} role="button">Decided</div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}><AlertCircle size={16} /> {error}</div>}

      {loading ? (
        <div className="card loading-card"><Loader2 className="spin" /><p>Loading enquiries...</p></div>
      ) : reviews.length === 0 ? (
        <div className="card empty-state">
          <ShieldCheck />
          <h4>{view === 'open' ? 'Nothing waiting for approval' : 'No decisions yet'}</h4>
          <p>
            {view === 'open'
              ? 'New WhatsApp contacts and website enquiries will appear here.'
              : 'Approved and rejected enquiries will be listed here.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {reviews.map((r) => (
            <EnquiryCard
              key={r.id}
              review={r}
              chat={messages[r.id] || []}
              sent={outbox[r.id] || []}
              canEdit={canEdit}
              onApprove={() => setApproving(r)}
              onReject={() => setRejecting(r)}
              onEdit={() => setEditing(r)}
            />
          ))}
        </div>
      )}

      <ApproveModal review={approving} settings={settings} onClose={() => setApproving(null)} onDone={reload} />
      <RejectModal review={rejecting} onClose={() => setRejecting(null)} onDone={reload} />
      <EditModal review={editing} onClose={() => setEditing(null)} onDone={reload} />
    </div>
  );
}

function EnquiryCard({ review: r, chat, sent, canEdit, onApprove, onReject, onEdit }) {
  const title = r.company || r.contact_name || r.whatsapp_number || r.email || r.ref;
  const open = r.status === 'awaiting_form' || r.status === 'pending';
  const tone = { pending: 'accent', approved: 'success', rejected: 'danger' }[r.status] || 'neutral';
  const details = [
    ['Contact', r.contact_name], ['Country', r.country], ['WhatsApp / phone', r.whatsapp_number], ['Email', r.email],
    ['Product', r.product], ['Quantity', r.quantity], ['Destination port', r.destination_port],
  ];

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontSize: 17, display: 'block' }}>{title}</strong>
          <span style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>
            {r.ref} · {r.channel === 'website' ? <><Globe size={12} /> Website</> : <><MessageCircle size={12} /> WhatsApp</>} · {when(r.created_at)}
          </span>
        </div>
        <Pill tone={tone}>{STATUS_LABEL[r.status]}</Pill>
      </div>

      {r.risk_flags?.length > 0 && (
        <div className="alert alert-danger" style={{ marginTop: 12 }}>
          <AlertTriangle size={16} /> Check carefully: {r.risk_flags.join(', ').replaceAll('_', ' ')}. Don&apos;t open links or files from this sender.
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 10, fontSize: 14, marginTop: 14 }}>
        {details.map(([label, value]) => (
          <div key={label}>
            <div style={{ color: 'var(--color-ink-soft)', fontSize: 12.5 }}>{label}</div>
            <div>{value || '—'}</div>
          </div>
        ))}
      </div>

      {r.message && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: 'var(--color-ink-soft)', fontSize: 12.5 }}>Message</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.message}</div>
        </div>
      )}

      {chat.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>WhatsApp chat ({chat.length})</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {chat.map((m) => (
              <div key={m.id} style={{ background: 'var(--color-bg)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5 }}>
                <div style={{ color: 'var(--color-ink-soft)', fontSize: 12 }}>{when(m.received_at)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {sent.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-ink-soft)' }}>
          {sent.map((s) => (
            <div key={s.id}>{SENT_LABEL[s.kind] || s.kind}: {SEND_STATE[s.status] || s.status}{s.sent_at ? ` ${when(s.sent_at)}` : ''}</div>
          ))}
        </div>
      )}

      {!open && (
        <div style={{ marginTop: 14, fontSize: 14 }}>
          <div style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>
            {r.status === 'approved' ? 'Approved' : 'Rejected'} {when(r.decided_at)}{r.decision_note ? ` · ${r.decision_note}` : ''}
          </div>
          {r.client_id && <Link to={`/clients/${r.client_id}`} className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>Open buyer</Link>}
          {r.reply_text && (r.status === 'rejected' || sent.length === 0) && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>Message to send the buyer</summary>
              <div style={{ marginTop: 8 }}><ReplyActions review={r} text={r.reply_text} /></div>
            </details>
          )}
        </div>
      )}

      {open && canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" className="btn btn-primary" onClick={onApprove}><CheckCircle2 size={16} /> Approve</button>
          <button type="button" className="btn btn-secondary" onClick={onReject}><XCircle size={16} /> Reject</button>
          <button type="button" className="btn btn-ghost" onClick={onEdit}><Pencil size={16} /> Edit details</button>
        </div>
      )}
    </div>
  );
}

function ReplyActions({ review, text }) {
  const wa = whatsappLink(review.whatsapp_number, text);
  return (
    <div>
      <CopyBox text={text} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {wa && <a className="btn btn-secondary btn-sm" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Open in WhatsApp</a>}
        {review.email && (
          <a className="btn btn-secondary btn-sm"
             href={`mailto:${review.email}?subject=${encodeURIComponent(`Your enquiry ${review.ref} - Kassam Trading Company`)}&body=${encodeURIComponent(text)}`}>
            <Mail size={14} /> Email
          </a>
        )}
      </div>
    </div>
  );
}

function ApproveModal({ review, settings, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!review) return;
    setNote('');
    setError(null);
    setResult(null);
    setMessage(fillEnquiryText(settings?.approved_text, review, settings));
  }, [review, settings]);

  async function submit() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await approveEnquiry(review.id, note, message);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setResult(data);
    onDone();
  }

  return (
    <Modal open={!!review} onClose={onClose} title={result ? 'Enquiry approved' : 'Approve enquiry'}>
      {review && !result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14 }}>
            {review.company || review.contact_name || review.whatsapp_number} will be added to the CRM with a new inquiry and a reply task.
            {!review.whatsapp_number
              ? ' They have no WhatsApp number, so send them this message yourself:'
              : settings?.whatsapp_mode === 'api'
                ? ' This message will be sent to them on WhatsApp:'
                : ' Next, you send them this message from the WhatsApp Business app:'}
          </p>
          <textarea className="select-input" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink-soft)' }}>
            Note for the team (optional)
            <input className="select-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Discussed with Abu, good buyer for IRRI-6" />
          </label>
          {error && <div className="alert alert-danger"><AlertCircle size={16} /> {error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !message.trim()}>
              {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} Approve
            </button>
          </div>
        </div>
      )}
      {review && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
          <p>
            Added to the CRM with inquiry {result.inquiry_id}.{' '}
            {result.whatsapp_queued
              ? 'The WhatsApp message is queued and goes out within a minute once WhatsApp is connected.'
              : review.whatsapp_number
                ? 'Now send them this message: tap Open in WhatsApp on the phone or computer where the WhatsApp Business number is logged in.'
                : 'Send them this message yourself:'}
          </p>
          {!result.whatsapp_queued && <ReplyActions review={review} text={result.message} />}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Link to={`/clients/${result.client_id}`} className="btn btn-secondary">Open buyer</Link>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RejectModal({ review, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!review) return;
    setReason('');
    setError(null);
    setResult(null);
  }, [review]);

  async function submit() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await rejectEnquiry(review.id, reason);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setResult(data);
    onDone();
  }

  return (
    <Modal open={!!review} onClose={onClose} title={result ? 'Message to send the buyer' : 'Reject enquiry'}>
      {review && !result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14 }}>
            Nothing is sent automatically. After rejecting, you&apos;ll get a polite message to send them yourself, so the door stays open.
          </p>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink-soft)' }}>
            Reason (only the team sees this)
            <input className="select-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Volume too small, price expectations too low" />
          </label>
          {error && <div className="alert alert-danger"><AlertCircle size={16} /> {error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-secondary" onClick={submit} disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />} Reject
            </button>
          </div>
        </div>
      )}
      {review && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ReplyActions review={review} text={result.message} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditModal({ review, onClose, onDone }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!review) return;
    setForm(Object.fromEntries(EDIT_FIELDS.map(([key]) => [key, review[key] || ''])));
    setError(null);
  }, [review]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await updateEnquiry(review.id, form);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onDone();
    onClose();
  }

  return (
    <Modal open={!!review} onClose={onClose} title="Edit enquiry details">
      {review && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {EDIT_FIELDS.map(([key, label]) => (
            <label key={key} style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink-soft)' }}>
              {label}
              <input className="select-input" value={form[key] || ''} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </label>
          ))}
          {error && <div className="alert alert-danger"><AlertCircle size={16} /> {error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
