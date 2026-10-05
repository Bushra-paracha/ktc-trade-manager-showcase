import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BellRing, CalendarDays, Copy, Edit2, FileText, Loader2, PackageCheck, Plus, Ship, Trash2 } from 'lucide-react';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import DocumentChecklistCard from '../components/orders/DocumentChecklistCard';
import ExportProcessTracker from '../components/orders/ExportProcessTracker';
import OrderActionPanel from '../components/orders/OrderActionPanel';
import ShipmentSummaryCard from '../components/orders/ShipmentSummaryCard';
import StageTracker from '../components/orders/StageTracker';
import { formatUSD } from '../data/mockData';
import { useAuth } from '../hooks/useAuth';
import { useClients } from '../hooks/useClients';
import { useDocumentUpload } from '../hooks/useDocumentUpload';
import { useDocumentActions, useOrder, useOrderItemActions, useOrders, useShipmentActions } from '../hooks/useOrders';
import { generateProformaInvoice } from '../lib/generateProformaInvoice';
import { supabase } from '../lib/supabaseClient';
import { ORDER_STATUS_OPTIONS, getDocsProgress, getStageProgress, normalizeStatus } from '../lib/orderWorkflow';
import { formatDate } from '../lib/dates';
import OrderSuppliersCard from '../components/orders/OrderSuppliersCard';

