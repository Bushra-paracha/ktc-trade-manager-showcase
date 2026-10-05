import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hourglass, Loader2, Search, Send } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { formatDate } from '../lib/dates';

const WINDOWS = [60, 90, 180];

// Buyers we've been in touch with before but not recently. Re-engage starts the
// two-email "Dormant Re-Engagement" sequence (stops when they reply).
export default function Reengage() {
  const { canEdit } = useAuth();
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyEmail, setOnlyEmail] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('dormant_clients', { p_days: days });
    if (rpcError) setError(rpcError.message);
    setRows(data || []);
    setSelected(new Set());
    setLoading(false);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const eligible = (r) => r.email && r.email_status === 'ok' && !r.in_sequence;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (!onlyEmail || r.email)
      && (!q || [r.company, r.country, r.email, r.products].some((v) => String(v || '').toLowerCase().includes(q))));
  }, [rows, search, onlyEmail]);
  const selectable = visible.filter(eligible);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.slice(0, 200).map((r) => r.id)));
  }

  async function reengage() {
    const ids = [...selected];
    if (!window.confirm(`Send the two-email re-engagement check-in to ${ids.length} buyer${ids.length === 1 ? '' : 's'}? It stops for anyone who replies.`)) return;
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('reengage_clients', { p_client_ids: ids });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setResult(data);
    load();
  }

  async function markDormant() {
    const ids = [...selected];
    setBusy(true);
    const { error: updateError } = await supabase.from('clients').update({ status: 'Dormant' }).in('id', ids);
    setBusy(false);
    if (updateError) return setError(updateError.message);
    setResult({ marked: ids.length });
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Re-engage buyers</h1>
          <p>Buyers you've been in touch with before but not recently. Re-engage sends a short two-email check-in as Sultan Ali Paracha; it stops when they reply.</p>
        </div>
      </div>

      <div className="analytics-filters" role="tablist" aria-label="Quiet for">
        {WINDOWS.map((w) => (
          <button key={w} type="button" role="tab" aria-selected={days === w} className={'tab' + (days === w ? ' active' : '')} onClick={() => setDays(w)}>
            No contact for {w}+ days
          </button>
        ))}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {result && (
        <div className="alert alert-success" role="status">
          {result.marked != null
            ? `${result.marked} buyer${result.marked === 1 ? '' : 's'} marked Dormant.`
            : `Re-engagement started for ${result.started}.${result.skipped?.length ? ` Skipped ${result.skipped.length}: ${result.skipped.slice(0, 4).map((s) => `${s.company} (${s.reason})`).join(', ')}${result.skipped.length > 4 ? '…' : ''}` : ''}`}
        </div>
      )}

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 220px' }}>
            <Search size={15} />
            <input className="text-input" placeholder="Search company, country, product" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={onlyEmail} onChange={(e) => setOnlyEmail(e.target.checked)} /> Only buyers with an email
          </label>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={!selected.size || busy} onClick={markDormant}>
                <Hourglass size={14} /> Mark as Dormant
              </button>
              <button className="btn btn-primary btn-sm" disabled={!selected.size || busy} onClick={reengage}>
                {busy ? <Loader2 className="spin" size={14} /> : <Send size={14} />} Re-engage {selected.size || ''}
              </button>
            </div>
          )}
        </div>
        {loading ? (
          <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state"><Hourglass /><h4>Nobody here</h4><p>Every buyer you've contacted has heard from you within {days} days.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{canEdit && <input type="checkbox" aria-label="Select all eligible" checked={allSelected} onChange={toggleAll} />}</th>
                  <th>Buyer</th><th>Status</th><th>Last contact</th><th>Orders</th><th>Email</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>{canEdit && <input type="checkbox" aria-label={`Select ${r.company}`} disabled={!eligible(r)} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                    <td className="cell-strong">
                      <Link to={`/clients/${r.id}`} style={{ color: 'var(--color-primary)' }}>{r.company}</Link>
                      <div className="card-header-sub">{[r.country, r.products].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{r.status}</td>
                    <td>{r.days_quiet} days ago<div className="card-header-sub">{formatDate(r.last_contacted_at)}</div></td>
                    <td className="num">{r.orders}</td>
                    <td>
                      {r.email || <span className="cell-muted">No email</span>}
                      {r.email && r.email_status !== 'ok' && <div className="danger-text">{r.email_status}</div>}
                      {r.in_sequence && <div className="card-header-sub">Already in an email sequence</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
