import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import Modal from '../Modal';
import { supabase } from '../../lib/supabaseClient';

// "It's an inquiry": turns a held email / WhatsApp into buyer + inquiry + reply task.
// The buyer is matched by company name, so typing an existing company links to it.
export default function MessageReviewSheet({ message, onClose, onSaved }) {
  const [form, setForm] = useState({
    company: '',
    contact: message?.fromName || '',
    country: '',
    product: '',
    quantity: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!message) return null;

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('capture_message_as_inquiry', {
      p_source: message.source,
      p_message_id: message.id,
      p_company: form.company,
      p_contact: form.contact,
      p_country: form.country,
      p_product: form.product,
      p_quantity: form.quantity,
    });
    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    onSaved?.(`${form.company}: inquiry ${data?.inquiry_id || ''} created${data?.created_client ? ' with a new buyer record' : ''}. Reply due in 4 hours.`);
  }

  const field = (name, label, props = {}) => (
    <label className="today-note-label">
      {label}
      <input className="text-input" value={form[name]} onChange={(e) => update(name, e.target.value)} {...props} />
    </label>
  );

  return (
    <Modal open onClose={onClose} title="Save as inquiry">
      <form className="today-sheet" onSubmit={save}>
        <p className="today-sheet-lead">Who is this buyer?</p>
        {field('company', 'Company name', { required: true, autoFocus: true, placeholder: 'e.g. Al Noor Foodstuff Trading' })}
        {field('contact', 'Contact person')}
        {field('country', 'Country', { placeholder: 'e.g. UAE' })}
        {field('product', 'Product', { placeholder: 'e.g. IRRI-6 5% Broken' })}
        {field('quantity', 'Quantity', { placeholder: 'e.g. 2 x 20ft monthly' })}

        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        <div className="today-sheet-actions">
          <button type="submit" className="today-btn today-btn-primary" disabled={saving || !form.company.trim()}>
            {saving ? <Loader2 className="spin" size={20} /> : <Check size={20} />}
            Save inquiry
          </button>
          <button type="button" className="today-btn today-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
