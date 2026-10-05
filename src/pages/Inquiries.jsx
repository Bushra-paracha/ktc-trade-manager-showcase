import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import Modal from '../components/Modal';
import { usePublicInquiries } from '../hooks/usePublicInquiries';

function formatDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Inquiries() {
  const { submissions, loading, error, refetch, deleteSubmission, convertToClient } = usePublicInquiries();

  const [search, setSearch] = useState('');
  const [active, setActive] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return submissions;
    return submissions.filter((s) => {
      const text = [s.full_name, s.company_name, s.email, s.phone, s.country, s.product_interest, s.message]
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [submissions, search]);

  async function handleConvert(submission) {
    setBusyId(submission.id);
    setActionMessage(null);
    const result = await convertToClient(submission);
    setBusyId(null);
    if (result.error) {
      setActionMessage(`Could not convert: ${result.error}`);
    } else {
      setActionMessage(`${submission.company_name || submission.full_name || 'Submission'} added to Clients.`);
      setActive(null);
    }
  }

  async function handleDelete(submission) {
    if (!window.confirm(`Delete the inquiry from ${submission.full_name || submission.email}? This cannot be undone.`)) return;
    setBusyId(submission.id);
    const result = await deleteSubmission(submission.id);
    setBusyId(null);
    if (result.error) {
      setActionMessage(`Could not delete: ${result.error}`);
    } else {
      setActive(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="eyebrow">Website</span>
          <h1>Inquiries</h1>
          <p>Every submission from the public "Request a Quote" form, in one place.</p>
        </div>
        <button className="btn btn-secondary" onClick={refetch}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {actionMessage && (
        <div className="buyer-inline-note" style={{ marginBottom: 16 }}>{actionMessage}</div>
      )}

      <div className="card" style={{ marginBottom: 16, padding: 14 }}>
        <div className="buyers-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, company, email, product..."
          />
        </div>
      </div>

      {loading ? (
        <div className="card loading-card"><Loader2 className="spin" /><p>Loading inquiries...</p></div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          <Inbox />
          <h4>No inquiries found</h4>
          <p>Submissions from the /quote page will show up here as soon as someone submits the form.</p>
        </div>
      ) : (
        <div className="card payment-list">
          {filtered.map((submission) => (
            <button
              type="button"
              key={submission.id}
              className="payment-list-row"
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setActive(submission)}
            >
              <div>
                <strong>{submission.company_name || submission.full_name || 'Unnamed inquiry'}</strong>
                <span>
                  {submission.full_name || 'No contact name'} · {submission.country || 'Unknown country'}
                </span>
              </div>
              <div>
                <strong>{submission.product_interest || 'Product not specified'}</strong>
                <span>{formatDate(submission.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!active} onClose={() => setActive(null)} title="Inquiry details">
        {active && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <strong style={{ display: 'block', fontSize: 16 }}>{active.company_name || active.full_name || 'Unnamed inquiry'}</strong>
              <span style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>Submitted {formatDate(active.created_at)}</span>
            </div>

            <div className="grid grid-2" style={{ gap: 10, fontSize: 13.5 }}>
              <div><strong>Contact</strong><div>{active.full_name || '—'}</div></div>
              <div><strong>Country</strong><div>{active.country || '—'}</div></div>
              <div><strong>Email</strong><div><Mail size={12} /> {active.email || '—'}</div></div>
              <div><strong>Phone</strong><div><MessageCircle size={12} /> {active.phone || '—'}</div></div>
              <div><strong>Product interest</strong><div>{active.product_interest || '—'}</div></div>
              <div><strong>Estimated quantity</strong><div>{active.quantity_estimate || '—'}</div></div>
            </div>

            {active.message && (
              <div>
                <strong style={{ fontSize: 13.5 }}>Message</strong>
                <p style={{ fontSize: 13.5, color: 'var(--color-ink-soft)', marginTop: 4 }}>{active.message}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(active)} disabled={busyId === active.id}>
                <Trash2 size={14} /> Delete
              </button>
              {active.status === 'Awaiting Review' ? (
                <Link to="/approvals" className="btn btn-primary btn-sm">Approve or reject in Approvals</Link>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => handleConvert(active)} disabled={busyId === active.id}>
                  {busyId === active.id ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} Convert to Client
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
