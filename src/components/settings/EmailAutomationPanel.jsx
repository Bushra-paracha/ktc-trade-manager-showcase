import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { formatDate } from '../../lib/dates';

const TRIGGERS = {
  new_lead: 'A new buyer is added with status New (cold outreach)',
  website_inquiry: 'Someone sends the website inquiry form',
  quote_sent: 'An inquiry is marked Quote Sent',
  manual_reengage: 'Someone clicks Re-engage on a dormant buyer',
};

// Switch sequences on or off and see who is in them. Sending is done by the
// run-email-automation Edge Function every 10 minutes (80 emails a day at most).
export default function EmailAutomationPanel({ canEdit }) {
  const [sequences, setSequences] = useState([]);
  const [suppressions, setSuppressions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const [seqRes, enrRes, supRes] = await Promise.all([
      supabase.from('email_sequences').select('id, name, trigger_event, active, sender_email').order('name'),
      supabase.from('email_sequence_enrollments').select('sequence_id, status'),
      supabase.from('email_suppressions').select('email, reason, created_at').order('created_at', { ascending: false }).limit(20),
    ]);
    const failed = seqRes.error || enrRes.error || supRes.error;
    if (failed) setError(failed.message);
    const counts = {};
    for (const row of enrRes.data || []) {
      counts[row.sequence_id] ??= { Active: 0, Completed: 0, Stopped: 0 };
      counts[row.sequence_id][row.status] = (counts[row.sequence_id][row.status] || 0) + 1;
    }
    setSequences((seqRes.data || []).map((s) => ({ ...s, counts: counts[s.id] || { Active: 0, Completed: 0, Stopped: 0 } })));
    setSuppressions(supRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(sequence) {
    const turningOff = sequence.active;
    if (turningOff && !window.confirm(`Switch off "${sequence.name}"? Buyers already in it get no further emails until it's switched back on.`)) return;
    setSaving(sequence.id);
    const { error: saveError } = await supabase.from('email_sequences').update({ active: !sequence.active }).eq('id', sequence.id);
    setSaving(null);
    if (saveError) setError(saveError.message);
    load();
  }

  if (loading) return <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Email sequences</h3>
            <div className="card-header-sub">
              Sent as Sultan Ali Paracha from exports@. Every sequence stops when the buyer replies by email or WhatsApp. None include prices, contracts or bank details.
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sequence</th><th>Starts when</th><th>In progress</th><th>Finished</th><th>Stopped</th><th>On</th></tr></thead>
            <tbody>
              {sequences.map((s) => (
                <tr key={s.id}>
                  <td className="cell-strong">{s.name}</td>
                  <td>{TRIGGERS[s.trigger_event] || s.trigger_event}</td>
                  <td>{s.counts.Active}</td>
                  <td>{s.counts.Completed}</td>
                  <td>{s.counts.Stopped}</td>
                  <td>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input type="checkbox" checked={s.active} disabled={!canEdit || saving === s.id} onChange={() => toggle(s)} />
                      {s.active ? 'On' : 'Off'}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Do-not-email list</h3>
            <div className="card-header-sub">Addresses that bounced, complained or unsubscribed. They never receive automated emails.</div>
          </div>
        </div>
        {suppressions.length === 0 ? (
          <p className="buyer-profile-notes">No addresses yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Email</th><th>Reason</th><th>Since</th></tr></thead>
              <tbody>
                {suppressions.map((row) => (
                  <tr key={row.email}><td>{row.email}</td><td>{row.reason.replace('_', ' ')}</td><td>{formatDate(row.created_at)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
