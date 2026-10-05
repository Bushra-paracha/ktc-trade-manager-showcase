import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import Modal from '../Modal';
import { supabase } from '../../lib/supabaseClient';

// New inquiry for an existing buyer (client profile, or an outreach reply when
// sourceRef = 'email_replies:<id>'). Creates the inquiry, a 4-hour reply task and an alert.
export default function InquiryFromClientModal({ client, sourceRef = null, initialNote = '', onClose, onSaved }) {
  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('create_client_inquiry', {
      p_client_id: client.id,
      p_product: product.trim() || null,
      p_quantity: quantity.trim() || null,
      p_note: note.trim() || null,
      p_source_ref: sourceRef,
    });
    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    onSaved?.(data);
  }

  return (
    <Modal open onClose={onClose} title={`New inquiry · ${client.company}`}>
      <form className="form-grid" onSubmit={save}>
        <label className="field-label">Product
          <input className="text-input" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. IRRI-6 5% Broken" autoFocus />
        </label>
        <label className="field-label">Quantity
          <input className="text-input" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 2 x 20ft monthly" />
        </label>
        <label className="field-label full-span">What they asked for
          <textarea className="text-input" rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="card-header-sub full-span">It goes on Today as a new inquiry with a reply due in 4 hours.</p>
        {error && <div className="alert alert-danger full-span">{error}</div>}
        <div className="modal-actions full-span">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Create inquiry
          </button>
        </div>
      </form>
    </Modal>
  );
}
