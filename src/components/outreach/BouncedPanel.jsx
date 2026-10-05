import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, Loader2, MailWarning, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { formatDate } from '../../lib/dates';

const KIND_LABEL = {
  permanent: 'Address not working',
  blocked: 'Blocked',
  temporary: 'Temporary',
};
const KIND_HELP = {
  permanent: 'The address or its domain does not exist. Use another address.',
  blocked: 'Rejected by a spam filter or block list. Another address at the company may get through.',
  temporary: 'Mailbox full or a short-term problem. The address may work later.',
};
const BATCH = 5;

// Buyers whose current email bounced, why, and alternative addresses found on
// their own website or among their saved contacts.
export default function BouncedPanel({ canEdit, onCountChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [searching, setSearching] = useState(new Set());
  const [progress, setProgress] = useState(null);
  const [manual, setManual] = useState({});
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('bounced_buyers');
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setError(null);
      setRows(data || []);
      onCountChange?.((data || []).length);
    }
    setLoading(false);
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => rows.filter((r) => kind === 'all' || r.kind === kind), [rows, kind]);
  const counts = useMemo(() => rows.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] || 0) + 1 }), {}), [rows]);
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.client_id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function findAlternatives(ids) {
    if (!ids.length) return;
    setError(null);
    setNotice('');
    let found = 0;
    let searched = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      setSearching(new Set(batch));
      setProgress({ done: i, total: ids.length });
      const { data, error: fnError } = await supabase.functions.invoke('find-alternative-emails', { body: { clientIds: batch } });
      if (fnError) {
        setError(`Search stopped after ${searched} buyer${searched === 1 ? '' : 's'}: ${fnError.message}`);
        break;
      }
      searched += batch.length;
      found += (data?.results || []).reduce((sum, r) => sum + (r.found || 0), 0);
    }
    setSearching(new Set());
    setProgress(null);
    setSelected(new Set());
    if (searched) {
      setNotice(`Searched ${searched} buyer${searched === 1 ? '' : 's'}: ${found} possible address${found === 1 ? '' : 'es'} found.`);
    }
    load();
  }

  async function applyEmail(row, email, alternativeId = null) {
    setBusy(`${row.client_id}:${email}`);
    setError(null);
    const { error: rpcError } = await supabase.rpc('replace_client_email', {
      p_client_id: row.client_id,
      p_new_email: email,
      p_alternative_id: alternativeId,
    });
    setBusy(null);
    if (rpcError) return setError(rpcError.message);
    setManual((m) => ({ ...m, [row.client_id]: '' }));
    setNotice(`${row.company} now uses ${email}. The bounced address is kept as an old contact.`);
    load();
  }

  async function dismiss(alternative) {
    setBusy(alternative.id);
    const { error: rpcError } = await supabase.rpc('dismiss_email_alternative', { p_alternative_id: alternative.id });
    setBusy(null);
    if (rpcError) return setError(rpcError.message);
    load();
  }

  if (loading) return <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>;

  return (
    <div className="bounced-panel">
      <div className="bounced-toolbar">
        <div className="bounced-kinds" role="tablist" aria-label="Bounce type">
          {[['all', `All (${rows.length})`], ...Object.keys(KIND_LABEL).map((k) => [k, `${KIND_LABEL[k]} (${counts[k] || 0})`])].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              className={'tab' + (kind === value ? ' active' : '')}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {canEdit && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!selected.size || Boolean(progress)}
            onClick={() => findAlternatives([...selected])}
          >
            {progress ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
            {progress
              ? `Searching ${progress.done + 1}–${Math.min(progress.done + BATCH, progress.total)} of ${progress.total}…`
              : `Find alternatives (${selected.size})`}
          </button>
        )}
      </div>
      {kind !== 'all' && <p className="cell-muted" style={{ margin: '0 0 10px' }}>{KIND_HELP[kind]}</p>}
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {visible.length === 0 ? (
        <div className="empty-state"><MailWarning /><h4>No bounced emails</h4><p>Buyers whose email bounces will appear here.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  {canEdit && (
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.client_id)))}
                    />
                  )}
                </th>
                <th>Buyer</th>
                <th>Bounced address</th>
                <th>Alternatives</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.client_id}>
                  <td>
                    {canEdit && (
                      <input type="checkbox" aria-label={`Select ${row.company}`} checked={selected.has(row.client_id)} onChange={() => toggle(row.client_id)} />
                    )}
                  </td>
                  <td>
                    <Link to={`/clients/${row.client_id}`} className="cell-strong" style={{ color: 'var(--color-primary)' }}>{row.company}</Link>
                    <div className="cell-muted">{[row.contact, row.country].filter(Boolean).join(' · ')}</div>
                    {row.website && (
                      <a className="cell-muted" href={row.website} target="_blank" rel="noreferrer">
                        {row.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} <ExternalLink size={11} />
                      </a>
                    )}
                  </td>
                  <td>
                    <div>{row.email}</div>
                    <span className={`bounce-kind ${row.kind}`}>{KIND_LABEL[row.kind]}</span>
                    <div className="cell-muted" title={row.reason}>{String(row.reason || '').slice(0, 80)}</div>
                    {row.bounced_at && <div className="cell-muted">{formatDate(row.bounced_at)}</div>}
                  </td>
                  <td className="bounce-alternatives">
                    {searching.has(row.client_id) && (
                      <div className="cell-muted"><Loader2 className="spin" size={13} /> Searching their website…</div>
                    )}
                    {(row.alternatives || []).map((alt) => (
                      <div key={alt.id} className="bounce-alt">
                        <div>
                          <strong>{alt.email}</strong>
                          <div className="cell-muted">
                            {alt.source === 'contact' ? 'Saved contact' : 'On their website'}
                            {alt.source_url && <> · <a href={alt.source_url} target="_blank" rel="noreferrer">page</a></>}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="bounce-alt-actions">
                            <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => applyEmail(row, alt.email, alt.id)}>
                              <Check size={13} /> Use
                            </button>
                            <button type="button" className="icon-btn" title="Dismiss" disabled={busy !== null} onClick={() => dismiss(alt)}>
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {!searching.has(row.client_id) && !(row.alternatives || []).length && (
                      <div className="cell-muted">
                        {row.checked_at ? `Nothing found (searched ${formatDate(row.checked_at)})` : 'Not searched yet'}
                        {canEdit && !row.checked_at && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(progress)} onClick={() => findAlternatives([row.client_id])}>
                            <Search size={13} /> Search
                          </button>
                        )}
                      </div>
                    )}
                    {canEdit && (
                      <form
                        className="bounce-manual"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const value = (manual[row.client_id] || '').trim();
                          if (value) applyEmail(row, value);
                        }}
                      >
                        <input
                          className="text-input"
                          type="email"
                          placeholder="Or type a new address"
                          value={manual[row.client_id] || ''}
                          onChange={(e) => setManual((m) => ({ ...m, [row.client_id]: e.target.value }))}
                        />
                        <button type="submit" className="btn btn-secondary btn-sm" disabled={!(manual[row.client_id] || '').trim() || busy !== null}>Save</button>
                      </form>
                    )}
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
