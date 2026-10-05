import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import Modal from '../Modal';
import { supabase } from '../../lib/supabaseClient';
import { ORDER_STAGES, normalizeStatus } from '../../lib/orderWorkflow';

// Pick a stage (or confirm the current one), add an optional note, save.
// Opening with `initialStatus` preselects a stage so "Move to …" is one more tap.
// Render with a `key` per order/stage so the choice resets each time it opens.
export default function OrderStatusSheet({ order, initialStatus, onClose, onSaved }) {
  const current = normalizeStatus(order?.status);
  const [status, setStatus] = useState(initialStatus || current);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!order) return null;

  const unchanged = status === current;
  const notifiesBuyer = !unchanged && Boolean(order.clients?.whatsapp_number);

  async function save() {
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('set_order_status', {
      p_order_id: order.id,
      p_status: status,
      p_note: note,
    });
    setSaving(false);
    if (rpcError) return setError(rpcError.message);
    onSaved?.(unchanged ? `${order.id}: marked as checked, still ${current}.` : `${order.id} moved to ${status}.`);
  }

  return (
    <Modal open onClose={onClose} title={`${order.id} · ${order.clients?.company || 'Order'}`}>
      <div className="today-sheet">
        <p className="today-sheet-lead">Where is this order now?</p>
        <div className="today-stage-list" role="radiogroup" aria-label="Order stage">
          {ORDER_STAGES.map((stage) => {
            const selected = stage.label === status;
            return (
              <button
                key={stage.label}
                type="button"
                role="radio"
                aria-checked={selected}
                className={'today-stage-option' + (selected ? ' selected' : '')}
                onClick={() => setStatus(stage.label)}
              >
                <span className="today-stage-check">{selected && <Check size={18} />}</span>
                <span>
                  <strong>{stage.label}</strong>
                  <small>{stage.label === current ? 'Current stage' : stage.helper}</small>
                </span>
              </button>
            );
          })}
        </div>

        <label className="today-note-label">
          Note (optional)
          <textarea
            className="text-input"
            rows={2}
            maxLength={2000}
            placeholder="e.g. Balance received in bank today"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {notifiesBuyer && <p className="today-sheet-hint">The buyer will get a WhatsApp update about this change.</p>}
        {status === 'Shipped' && current !== 'Shipped' && order.clients?.email && (
          <p className="today-sheet-hint">
            In 2 hours the buyer gets a shipment email with the vessel, B/L and arrival date from the shipment record. Add those details before then if they're missing.
          </p>
        )}
        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        <div className="today-sheet-actions">
          <button type="button" className="today-btn today-btn-primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="spin" size={20} /> : <Check size={20} />}
            {unchanged ? `Confirm: still ${current}` : `Save: ${status}`}
          </button>
          <button type="button" className="today-btn today-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
