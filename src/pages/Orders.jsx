import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowUpDown, CalendarClock, Download, Edit2, FileText, Loader2, Plus, Search, Ship, Trash2 } from 'lucide-react';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import OrderSummaryCards from '../components/orders/OrderSummaryCards';
import StageTracker from '../components/orders/StageTracker';
import { formatUSD } from '../data/mockData';
import { useAuth } from '../hooks/useAuth';
import { useClients } from '../hooks/useClients';
import { useOrders } from '../hooks/useOrders';
import { ORDER_STATUS_OPTIONS, getDocsProgress, getOrderUrgency, getStageProgress, normalizeStatus } from '../lib/orderWorkflow';

export default function Orders() {
  const { orders, loading, error, deleteOrder, createOrder, updateOrder } = useOrders();
  const { clients } = useClients();
  const { isAdmin } = useAuth();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');
  const [modalOpen, setModalOpen] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ client_id: '', status: 'Order Confirmed', incoterm: 'FOB', payment_method: 'LC' });
  const [editForm, setEditForm] = useState({});
  const [buyerQuery, setBuyerQuery] = useState('');

  const filteredOrders = useMemo(() => {
    const text = query.trim().toLowerCase();
    let list = orders.filter((order) => {
      const searchable = [
        order.id,
        order.clients?.company,
        order.clients?.country,
        order.status,
        order.incoterm,
        order.payment_method,
        order.pod_port,
        ...(order.order_items || []).map((item) => item.product_name),
      ].filter(Boolean).join(' ').toLowerCase();

      const matchesSearch = !text || searchable.includes(text);
      const matchesStatus = statusFilter === 'All' || normalizeStatus(order.status) === statusFilter;
      return matchesSearch && matchesStatus;
    });

    if (sortBy === 'Value') list = [...list].sort((a, b) => Number(b.total_value || 0) - Number(a.total_value || 0));
    if (sortBy === 'Deadline') list = [...list].sort((a, b) => new Date(a.shipment_deadline || '2999-01-01') - new Date(b.shipment_deadline || '2999-01-01'));
    if (sortBy === 'Progress') list = [...list].sort((a, b) => getStageProgress(a.status) - getStageProgress(b.status));
    return list;
  }, [orders, query, statusFilter, sortBy]);

  async function handleCreate() {
    if (!form.client_id) return alert('Please select a buyer first.');
    setSaving(true);
    const { error } = await createOrder(form);
    setSaving(false);
    if (error) return alert(`Couldn't create order: ${error}`);
    setModalOpen(false);
    setForm({ client_id: '', status: 'Order Confirmed', incoterm: 'FOB', payment_method: 'LC' });
  }


  const buyerOptions = useMemo(() => {
    const q = buyerQuery.trim().toLowerCase();
    return [...clients]
      .filter((client) => {
        if (!q) return true;
        return [client.company, client.contact, client.country, client.email, client.id]
          .some((field) => String(field ?? '').toLowerCase().includes(q));
      })
      .sort((a, b) => String(a.company || '').localeCompare(String(b.company || '')))
      .slice(0, 200);
  }, [clients, buyerQuery]);

  const selectedBuyer = useMemo(
    () => clients.find((client) => String(client.id ?? '') === String(form.client_id ?? '')),
    [clients, form.client_id]
  );

  function openEdit(order) {
    setSelectedOrder(order);
    setEditForm({
      status: normalizeStatus(order.status),
      incoterm: order.incoterm || 'FOB',
      payment_method: order.payment_method || 'LC',
      pol_port: order.pol_port || '',
      pod_port: order.pod_port || '',
      total_value: order.total_value || '',
      shipment_deadline: order.shipment_deadline ? order.shipment_deadline.slice(0, 10) : '',
      production_progress: order.production_progress || 0,
      special_instructions: order.special_instructions || '',
    });
    setEditModal(true);
  }

  async function handleEdit() {
    setSaving(true);
    const { error } = await updateOrder(selectedOrder.id, editForm);
    setSaving(false);
    if (error) return alert(`Couldn't update order: ${error}`);
    setEditModal(false);
  }

  async function handleDelete(order) {
    if (!window.confirm(`Delete ${order.id} for ${order.clients?.company || 'this buyer'}? This cannot be undone.`)) return;
    const { error } = await deleteOrder(order.id);
    if (error) alert(`Couldn't delete order: ${error}`);
  }

  function exportCsv() {
    const rows = filteredOrders.map((order) => ({
      id: order.id,
      buyer: order.clients?.company || '',
      country: order.clients?.country || '',
      status: order.status || '',
      value: order.total_value || 0,
      incoterm: order.incoterm || '',
      payment_method: order.payment_method || '',
      pod_port: order.pod_port || '',
      shipment_deadline: order.shipment_deadline || '',
    }));
    const headers = Object.keys(rows[0] || { id: '', buyer: '', country: '', status: '', value: '', incoterm: '', payment_method: '', pod_port: '', shipment_deadline: '' });
    const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ktc-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="orders-workspace">
      <div className="page-header elevated-header">
        <div>
          <span className="eyebrow">Export Operations</span>
          <h1>Orders</h1>
          <p>Manage confirmed deals, production, documents and shipments from one workflow.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          <button className="btn btn-primary" onClick={() => { setForm({ client_id: '', status: 'Order Confirmed', incoterm: 'FOB', payment_method: 'LC' }); setBuyerQuery(''); setModalOpen(true); }}><Plus size={16} /> New Order</button>
        </div>
      </div>

      <OrderSummaryCards orders={orders} />

      {error && (
        <div className="card alert-card danger-alert">
          <AlertCircle size={18} />
          <div><strong>Couldn't load orders</strong><p>{error}</p></div>
        </div>
      )}

      <div className="card order-control-card">
        <div className="orders-toolbar">
          <div className="search-box wide-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search buyer, country, product, port or order ID..." /></div>
          <select className="select-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option>All</option>
            {ORDER_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
          </select>
          <select className="select-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option>Newest</option>
            <option>Value</option>
            <option>Deadline</option>
            <option>Progress</option>
          </select>
        </div>

        {loading ? (
          <div className="empty-state"><Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} /><h4>Loading orders...</h4></div>
        ) : filteredOrders.length === 0 ? (
          <div className="empty-state"><Ship /><h4>No orders found</h4><p>Create a new order or adjust the search/filter.</p></div>
        ) : (
          <div className="orders-table-wrap">
            <table className="data-table orders-table">
              <thead>
                <tr>
                  <th>Order / Buyer</th>
                  <th>Workflow</th>
                  <th>Products</th>
                  <th>Value</th>
                  <th><span className="inline-th"><CalendarClock size={14} /> Deadline</span></th>
                  <th>Docs</th>
                  <th><span className="inline-th"><ArrowUpDown size={14} /> Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const urgency = getOrderUrgency(order);
                  const docs = getDocsProgress(order.order_documents || []);
                  return (
                    <tr key={order.id}>
                      <td>
                        <Link to={`/orders/${order.id}`} className="order-title-link">{order.id}</Link>
                        <div className="cell-muted">{order.clients?.company || 'Unknown buyer'} · {order.clients?.country || '—'}</div>
                      </td>
                      <td>
                        <Badge status={normalizeStatus(order.status)} />
                        <StageTracker status={order.status} compact />
                      </td>
                      <td className="cell-muted product-cell">
                        {(order.order_items || []).slice(0, 2).map((item) => `${item.product_name} (${item.quantity_mt} MT)`).join(', ') || 'No items yet'}
                      </td>
                      <td><strong>{formatUSD(order.total_value)}</strong><div className="cell-muted">{order.incoterm || 'FOB'} · {order.payment_method || 'LC'}</div></td>
                      <td><span className={`urgency-pill ${urgency.tone}`}>{urgency.label}</span><div className="cell-muted">{order.pod_port || 'POD pending'}</div></td>
                      <td>
                        <div className="mini-progress"><span style={{ width: `${docs.percent}%` }} /></div>
                        <div className="cell-muted">{docs.total ? `${docs.complete}/${docs.total}` : 'Not started'}</div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <Link className="icon-btn" to={`/orders/${order.id}`} title="Open order"><FileText size={15} /></Link>
                          <button className="icon-btn" onClick={() => openEdit(order)} title="Edit order"><Edit2 size={15} /></button>
                          {isAdmin && <button className="icon-btn danger" onClick={() => handleDelete(order)} title="Delete order"><Trash2 size={15} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Create New Export Order">
        <div className="form-grid">
          <div className="field-label full-span">
            <span>Buyer</span>
            <div style={{ display: 'grid', gap: 8 }}>
              <input
                className="text-input"
                value={buyerQuery}
                onChange={(e) => setBuyerQuery(e.target.value)}
                placeholder="Search buyer by company, country or email..."
              />
              <select
                className="select-input"
                value={String(form.client_id ?? '')}
                onChange={(e) => setForm((f) => ({ ...f, client_id: String(e.target.value ?? '') }))}
                size={Math.min(Math.max(buyerOptions.length || 1, 6), 10)}
                style={{ minHeight: 220 }}
              >
                {buyerOptions.length === 0 ? (
                  <option value="">No buyers found</option>
                ) : (
                  buyerOptions.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.company || client.contact || client.email || client.id}
                      {client.country ? ` — ${client.country}` : ''}
                    </option>
                  ))
                )}
              </select>
              <div className="cell-muted">
                {selectedBuyer
                  ? `Selected: ${selectedBuyer.company || selectedBuyer.contact || selectedBuyer.id}${selectedBuyer.country ? ` · ${selectedBuyer.country}` : ''}`
                  : 'Choose one buyer from the list above.'}
              </div>
            </div>
          </div>
          <label className="field-label">Status<select className="select-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{ORDER_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field-label">Incoterm<select className="select-input" value={form.incoterm} onChange={(e) => setForm({ ...form, incoterm: e.target.value })}>{['FOB', 'CFR', 'CIF', 'EXW'].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field-label">Payment<select className="select-input" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>{['LC', 'TT', 'CAD', 'DP', 'Advance'].map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={handleCreate} disabled={saving || !String(form.client_id ?? '').trim()}>{saving ? 'Creating...' : 'Create Order'}</button></div>
      </Modal>

      <Modal open={editModal} onClose={() => setEditModal(false)} title={`Update ${selectedOrder?.id || 'Order'}`}>
        <div className="form-grid">
          <label className="field-label">Status<select className="select-input" value={editForm.status || ''} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>{ORDER_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field-label">Total Value<input className="text-input" type="number" value={editForm.total_value || ''} onChange={(e) => setEditForm({ ...editForm, total_value: e.target.value })} /></label>
          <label className="field-label">Incoterm<select className="select-input" value={editForm.incoterm || 'FOB'} onChange={(e) => setEditForm({ ...editForm, incoterm: e.target.value })}>{['FOB', 'CFR', 'CIF', 'EXW'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field-label">Payment Method<select className="select-input" value={editForm.payment_method || 'LC'} onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}>{['LC', 'TT', 'CAD', 'DP', 'Advance'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field-label">POL<input className="text-input" value={editForm.pol_port || ''} onChange={(e) => setEditForm({ ...editForm, pol_port: e.target.value })} /></label>
          <label className="field-label">POD<input className="text-input" value={editForm.pod_port || ''} onChange={(e) => setEditForm({ ...editForm, pod_port: e.target.value })} /></label>
          <label className="field-label">Shipment Deadline<input className="text-input" type="date" value={editForm.shipment_deadline || ''} onChange={(e) => setEditForm({ ...editForm, shipment_deadline: e.target.value })} /></label>
          <label className="field-label">Production %<input className="text-input" type="number" min="0" max="100" value={editForm.production_progress || 0} onChange={(e) => setEditForm({ ...editForm, production_progress: Number(e.target.value) })} /></label>
          <label className="field-label full-span">Special Instructions<textarea className="text-input" rows="3" value={editForm.special_instructions || ''} onChange={(e) => setEditForm({ ...editForm, special_instructions: e.target.value })} /></label>
        </div>
        <div className="modal-actions"><button className="btn btn-ghost" onClick={() => setEditModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleEdit} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button></div>
      </Modal>
    </div>
  );
}
