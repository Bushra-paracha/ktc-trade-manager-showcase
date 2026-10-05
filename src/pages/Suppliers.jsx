import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit2, Factory, Loader2, Plus, Search } from 'lucide-react';
import Modal from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

const SUPPLIER_TYPES = [
  'Rice Mill', 'Paddy Supplier', 'Salt Supplier', 'Seeds / Grain Supplier', 'Packaging',
  'Freight Forwarder/Broker', 'Shipping Line', 'Customs Agent', 'Inspection Agency', 'Transport', 'Other',
];
const EMPTY = {
  company: '', supplier_type: 'Rice Mill', contact_person: '', phone: '', email: '',
  country: 'Pakistan', city: '', website: '', notes: '', is_active: true,
};

export default function Suppliers() {
  const { canEdit } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [orderCounts, setOrderCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('All');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const [supRes, linkRes] = await Promise.all([
      supabase.from('suppliers').select('*').order('company'),
      supabase.from('order_suppliers').select('supplier_id'),
    ]);
    if (supRes.error || linkRes.error) setError((supRes.error || linkRes.error).message);
    const counts = {};
    for (const row of linkRes.data || []) counts[row.supplier_id] = (counts[row.supplier_id] || 0) + 1;
    setSuppliers(supRes.data || []);
    setOrderCounts(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => (type === 'All' || s.supplier_type === type)
      && (!q || [s.company, s.contact_person, s.city, s.email].some((v) => String(v || '').toLowerCase().includes(q))));
  }, [suppliers, search, type]);

  const types = ['All', ...new Set(suppliers.map((s) => s.supplier_type).filter(Boolean))];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Suppliers</h1>
          <p>Mills, packaging, freight, customs and inspection partners. Link them to orders from the order page.</p>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}><Plus size={15} /> Add supplier</button>}
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="search-input" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 220px' }}>
            <Search size={15} />
            <input className="text-input" placeholder="Search suppliers" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select-input" value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        {loading ? (
          <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state"><Factory /><h4>No suppliers</h4><p>Add the mills and partners you work with.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Supplier</th><th>Type</th><th>Contact</th><th>Location</th><th>Orders</th><th /></tr></thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id} style={s.is_active ? undefined : { opacity: 0.55 }}>
                    <td className="cell-strong">{s.company}{s.notes && <div className="card-header-sub">{s.notes.slice(0, 80)}</div>}</td>
                    <td>{s.supplier_type || '—'}</td>
                    <td>
                      {s.contact_person || '—'}
                      <div className="card-header-sub">
                        {s.phone && <a href={`tel:${s.phone}`}>{s.phone}</a>}{s.phone && s.email ? ' · ' : ''}
                        {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
                      </div>
                    </td>
                    <td>{[s.city, s.country].filter(Boolean).join(', ') || '—'}</td>
                    <td>{orderCounts[s.id] || 0}</td>
                    <td>{canEdit && <button type="button" className="icon-btn" title="Edit" onClick={() => setEditing(s)}><Edit2 size={15} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <SupplierModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function SupplierModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY, ...Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ?? ''])) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      company: form.company.trim(),
      supplier_type: form.supplier_type,
      contact_person: form.contact_person.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim().toLowerCase() || null,
      country: form.country.trim() || null,
      city: form.city.trim() || null,
      website: form.website.trim() || null,
      notes: form.notes.trim() || null,
      is_active: Boolean(form.is_active),
      updated_at: new Date().toISOString(),
    };
    const { error: saveError } = initial.id
      ? await supabase.from('suppliers').update(payload).eq('id', initial.id)
      : await supabase.from('suppliers').insert([payload]);
    setSaving(false);
    if (saveError) return setError(saveError.message);
    onSaved();
  }

  const field = (name, label, props = {}) => (
    <label className="field-label">{label}
      <input className="text-input" value={form[name]} onChange={(e) => set(name, e.target.value)} {...props} />
    </label>
  );

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit supplier' : 'Add supplier'}>
      <form className="form-grid" onSubmit={save}>
        {field('company', 'Company', { required: true, autoFocus: true })}
        <label className="field-label">Type
          <select className="select-input" value={form.supplier_type} onChange={(e) => set('supplier_type', e.target.value)}>
            {SUPPLIER_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        {field('contact_person', 'Contact person')}
        {field('phone', 'Phone')}
        {field('email', 'Email', { type: 'email' })}
        {field('city', 'City')}
        {field('country', 'Country')}
        {field('website', 'Website')}
        <label className="field-label full-span">Notes
          <textarea className="text-input" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
        <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => set('is_active', e.target.checked)} /> Active
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
