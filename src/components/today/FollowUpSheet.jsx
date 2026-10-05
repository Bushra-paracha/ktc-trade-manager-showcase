import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import Modal from '../Modal';
import { supabase } from '../../lib/supabaseClient';

const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
];

const NEXT_OPTIONS = [
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
];

// "I've replied / followed up": records how, closes the buyer's open reply tasks,
// marks new inquiries as replied and sets when to check again.
export default function FollowUpSheet({ client, replying = false, onClose, onSaved }) {
  const [channel, setChannel] = useState('whatsapp');
  const [days, setDays] = useState(replying ? 3 : 7);
  const [note, setNote] = useState('');
  const [quoteSent, setQuoteSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!client) return null;

  async function save() {
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('log_client_followup', {
      p_client_id: client.id,
      p_next_in_days: days,
      p_note: note,
      p_channel: channel,
      p_quote_sent: quoteSent,
    });
    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    const label = NEXT_OPTIONS.find((option) => option.days === days)?.label || `${days} days`;
    onSaved?.(`${client.company}: ${replying ? 'reply' : 'follow-up'} logged${quoteSent ? ', follow-up emails scheduled' : ''}. Next reminder in ${label}.`);
  }

  return (
    <Modal open onClose={onClose} title={client.company}>
      <div className="today-sheet">
        <p className="today-sheet-lead">{replying ? 'How did you reply?' : 'How did you follow up?'}</p>
        <div className="today-choice-row four" role="radiogroup" aria-label="Channel">
          {CHANNELS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={channel === option.value}
              className={'today-choice' + (channel === option.value ? ' selected' : '')}
              onClick={() => setChannel(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="today-sheet-lead">When should we remind you again?</p>
        <div className="today-choice-row" role="radiogroup" aria-label="Next follow-up">
          {NEXT_OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              role="radio"
              aria-checked={days === option.days}
              className={'today-choice' + (days === option.days ? ' selected' : '')}
              onClick={() => setDays(option.days)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="today-check">
          <input type="checkbox" checked={quoteSent} onChange={(e) => setQuoteSent(e.target.checked)} />
          <span>
            I sent them a price quotation
            <small>They'll get polite follow-up emails on day 3, 7 and 14 unless they reply first.</small>
          </span>
        </label>

        <label className="today-note-label">
          What happened? (optional)
          <textarea
            className="text-input"
            rows={2}
            maxLength={2000}
            placeholder={replying ? 'e.g. Sent CFR price for 2 x 20ft' : 'e.g. Spoke on WhatsApp, waiting for their price'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        <div className="today-sheet-actions">
          <button type="button" className="today-btn today-btn-primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="spin" size={20} /> : <Check size={20} />}
            {replying ? 'Save reply' : 'Save follow-up'}
          </button>
          <button type="button" className="today-btn today-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
