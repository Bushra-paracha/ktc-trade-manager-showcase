import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

const ROLES = ['Rice supply', 'Milling', 'Packaging', 'Freight forwarding', 'Shipping line', 'Customs clearing', 'Inspection', 'Transport', 'Other'];
const EMPTY = { supplier_id: '', role: 'Rice supply', product: '', quantity_mt: '', notes: '' };

// Who supplied what for this order.
export default function OrderSuppliersCard({ orderId, canEdit }) {
  const [links, setLinks] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [linkRes, supRes] = await Promise.all([
      supabase.from('order_suppliers').select('id, role, product, quantity_mt, notes, suppliers(id, company, supplier_type, phone)')
        .eq('order_id', orderId).order('created_at'),
      supabase.from('suppliers').select('id, company, supplier_type').eq('is_active', true).order('company'),
    ]);
    if (linkRes.error || supRes.error) setError((linkRes.error || supRes.error).message);
    setLinks(linkRes.data || []);
    setSuppliers(supRes.data || []);
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    if (!form.supplier_id) return setError('Choose a supplier.');
    const { error: saveError } = await supabase.from('order_suppliers').insert([{
      order_id: orderId,
      supplier_id: form.supplier_id,
      role: form.role,
      product: form.product.trim() || null,
      quantity_mt: form.quantity_mt === '' ? null : Number(form.quantity_mt),
      notes: form.notes.trim() || null,
    }]);
    if (saveError) return setError(saveError.message);
    setForm(EMPTY);
    setAdding(false);
    setError(null);
    load();
  }

  async function remove(link) {
    if (!window.confirm(`Remove ${link.suppliers?.company || 'this supplier'} from the order?`)) return;
    const { error: deleteError } = await supabase.from('order_suppliers').delete().eq('id', link.id);
    if (deleteError) setError(deleteError.message);
    load();
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Suppliers</h3>
          <div className="card-header-sub">Mills, packaging, freight and agents on this order. <Link to="/suppliers">All suppliers</Link></div>
        </div>
        {canEdit && !adding && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Add</button>}
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {adding && (
        <form className="form-grid" onSubmit={add} style={{ marginBottom: 12 }}>
          <label className="field-label">Supplier
            <select className="select-input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} required>
              <option value="">Choose…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company}{s.supplier_type ? ` (${s.supplier_type})` : ''}</option>)}
            </select>
          </label>
          <label className="field-label">Role
            <select className="select-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="field-label">Product / service
            <input className="text-input" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} />
          </label>
          <label className="field-label">Quantity (MT)
            <input className="text-input" type="number" min="0" step="0.001" value={form.quantity_mt} onChange={(e) => setForm({ ...form, quantity_mt: e.target.value })} />
          </label>
          <label className="field-label full-span">Notes
            <input className="text-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="modal-actions full-span">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setError(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">Add to order</button>
          </div>
        </form>
      )}
      {loading ? (
        <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>
      ) : links.length === 0 ? (
        !adding && <p className="buyer-profile-notes">No suppliers linked yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Supplier</th><th>Role</th><th>Product / service</th><th>MT</th><th /></tr></thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td className="cell-strong">{l.suppliers?.company || '—'}{l.notes && <div className="card-header-sub">{l.notes}</div>}</td>
                  <td>{l.role || '—'}</td>
                  <td>{l.product || '—'}</td>
                  <td>{l.quantity_mt ?? '—'}</td>
                  <td>{canEdit && <button type="button" className="icon-btn danger" title="Remove" onClick={() => remove(l)}><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
