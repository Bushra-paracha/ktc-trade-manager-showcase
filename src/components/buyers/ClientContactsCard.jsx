import { useCallback, useEffect, useState } from 'react';
import { Edit2, Loader2, MessageCircle, Plus, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import { supabase } from '../../lib/supabaseClient';

const EMPTY = { name: '', title: '', email: '', phone: '', whatsapp: '', notes: '' };

// Everyone we deal with at a buyer beyond the main contact on the buyer record
// (e.g. several cooperative officers behind one broker address).
export default function ClientContactsCard({ client, canEdit }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | contact
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('client_contacts')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at');
    if (loadError) setError(loadError.message);
    setContacts(data || []);
    setLoading(false);
  }, [client.id]);

  useEffect(() => {
    load();
  }, [load]);

  function open(contact) {
    setEditing(contact || 'new');
    setForm(contact ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, contact[k] || ''])) } : EMPTY);
    setError(null);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
    const { error: saveError } = editing === 'new'
      ? await supabase.from('client_contacts').insert([{ ...payload, client_id: client.id }])
      : await supabase.from('client_contacts').update(payload).eq('id', editing.id);
    setSaving(false);
    if (saveError) return setError(saveError.message);
    setEditing(null);
    load();
  }

  async function remove(contact) {
    if (!window.confirm(`Remove ${contact.name} from ${client.company}'s contacts?`)) return;
    const { error: deleteError } = await supabase.from('client_contacts').delete().eq('id', contact.id);
    if (deleteError) setError(deleteError.message);
    load();
  }

  const field = (name, label, props = {}) => (
    <label className="field-label">
      {label}
      <input className="text-input" value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} {...props} />
    </label>
  );

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Other contacts</h3>
          <div className="card-header-sub">People at {client.company} besides the main contact above.</div>
        </div>
        {canEdit && <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(null)}><Plus size={14} /> Add contact</button>}
      </div>
      {error && !editing && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="loading-inline"><Loader2 className="spin" size={18} /> Loading…</div>
      ) : contacts.length === 0 ? (
        <p className="buyer-profile-notes">No other contacts saved.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone / WhatsApp</th><th /></tr></thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="cell-strong">{c.name}{c.notes && <div className="card-header-sub">{c.notes}</div>}</td>
                  <td>{c.title || '—'}</td>
                  <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                  <td>
                    {c.phone || '—'}
                    {(c.whatsapp || c.phone) && (
                      <a href={`https://wa.me/${String(c.whatsapp || c.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" title="WhatsApp" style={{ marginLeft: 8 }}>
                        <MessageCircle size={14} />
                      </a>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <>
                        <button type="button" className="icon-btn" title="Edit" onClick={() => open(c)}><Edit2 size={14} /></button>
                        <button type="button" className="icon-btn danger" title="Remove" onClick={() => remove(c)}><Trash2 size={14} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add contact' : 'Edit contact'}>
        <form className="form-grid" onSubmit={save}>
          {field('name', 'Name', { required: true, autoFocus: true })}
          {field('title', 'Title / role')}
          {field('email', 'Email', { type: 'email' })}
          {field('phone', 'Phone')}
          {field('whatsapp', 'WhatsApp (if different)')}
          {field('notes', 'Notes')}
          {error && <div className="alert alert-danger full-span">{error}</div>}
          <div className="modal-actions full-span">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
