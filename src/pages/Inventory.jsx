import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Boxes, Edit2, History, Loader2, Plus, PlusCircle } from 'lucide-react';
import Modal from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { formatDate, localDateString } from '../lib/dates';

const KINDS = [
  { value: 'production', label: 'Milled / produced', sign: 1 },
  { value: 'purchase', label: 'Bought in', sign: 1 },
  { value: 'return', label: 'Returned', sign: 1 },
  { value: 'opening', label: 'Opening balance', sign: 1 },
  { value: 'adjustment_in', label: 'Correction: add', sign: 1 },
  { value: 'adjustment_out', label: 'Correction: remove', sign: -1 },
];
const KIND_LABELS = {
  production: 'Milled / produced', purchase: 'Bought in', sale: 'Shipped', return: 'Returned',
  opening: 'Opening balance', adjustment: 'Correction',
};
const CATEGORIES = ['Rice', 'Salt', 'Seeds', 'Grain', 'Other'];
const EMPTY_PRODUCT = { name: '', category: 'Rice', unit: 'USD/MT', hs_code: '', low_stock_mt: '', active: true };

function mt(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} MT`;
}

export default function Inventory() {
  const { canEdit } = useAuth();
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('All');
  const [showInactive, setShowInactive] = useState(false);
  const [movementFor, setMovementFor] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [productForm, setProductForm] = useState(null); // { id?, ...fields }
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await supabase.from('product_stock').select('*').order('category').order('name');
    if (loadError) setError(loadError.message);
    setStock(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => stock.filter((p) => (showInactive || p.active) && (category === 'All' || p.category === category)),
    [stock, category, showInactive],
  );
  const totals = useMemo(() => visible.reduce((t, p) => ({
    onHand: t.onHand + Number(p.on_hand_mt || 0),
    reserved: t.reserved + Number(p.reserved_mt || 0),
    low: t.low + (p.is_low ? 1 : 0),
  }), { onHand: 0, reserved: 0, low: 0 }), [visible]);
  const categories = ['All', ...new Set(stock.map((p) => p.category).filter(Boolean))];

  function done(message) {
    setMovementFor(null);
    setProductForm(null);
    setNotice(message);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Inventory</h1>
          <p>Stock per product. Shipping an order deducts its quantities automatically; open orders count as reserved.</p>
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setProductForm({ ...EMPTY_PRODUCT })}>
            <Plus size={15} /> Add product
          </button>
        )}
      </div>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="order-health-grid" style={{ marginBottom: 16 }}>
        <SummaryTile label="On hand" value={mt(totals.onHand)} />
        <SummaryTile label="Reserved for open orders" value={mt(totals.reserved)} />
        <SummaryTile label="Available" value={mt(totals.onHand - totals.reserved)} />
        <SummaryTile label="Running low" value={totals.low} warn={totals.low > 0} />
      </div>

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="tabs" style={{ margin: 0 }}>
            {categories.map((c) => (
              <button type="button" key={c} className={'tab' + (category === c ? ' active' : '')} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
        </div>
        {loading ? (
          <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state"><Boxes /><h4>No products</h4><p>Add products to start tracking stock.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Low below</th><th /></tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.product_id} style={p.active ? undefined : { opacity: 0.55 }}>
                    <td className="cell-strong">
                      {p.name}
                      <div className="card-header-sub">{p.category}{p.active ? '' : ' · inactive'}</div>
                    </td>
                    <td>{mt(p.on_hand_mt)}</td>
                    <td>{mt(p.reserved_mt)}</td>
                    <td>
                      <strong className={p.is_low ? 'danger-text' : undefined}>
                        {p.is_low && <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}
                        {mt(p.available_mt)}
                      </strong>
                    </td>
                    <td>{p.low_stock_mt == null ? '—' : mt(p.low_stock_mt)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {canEdit && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMovementFor(p)}>
                          <PlusCircle size={14} /> Record
                        </button>
                      )}
                      <button type="button" className="icon-btn" title="History" onClick={() => setHistoryFor(p)}><History size={15} /></button>
                      {canEdit && (
                        <button type="button" className="icon-btn" title="Edit product" onClick={() => setProductForm({
                          id: p.product_id, name: p.name, category: p.category || 'Other', unit: p.unit || 'USD/MT',
                          hs_code: '', low_stock_mt: p.low_stock_mt ?? '', active: p.active, loadHs: true,
                        })}><Edit2 size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {movementFor && <MovementModal product={movementFor} onClose={() => setMovementFor(null)} onSaved={done} />}
      {historyFor && <HistoryModal product={historyFor} onClose={() => setHistoryFor(null)} />}
      {productForm && <ProductModal initial={productForm} onClose={() => setProductForm(null)} onSaved={done} />}
    </div>
  );
}

function SummaryTile({ label, value, warn }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="card-header-sub">{label}</div>
      <strong style={{ fontSize: 22, color: warn ? 'var(--color-danger)' : undefined }}>{value}</strong>
    </div>
  );
}

function MovementModal({ product, onClose, onSaved }) {
  const [kind, setKind] = useState('production');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(localDateString());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!(qty > 0)) return setError('Enter a quantity above zero.');
    const option = KINDS.find((k) => k.value === kind);
    setSaving(true);
    const { error: saveError } = await supabase.from('inventory_movements').insert([{
      product_id: product.product_id,
      kind: kind.startsWith('adjustment') ? 'adjustment' : kind,
      quantity_mt: option.sign * qty,
      movement_date: date,
      note: note.trim() || null,
    }]);
    setSaving(false);
    if (saveError) return setError(saveError.message);
    onSaved(`${product.name}: ${option.sign > 0 ? '+' : '−'}${qty} MT recorded.`);
  }

  return (
    <Modal open onClose={onClose} title={`Record stock · ${product.name}`}>
      <form className="form-grid" onSubmit={save}>
        <label className="field-label">What happened
          <select className="select-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="field-label">Quantity (MT)
          <input className="text-input" type="number" min="0" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required autoFocus />
        </label>
        <label className="field-label">Date
          <input className="text-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field-label">Note
          <input className="text-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Lot 14, Port Qasim unit 2" />
        </label>
        <p className="card-header-sub full-span">Shipments are deducted automatically when an order is marked Shipped.</p>
        {error && <div className="alert alert-danger full-span">{error}</div>}
        <div className="modal-actions full-span">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({ product, onClose }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    supabase
      .from('inventory_movements')
      .select('id, kind, quantity_mt, movement_date, order_id, note')
      .eq('product_id', product.product_id)
      .order('movement_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setRows(data || []));
  }, [product.product_id]);

  return (
    <Modal open onClose={onClose} title={`Stock history · ${product.name}`}>
      {rows === null ? (
        <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>
      ) : rows.length === 0 ? (
        <p className="buyer-profile-notes">No stock recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>What</th><th>MT</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.movement_date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td>{KIND_LABELS[r.kind] || r.kind}</td>
                  <td className={Number(r.quantity_mt) < 0 ? 'danger-text' : undefined}>{Number(r.quantity_mt) > 0 ? '+' : ''}{Number(r.quantity_mt)}</td>
                  <td>{r.order_id ? <Link to={`/orders/${r.order_id}`}>{r.order_id}</Link> : null} {r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function ProductModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // The stock view doesn't carry the HS code; load it when editing.
  useEffect(() => {
    if (!initial.loadHs) return;
    supabase.from('products').select('hs_code').eq('id', initial.id).maybeSingle()
      .then(({ data }) => setForm((f) => ({ ...f, hs_code: data?.hs_code || '' })));
  }, [initial.id, initial.loadHs]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      category: form.category,
      unit: form.unit.trim() || 'USD/MT',
      hs_code: form.hs_code.trim() || null,
      low_stock_mt: form.low_stock_mt === '' ? null : Number(form.low_stock_mt),
      active: form.active,
    };
    let saveError;
    if (form.id) {
      ({ error: saveError } = await supabase.from('products').update(payload).eq('id', form.id));
    } else {
      const { data: ids } = await supabase.from('products').select('id');
      const next = Math.max(0, ...(ids || []).map((r) => Number(/^P-(\d+)$/.exec(r.id)?.[1] || 0))) + 1;
      ({ error: saveError } = await supabase.from('products').insert([{ id: `P-${String(next).padStart(3, '0')}`, stock_mt: 0, ...payload }]));
    }
    setSaving(false);
    if (saveError) return setError(saveError.message);
    onSaved(`${payload.name} saved.`);
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open onClose={onClose} title={form.id ? 'Edit product' : 'Add product'}>
      <form className="form-grid" onSubmit={save}>
        <label className="field-label full-span">Name
          <input className="text-input" value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        </label>
        <label className="field-label">Category
          <select className="select-input" value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field-label">Price unit
          <input className="text-input" value={form.unit} onChange={(e) => set('unit', e.target.value)} />
        </label>
        <label className="field-label">HS code
          <input className="text-input" value={form.hs_code} onChange={(e) => set('hs_code', e.target.value)} />
        </label>
        <label className="field-label">Warn when available is below (MT)
          <input className="text-input" type="number" min="0" step="0.1" value={form.low_stock_mt} onChange={(e) => set('low_stock_mt', e.target.value)} placeholder="No warning" />
        </label>
        <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active (shown to buyers on the website form)
        </label>
        {error && <div className="alert alert-danger full-span">{error}</div>}
        <div className="modal-actions full-span">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
