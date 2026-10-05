import { useCallback, useEffect, useState } from 'react';
import { Loader2, MailX } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { formatDate } from '../../lib/dates';

const EMAIL_STATUS = {
  bounced: 'This address bounced. No automated emails are sent to it.',
  unsubscribed: 'This buyer unsubscribed. No automated emails are sent to them.',
  complained: 'This buyer marked our email as spam. No automated emails are sent to them.',
};

// Automated email sequences this buyer is in, with a way to stop them.
export default function ClientAutomationCard({ client, canEdit }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const emails = String(client.email || '').toLowerCase().split(/[\s,;]+/).filter((e) => e.includes('@'));
    const filters = [`client_id.eq.${client.id}`, ...emails.map((e) => `to_email.eq.${e}`)];
    const { data } = await supabase
      .from('email_sequence_enrollments')
      .select('id, status, current_step, next_send_at, stop_reason, updated_at, email_sequences(name)')
      .or(filters.join(','))
      .order('updated_at', { ascending: false })
      .limit(10);
    setEnrollments(data || []);
    setLoading(false);
  }, [client.id, client.email]);

  useEffect(() => {
    load();
  }, [load]);

  const active = enrollments.filter((e) => e.status === 'Active');

  async function stopAll() {
    if (!window.confirm(`Stop all automated emails to ${client.company}?`)) return;
    setStopping(true);
    const { data, error } = await supabase.rpc('stop_client_sequences', { p_client_id: client.id });
    setStopping(false);
    setMessage(error ? `Couldn't stop: ${error.message}` : `Stopped ${data} sequence${data === 1 ? '' : 's'}.`);
    load();
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Automated emails</h3>
          <div className="card-header-sub">Acknowledgements, quote follow-ups and re-engagement. They stop when the buyer replies.</div>
        </div>
        {canEdit && active.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={stopAll} disabled={stopping}>
            {stopping ? <Loader2 className="spin" size={14} /> : <MailX size={14} />} Stop automated emails
          </button>
        )}
      </div>
      {EMAIL_STATUS[client.email_status] && <div className="alert alert-danger">{EMAIL_STATUS[client.email_status]}</div>}
      {message && <div className="alert alert-info">{message}</div>}
      {loading ? (
        <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>
      ) : enrollments.length === 0 ? (
        <p className="buyer-profile-notes">Not in any automated email sequence.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sequence</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>
              {enrollments.map((e) => (
                <tr key={e.id}>
                  <td className="cell-strong">{e.email_sequences?.name || 'Sequence'}</td>
                  <td>{e.status}</td>
                  <td>
                    {e.status === 'Active'
                      ? `${e.current_step} sent · next ${formatDate(e.next_send_at, { day: 'numeric', month: 'short' })}`
                      : e.stop_reason || `Finished ${formatDate(e.updated_at, { day: 'numeric', month: 'short' })}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