const TABS = ['overview', 'process', 'production', 'shipment', 'documents', 'payments', 'activity'];
const SHIPMENT_STATUSES = ['Booked', 'Stuffed', 'Departed', 'In Transit', 'Arrived', 'Customs Cleared', 'Delivered'];
const EMPTY_SHIPMENT = { container_number: '', seal_number: '', shipping_line: '', vessel_voyage: '', pol: '', pod: '', etd: '', eta: '', bl_number: '', status: 'Booked' };
const EMPTY_PAYMENT = { payment_type: 'Advance', amount: '', currency: 'USD', status: 'Due', bank_reference: '', payment_date: '', notes: '' };

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = TABS.includes(requestedTab) ? requestedTab : 'overview';
  const { order, loading, error, refetch } = useOrder(id);
  const { clients } = useClients();
  const { deleteOrder, updateOrder, updateOrderProgress } = useOrders();
  const { syncOrderItems } = useOrderItemActions();
  const { createShipment, updateShipment } = useShipmentActions();
  const { updateDocumentStatus } = useDocumentActions();
  const { uploadDocument, getSignedUrl, removeDocument } = useDocumentUpload();
  const { user, isAdmin, isAdminOrDirector, canEdit } = useAuth();
  const [payments, setPayments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [automation, setAutomation] = useState({ sla: null, reminder: null, notifications: [] });
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [relatedError, setRelatedError] = useState('');
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [shipmentForm, setShipmentForm] = useState(EMPTY_SHIPMENT);
  const [orderForm, setOrderForm] = useState({});
  const [orderItems, setOrderItems] = useState([]);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT);
  const [productionProgress, setProductionProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploadingDocId, setUploadingDocId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);
  const pendingDocIdRef = useRef(null);

  useEffect(() => { setProductionProgress(Number(order?.production_progress) || 0); }, [order?.production_progress]);

  const fetchRelated = useCallback(async () => {
    setRelatedLoading(true);
    setRelatedError('');
    const [paymentResult, activityResult, slaResult, reminderResult, notificationResult] = await Promise.all([
      supabase.from('order_payments').select('*').eq('order_id', id).order('created_at', { ascending: false }),
      supabase.from('order_activity').select('*').eq('order_id', id).order('created_at', { ascending: false }),
      supabase.from('order_sla').select('*').eq('order_id', id).eq('milestone', 'shipment_deadline').maybeSingle(),
      supabase.from('repeat_order_reminders').select('*').eq('order_id', id).maybeSingle(),
      supabase.from('notification_outbox').select('id,event_type,status,scheduled_for,sent_at,last_error').eq('order_id', id).order('created_at', { ascending: false }).limit(10),
    ]);
    setPayments(paymentResult.data || []);
    setActivity(activityResult.data || []);
    setAutomation({ sla: slaResult.data, reminder: reminderResult.data, notifications: notificationResult.data || [] });
    setRelatedError(paymentResult.error?.message || activityResult.error?.message || slaResult.error?.message || reminderResult.error?.message || notificationResult.error?.message || '');
    setRelatedLoading(false);
  }, [id]);

  useEffect(() => { fetchRelated(); }, [fetchRelated]);

  if (loading) return <div className="card loading-card"><Loader2 className="spin" size={28} /><p>Loading order...</p></div>;
  if (error || !order) return <div className="empty-state"><h4>Order not found</h4><p><Link to="/orders">Back to Orders</Link></p></div>;

  const shipment = (order.shipments || [])[0];
  const docs = order.order_documents || [];
  const docsProgress = getDocsProgress(docs);
  const stageProgress = getStageProgress(order.status);
  const received = payments.filter((p) => ['Received', 'Reconciled'].includes(p.status)).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const due = Math.max(Number(order.total_value || 0) - received, 0);
  const slaHelper = automation.sla
    ? `${automation.sla.status} · ${new Date(automation.sla.due_at).toLocaleString()}`
    : 'Set a shipment deadline to start';

  async function updateStatus(status) {
    setMessage('');
    const { error: updateError } = await supabase.rpc('set_order_status', { p_order_id: order.id, p_status: status });
    if (updateError) return setMessage(updateError.message);
    await Promise.all([refetch(), fetchRelated()]);
    setMessage('Order status updated.');
  }

  async function createTrackingLink() {
    setMessage('');
    const { data, error: tokenError } = await supabase.rpc('rotate_buyer_tracking_token', { p_order_id: order.id });
    if (tokenError) return setMessage(tokenError.message);
    await navigator.clipboard.writeText(`${window.location.origin}/track/${data}`);
    setMessage('Secure buyer link copied. The previous link is now invalid.');
    fetchRelated();
  }

  async function saveProduction() {
    setSaving(true);
    const result = await updateOrderProgress(order.id, productionProgress);
    setSaving(false);
    setMessage(result.error || 'Production progress saved.');
    if (!result.error) refetch();
  }

  async function handlePaymentSubmit(e) {
    e.preventDefault();
    setSaving(true);
    const payload = { ...paymentForm, order_id: order.id, amount: Number(paymentForm.amount), payment_date: paymentForm.payment_date || null };
    const { error: insertError } = editingPaymentId
      ? await supabase.from('order_payments').update(payload).eq('id', editingPaymentId)
      : await supabase.from('order_payments').insert(payload);
    setSaving(false);
    if (insertError) return setMessage(insertError.message);
    setPaymentModalOpen(false);
    setEditingPaymentId(null);
    setPaymentForm(EMPTY_PAYMENT);
    setMessage(editingPaymentId ? 'Payment updated.' : 'Payment recorded.');
    fetchRelated();
  }

  function openPaymentForm(payment = null) {
    setEditingPaymentId(payment?.id || null);
    setPaymentForm(payment ? {
      payment_type: payment.payment_type || 'Advance',
      amount: payment.amount ?? '',
      currency: payment.currency || 'USD',
      status: payment.status || 'Due',
      bank_reference: payment.bank_reference || '',
      payment_date: payment.payment_date?.slice(0, 10) || '',
      notes: payment.notes || '',
    } : EMPTY_PAYMENT);
    setPaymentModalOpen(true);
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    const docId = pendingDocIdRef.current;
    if (!file || !docId) return;
    setUploadingDocId(docId);
    const result = await uploadDocument(docId, order.id, file, user?.email);
    setUploadingDocId(null);
    e.target.value = '';
    setMessage(result.error || 'Document uploaded.');
    if (!result.error) refetch();
  }

  async function handleViewDocument(path) {
    const { url, error: signedError } = await getSignedUrl(path);
    if (signedError) return setMessage(`Couldn't open file: ${signedError}`);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleShipmentSubmit(e) {
    e.preventDefault();
    setSaving(true);
    const result = shipment?.id ? await updateShipment(shipment.id, shipmentForm) : await createShipment(order.id, shipmentForm);
    setSaving(false);
    if (result.error) return setMessage(result.error);
    setShipmentModalOpen(false);
    setShipmentForm(EMPTY_SHIPMENT);
    setMessage('Shipment details saved.');
    refetch();
  }

  function openShipmentForm() {
    setShipmentForm(shipment ? {
      ...EMPTY_SHIPMENT,
      ...shipment,
      etd: shipment.etd?.slice(0, 10) || '',
      eta: shipment.eta?.slice(0, 10) || '',
    } : EMPTY_SHIPMENT);
    setShipmentModalOpen(true);
  }

  function openOrderForm() {
    setOrderForm({
      client_id: order.client_id || '',
      status: normalizeStatus(order.status),
      total_value: order.total_value ?? '',
      incoterm: order.incoterm || 'FOB',
      payment_method: order.payment_method || 'LC',
      pol_port: order.pol_port || '',
      pod_port: order.pod_port || '',
      shipment_deadline: order.shipment_deadline?.slice(0, 10) || '',
      production_progress: order.production_progress || 0,
      special_instructions: order.special_instructions || '',
    });
    setOrderItems((order.order_items || []).map((item) => ({ ...item })));
    setOrderModalOpen(true);
  }

  async function handleOrderSubmit(e) {
    e.preventDefault();
    setSaving(true);
    const result = await updateOrder(order.id, {
      ...orderForm,
      total_value: Number(orderForm.total_value || 0),
      production_progress: Number(orderForm.production_progress || 0),
      shipment_deadline: orderForm.shipment_deadline || null,
    });
    if (result.error) {
      setSaving(false);
      return setMessage(result.error);
    }
    const itemResult = await syncOrderItems(order.id, orderItems);
    setSaving(false);
    if (itemResult.error) {
      return setMessage(`Order saved, but products could not be updated: ${itemResult.error}`);
    }
    setOrderModalOpen(false);
    setProductionProgress(Number(orderForm.production_progress || 0));
    setMessage('Order details saved.');
    await Promise.all([refetch(), fetchRelated()]);
  }

  function updateOrderItem(index, field, value) {
    setOrderItems((items) => items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  }

  async function handleDeleteOrder() {
    if (!window.confirm(`Delete ${order.id}? This cannot be undone.`)) return;
    setDeleting(true);
    const result = await deleteOrder(order.id);
    setDeleting(false);
    if (result.error) return setMessage(result.error);
    navigate('/orders');
  }

  const invoiceOrder = { ...order, destination_port: order.pod_port, payment_terms: order.payment_method, inquiry_items: order.order_items };

  return (
    <div className="order-detail-workspace">
      <Link to="/orders" className="btn btn-ghost btn-sm back-link"><ArrowLeft size={16} /> Orders</Link>
      <div className="order-detail-hero card">
        <div><span className="eyebrow">Export Order</span><h1>{order.id}</h1><p>{order.clients?.company || 'Unknown buyer'} · {order.clients?.country || 'Country pending'}</p></div>
        <div className="hero-actions">
          <Badge status={order.status} />
          <select aria-label="Order status" className="select-input" value={normalizeStatus(order.status)} onChange={(e) => updateStatus(e.target.value)}>
            {ORDER_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
          </select>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openOrderForm}><Edit2 size={14} /> Edit order</button>}
          {isAdminOrDirector && <button className="btn btn-secondary btn-sm" onClick={createTrackingLink}><Copy size={14} /> Buyer link</button>}
        </div>
      </div>
      {message && <div className="alert alert-info" role="status">{message}</div>}

      <div className="order-tabs" role="tablist" aria-label="Order sections">
        {TABS.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setSearchParams(tab === 'overview' ? {} : { tab })} key={tab}>{tab}</button>)}
      </div>

      {activeTab === 'overview' && <>
        <div className="order-health-grid">
          <Stat icon={FileText} label="Contract value" value={formatUSD(order.total_value)} helper={`${order.incoterm || 'FOB'} · ${order.payment_method || 'LC'}`} />
          <Stat icon={PackageCheck} label="Workflow" value={`${stageProgress}%`} helper={normalizeStatus(order.status)} />
          <Stat icon={CalendarDays} label="Deadline" value={formatDate(order.shipment_deadline)} helper={order.pod_port || 'POD pending'} />
          <Stat icon={Ship} label="Documents" value={`${docsProgress.complete}/${docsProgress.total || 0}`} helper={`${docsProgress.percent}% complete`} />
          <Stat icon={BellRing} label="SLA timer" value={automation.sla?.status || 'Not active'} helper={slaHelper} />
        </div>
        <div className="card stage-card"><div className="card-header"><div><h3>Order timeline</h3><p>Seven internal milestones from confirmation to closure.</p></div></div><StageTracker status={order.status} /></div>
        <div className="order-detail-grid">
          <div className="card"><div className="card-header"><h3>Commercial details</h3></div><div className="detail-grid">
            <DetailRow label="Buyer" value={order.clients?.company || '—'} /><DetailRow label="Country" value={order.clients?.country || '—'} />
            <DetailRow label="Products" value={(order.order_items || []).map((item) => `${item.product_name} (${item.quantity_mt} MT)`).join(', ') || 'No products'} />
            <DetailRow label="Port of loading" value={order.pol_port || 'Port Qasim'} /><DetailRow label="Port of discharge" value={order.pod_port || '—'} />
            <DetailRow label="Payment method" value={order.payment_method || '—'} />
          </div>{order.special_instructions && <div className="order-note"><strong>Instructions</strong><p>{order.special_instructions}</p></div>}</div>
          <OrderActionPanel order={order} onGeneratePI={() => generateProformaInvoice(invoiceOrder)} onDocuments={() => setSearchParams({ tab: 'documents' })} onShipment={() => setSearchParams({ tab: 'shipment' })} />
        </div>
        <OrderSuppliersCard orderId={order.id} canEdit={canEdit} />
      </>}

      {activeTab === 'production' && <div className="card focused-tab-card"><div className="card-header"><div><h3>Production progress</h3><p>Use the slider for a quick phone-friendly update.</p></div><strong className="progress-number">{productionProgress}%</strong></div>
        <input className="production-slider" type="range" min="0" max="100" step="5" value={productionProgress} onChange={(e) => setProductionProgress(Number(e.target.value))} />
        <div className="progress-track large-progress"><div className="progress-fill" style={{ width: `${productionProgress}%` }} /></div>
        <button className="btn btn-primary mobile-full-button" onClick={saveProduction} disabled={saving}>{saving ? 'Saving…' : 'Save progress'}</button>
      </div>}

      {activeTab === 'process' && <div className="card focused-tab-card">
        <ExportProcessTracker orderId={order.id} onMessage={setMessage} onActivityChange={fetchRelated} />
      </div>}

      {activeTab === 'shipment' && <div className="focused-tab-grid"><ShipmentSummaryCard shipment={shipment} onAddShipment={openShipmentForm} onStatusChange={async (status) => { await updateShipment(shipment.id, { status }); if (status === 'Delivered') await updateStatus('Delivered & Closed'); refetch(); }} statusOptions={SHIPMENT_STATUSES} />
        {shipment && <button className="btn btn-secondary mobile-full-button" onClick={openShipmentForm}>Edit shipment details</button>}</div>}

      {activeTab === 'documents' && <><DocumentChecklistCard docs={docs} onStatusChange={async (docId, status) => { await updateDocumentStatus(docId, status); refetch(); }} onUpload={(docId) => { pendingDocIdRef.current = docId; fileInputRef.current?.click(); }} onView={handleViewDocument} onRemove={async (docId, path) => { if (!window.confirm('Remove this uploaded file?')) return; const result = await removeDocument(docId, path); setMessage(result.error || 'Document removed.'); refetch(); }} uploadingDocId={uploadingDocId} /><input type="file" ref={fileInputRef} hidden onChange={handleFileSelected} /></>}

      {activeTab === 'payments' && <div className="card focused-tab-card">
        <div className="card-header"><div><h3>Payments</h3><p>Track advance, balance, bank reference, and reconciliation.</p></div>{canEdit && <button className="btn btn-primary btn-sm" onClick={() => openPaymentForm()}><Plus size={15} /> Add payment</button>}</div>
        <div className="payment-totals"><div><span>Order value</span><strong>{formatUSD(order.total_value)}</strong></div><div><span>Received</span><strong>{formatUSD(received)}</strong></div><div><span>Balance due</span><strong>{formatUSD(due)}</strong></div></div>
        {relatedLoading ? <div className="loading-inline"><Loader2 className="spin" /> Loading…</div> : relatedError ? <div className="alert alert-danger">{relatedError}</div> : payments.length === 0 ? <div className="empty-state compact-empty"><p>No payment entries yet.</p></div> : <div className="payment-list">{payments.map((payment) => <div className="payment-list-row" key={payment.id}><div><strong>{payment.payment_type} payment</strong><span>{payment.bank_reference || 'No bank reference'} · {payment.payment_date ? new Date(`${payment.payment_date}T00:00:00`).toLocaleDateString() : 'Date pending'}</span></div><div><strong>{formatUSD(payment.amount)}</strong><span className={`payment-state state-${payment.status?.toLowerCase()}`}>{payment.status}</span><button type="button" className="icon-btn" title="Edit payment" onClick={() => openPaymentForm(payment)}><Edit2 size={14} /></button></div></div>)}</div>}
      </div>}

      {activeTab === 'activity' && <div className="card focused-tab-card"><div className="card-header"><div><h3>Activity history</h3><p>Database-backed audit trail for important order events.</p></div></div>
        {relatedLoading ? <div className="loading-inline"><Loader2 className="spin" /> Loading…</div> : relatedError ? <div className="alert alert-danger">{relatedError}</div> : activity.length === 0 ? <div className="empty-state compact-empty"><p>No activity recorded yet.</p></div> : <div className="activity-timeline">{activity.map((event) => <div className="activity-event" key={event.id}><span className="activity-dot" /><div><strong>{activityLabel(event)}</strong><p>{event.from_value && `${event.from_value} → `}{event.to_value || ''}</p><small>{new Date(event.created_at).toLocaleString()}</small></div></div>)}</div>}
        <div className="automation-summary">
          <h4>Automation</h4>
          <p>Repeat-order reminder: {automation.reminder ? `${automation.reminder.status} for ${new Date(automation.reminder.remind_at).toLocaleDateString()}` : 'scheduled after delivery'}</p>
          <p>WhatsApp events: {automation.notifications.length ? `${automation.notifications.filter((item) => item.status === 'sent').length} sent · ${automation.notifications.filter((item) => item.status !== 'sent').length} pending/failed` : 'none queued'}</p>
        </div>
      </div>}

      {isAdmin && activeTab === 'overview' && <div className="danger-zone"><button className="btn btn-ghost btn-sm danger-text" onClick={handleDeleteOrder} disabled={deleting}>{deleting ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />} Delete order</button></div>}

      <Modal open={orderModalOpen} onClose={() => setOrderModalOpen(false)} title={`Edit ${order.id}`}>
        <form onSubmit={handleOrderSubmit}>
          <div className="form-grid">
            <label className="field-label full-span">Buyer<select className="select-input" value={orderForm.client_id || ''} onChange={(e) => setOrderForm({ ...orderForm, client_id: e.target.value })}>{clients.map((client) => <option key={client.id} value={client.id}>{client.company || client.contact || client.email || client.id}</option>)}</select></label>
            <label className="field-label">Status<select className="select-input" value={orderForm.status || ''} onChange={(e) => setOrderForm({ ...orderForm, status: e.target.value })}>{ORDER_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label className="field-label">Total value<input className="text-input" type="number" min="0" step="0.01" value={orderForm.total_value ?? ''} onChange={(e) => setOrderForm({ ...orderForm, total_value: e.target.value })} /></label>
            <label className="field-label">Incoterm<select className="select-input" value={orderForm.incoterm || 'FOB'} onChange={(e) => setOrderForm({ ...orderForm, incoterm: e.target.value })}>{['FOB', 'CFR', 'CIF', 'EXW'].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="field-label">Payment method<select className="select-input" value={orderForm.payment_method || 'LC'} onChange={(e) => setOrderForm({ ...orderForm, payment_method: e.target.value })}>{['LC', 'TT', 'CAD', 'DP', 'Advance'].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="field-label">Port of loading<input className="text-input" value={orderForm.pol_port || ''} onChange={(e) => setOrderForm({ ...orderForm, pol_port: e.target.value })} /></label>
            <label className="field-label">Port of discharge<input className="text-input" value={orderForm.pod_port || ''} onChange={(e) => setOrderForm({ ...orderForm, pod_port: e.target.value })} /></label>
            <label className="field-label">Shipment deadline<input className="text-input" type="date" value={orderForm.shipment_deadline || ''} onChange={(e) => setOrderForm({ ...orderForm, shipment_deadline: e.target.value })} /></label>
            <label className="field-label">Production %<input className="text-input" type="number" min="0" max="100" value={orderForm.production_progress || 0} onChange={(e) => setOrderForm({ ...orderForm, production_progress: e.target.value })} /></label>
            <label className="field-label full-span">Special instructions<textarea className="text-input" rows="3" value={orderForm.special_instructions || ''} onChange={(e) => setOrderForm({ ...orderForm, special_instructions: e.target.value })} /></label>
          </div>
          <div className="card-header" style={{ marginTop: 20 }}>
            <div><h3>Products</h3><p>Edit the product list at any order stage.</p></div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOrderItems((items) => [...items, { product_name: '', quantity_mt: '', unit_price: '' }])}><Plus size={14} /> Add product</button>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {orderItems.map((item, index) => <div className="form-grid" key={item.id || `new-${index}`}>
              <label className="field-label">Product<input className="text-input" value={item.product_name || ''} onChange={(e) => updateOrderItem(index, 'product_name', e.target.value)} /></label>
              <label className="field-label">Quantity (MT)<input className="text-input" type="number" min="0" step="0.01" value={item.quantity_mt ?? ''} onChange={(e) => updateOrderItem(index, 'quantity_mt', e.target.value)} /></label>
              <label className="field-label">Unit price<input className="text-input" type="number" min="0" step="0.01" value={item.unit_price ?? ''} onChange={(e) => updateOrderItem(index, 'unit_price', e.target.value)} /></label>
              <button type="button" className="btn btn-ghost danger-text" onClick={() => setOrderItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /> Remove</button>
            </div>)}
          </div>
          <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setOrderModalOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save all changes'}</button></div>
        </form>
      </Modal>

      <Modal open={shipmentModalOpen} onClose={() => setShipmentModalOpen(false)} title={shipment ? 'Edit Shipment Details' : 'Add Shipment Details'}>
        <form onSubmit={handleShipmentSubmit} className="shipment-form"><div className="form-grid">{[['shipping_line', 'Shipping Line'], ['vessel_voyage', 'Vessel / Voyage'], ['container_number', 'Container Number'], ['seal_number', 'Seal Number'], ['bl_number', 'Bill of Lading Number'], ['pol', 'Port of Loading'], ['pod', 'Port of Discharge']].map(([key, label]) => <label className="field-label" key={key}>{label}<input className="text-input" value={shipmentForm[key] || ''} onChange={(e) => setShipmentForm({ ...shipmentForm, [key]: e.target.value })} /></label>)}<label className="field-label">ETD<input className="text-input" type="date" value={shipmentForm.etd || ''} onChange={(e) => setShipmentForm({ ...shipmentForm, etd: e.target.value })} /></label><label className="field-label">ETA<input className="text-input" type="date" value={shipmentForm.eta || ''} onChange={(e) => setShipmentForm({ ...shipmentForm, eta: e.target.value })} /></label><label className="field-label">Status<select className="select-input" value={shipmentForm.status} onChange={(e) => setShipmentForm({ ...shipmentForm, status: e.target.value })}>{SHIPMENT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label></div><div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setShipmentModalOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save shipment'}</button></div></form>
      </Modal>

      <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title={editingPaymentId ? 'Edit Payment' : 'Record Payment'}>
        <form onSubmit={handlePaymentSubmit} className="shipment-form"><div className="form-grid"><label className="field-label">Payment type<select className="select-input" value={paymentForm.payment_type} onChange={(e) => setPaymentForm({ ...paymentForm, payment_type: e.target.value })}>{['Advance', 'Balance', 'Other'].map((type) => <option key={type}>{type}</option>)}</select></label><label className="field-label">Amount (USD)<input required min="0" step="0.01" className="text-input" type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></label><label className="field-label">Status<select className="select-input" value={paymentForm.status} onChange={(e) => setPaymentForm({ ...paymentForm, status: e.target.value })}>{['Due', 'Received', 'Reconciled', 'Cancelled'].map((status) => <option key={status}>{status}</option>)}</select></label><label className="field-label">Payment date<input className="text-input" type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} /></label><label className="field-label">Bank reference<input className="text-input" value={paymentForm.bank_reference} onChange={(e) => setPaymentForm({ ...paymentForm, bank_reference: e.target.value })} /></label><label className="field-label">Notes<input className="text-input" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} /></label></div><div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setPaymentModalOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editingPaymentId ? 'Save payment changes' : 'Record payment'}</button></div></form>
      </Modal>
    </div>
  );
}

function DetailRow({ label, value }) { return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>; }
function Stat({ icon: Icon, label, value, helper }) { return <div className="trade-stat-card"><Icon size={18} /><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div>; }
function activityLabel(event) { return ({ order_created: 'Order created', inquiry_converted: 'Inquiry converted', status_changed: 'Status changed', tracking_link_rotated: 'Buyer link rotated', process_step_changed: `Process step ${event.metadata?.step_number || ''} updated` })[event.event_type] || event.event_type.replaceAll('_', ' '); }
