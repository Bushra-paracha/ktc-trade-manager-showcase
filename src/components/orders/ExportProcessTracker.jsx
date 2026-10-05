import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Edit2, Loader2, Plus, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import { supabase } from '../../lib/supabaseClient';

const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Complete', 'Not Applicable'];
const EMPTY_STEP = {
  title: '',
  description: '',
  status: 'Not Started',
  owner_name: '',
  due_date: '',
  estimated_cost: '',
  actual_cost: '',
  currency: 'USD',
  evidence: '',
  notes: '',
};

export default function ExportProcessTracker({ orderId, onMessage, onActivityChange }) {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStep, setEditingStep] = useState(null);
  const [form, setForm] = useState(EMPTY_STEP);

  const fetchSteps = useCallback(async () => {
    setLoading(true);
    let result = await supabase
      .from('order_process_steps')
      .select('*')
      .eq('order_id', orderId)
      .order('step_number');

    if (!result.error && result.data?.length === 0) {
      const seed = await supabase.rpc('seed_order_process_steps', { p_order_id: orderId });
      if (!seed.error) {
        result = await supabase
          .from('order_process_steps')
          .select('*')
          .eq('order_id', orderId)
          .order('step_number');
      }
    }

    if (result.error) onMessage?.(result.error.message);
    setSteps(result.data || []);
    setLoading(false);
  }, [onMessage, orderId]);

  useEffect(() => { fetchSteps(); }, [fetchSteps]);

  const summary = useMemo(() => {
    const applicable = steps.filter((step) => step.status !== 'Not Applicable');
    const complete = applicable.filter((step) => step.status === 'Complete').length;
    const estimated = steps.reduce((sum, step) => sum + Number(step.estimated_cost || 0), 0);
    const actual = steps.reduce((sum, step) => sum + Number(step.actual_cost || 0), 0);
    return {
      complete,
      total: applicable.length,
      percent: applicable.length ? Math.round((complete / applicable.length) * 100) : 0,
      estimated,
      actual,
    };
  }, [steps]);

  function openEdit(step) {
    setEditingStep(step);
    setForm({
      title: step.title || '',
      description: step.description || '',
      status: step.status || 'Not Started',
      owner_name: step.owner_name || '',
      due_date: step.due_date?.slice(0, 10) || '',
      estimated_cost: step.estimated_cost ?? '',
      actual_cost: step.actual_cost ?? '',
      currency: step.currency || 'USD',
      evidence: step.evidence || '',
      notes: step.notes || '',
    });
    setModalOpen(true);
  }

  function openNew() {
    setEditingStep(null);
    setForm(EMPTY_STEP);
    setModalOpen(true);
  }

  async function saveStep(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = {
      ...form,
      title: form.title.trim(),
      due_date: form.due_date || null,
      estimated_cost: form.estimated_cost === '' ? null : Number(form.estimated_cost),
      actual_cost: form.actual_cost === '' ? null : Number(form.actual_cost),
    };
    const result = editingStep
      ? await supabase.from('order_process_steps').update(payload).eq('id', editingStep.id)
      : await supabase.from('order_process_steps').insert({
        ...payload,
        order_id: orderId,
        step_number: Math.max(0, ...steps.map((step) => Number(step.step_number))) + 1,
        stage_key: `custom_${Date.now()}`,
      });
    setSaving(false);
    if (result.error) return onMessage?.(result.error.message);
    setModalOpen(false);
    onMessage?.(editingStep ? 'Process step updated.' : 'Process step added.');
    await fetchSteps();
    onActivityChange?.();
  }

  async function quickStatus(step, status) {
    const { error } = await supabase.from('order_process_steps').update({ status }).eq('id', step.id);
    if (error) return onMessage?.(error.message);
    setSteps((current) => current.map((item) => item.id === step.id ? { ...item, status } : item));
    onActivityChange?.();
  }

  async function deleteStep(step) {
    if (!window.confirm(`Remove “${step.title}” from this order?`)) return;
    const { error } = await supabase.from('order_process_steps').delete().eq('id', step.id);
    if (error) return onMessage?.(error.message);
    setSteps((current) => current.filter((item) => item.id !== step.id));
    onMessage?.('Process step removed.');
  }

  if (loading) return <div className="card loading-card"><Loader2 className="spin" size={24} /><p>Loading the export process…</p></div>;

  return (
    <>
      <div className="process-summary-grid">
        <div><span>Process progress</span><strong>{summary.percent}%</strong><small>{summary.complete} of {summary.total} applicable steps complete</small></div>
        <div><span>Estimated stage costs</span><strong>{formatMoney(summary.estimated, steps[0]?.currency)}</strong><small>Editable by stage</small></div>
        <div><span>Actual stage costs</span><strong>{formatMoney(summary.actual, steps[0]?.currency)}</strong><small>Use for shipment closure</small></div>
      </div>
      <div className="process-progress"><span style={{ width: `${summary.percent}%` }} /></div>
      <div className="card-header process-header">
        <div><h3>A-to-Z export process</h3><p>Edit any step at any time. Record owner, deadline, cost, evidence and notes before completion.</p></div>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={15} /> Add step</button>
      </div>
      <div className="process-step-list">
        {steps.map((step) => {
          const overdue = step.due_date && step.status !== 'Complete' && step.status !== 'Not Applicable' && new Date(`${step.due_date}T23:59:59`) < new Date();
          return <article className={`process-step-card status-${slug(step.status)}`} key={step.id}>
            <div className="process-step-number">{step.status === 'Complete' ? <CheckCircle2 size={20} /> : step.status === 'Blocked' ? <AlertTriangle size={20} /> : <Circle size={20} />}<span>{step.step_number}</span></div>
            <div className="process-step-body">
              <div className="process-step-title"><div><h4>{step.title}</h4><p>{step.description}</p></div><div className="process-step-actions"><button className="icon-btn" title="Edit step" onClick={() => openEdit(step)}><Edit2 size={15} /></button><button className="icon-btn danger-text" title="Remove step" onClick={() => deleteStep(step)}><Trash2 size={15} /></button></div></div>
              <div className="process-step-meta">
                <span>Owner: <strong>{step.owner_name || 'Unassigned'}</strong></span>
                <span className={overdue ? 'danger-text' : ''}>Due: <strong>{step.due_date ? new Date(`${step.due_date}T00:00:00`).toLocaleDateString() : 'Not set'}</strong></span>
                <span>Estimate: <strong>{formatMoney(step.estimated_cost, step.currency)}</strong></span>
                <span>Actual: <strong>{formatMoney(step.actual_cost, step.currency)}</strong></span>
              </div>
              {(step.evidence || step.notes) && <div className="process-step-notes">{step.evidence && <p><strong>Evidence:</strong> {step.evidence}</p>}{step.notes && <p><strong>Notes:</strong> {step.notes}</p>}</div>}
              <label className="process-status-control">Status
                <select className="select-input" value={step.status} onChange={(e) => quickStatus(step, e.target.value)}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
              </label>
            </div>
          </article>;
        })}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingStep ? `Edit step ${editingStep.step_number}` : 'Add export process step'}>
        <form onSubmit={saveStep}>
          <div className="form-grid">
            <label className="field-label full-span">Step title<input required className="text-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="field-label full-span">What must be done<textarea className="text-input" rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label className="field-label">Status<select className="select-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label className="field-label">Owner<input className="text-input" placeholder="Person or team" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /></label>
            <label className="field-label">Due date<input className="text-input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
            <label className="field-label">Currency<select className="select-input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{['USD', 'PKR', 'AED', 'EUR', 'GBP'].map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label className="field-label">Estimated cost<input className="text-input" type="number" min="0" step="0.01" value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })} /></label>
            <label className="field-label">Actual cost<input className="text-input" type="number" min="0" step="0.01" value={form.actual_cost} onChange={(e) => setForm({ ...form, actual_cost: e.target.value })} /></label>
            <label className="field-label full-span">Completion evidence<input className="text-input" placeholder="Document, reference, approval, photo or confirmation" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} /></label>
            <label className="field-label full-span">Notes<textarea className="text-input" rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save step'}</button></div>
        </form>
      </Modal>
    </>
  );
}

function slug(value = '') { return value.toLowerCase().replaceAll(' ', '-'); }
function formatMoney(value, currency = 'USD') {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
}
