import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Download, FileCheck2, FileText, Loader2, Search, ShieldCheck, X } from 'lucide-react';
import Badge from '../components/Badge';
import { supabase } from '../lib/supabaseClient';

const DOC_FILTERS = ['All', 'Pending', 'In Progress', 'Uploaded', 'Verified', 'Sent to Buyer'];

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('order_documents')
      .select('*, orders(id, clients(company, country))')
      .order('updated_at', { ascending: false });
    if (error) setError(error.message);
    else setDocuments(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return documents.filter((doc) => {
      const searchable = [
        doc.document_type,
        doc.file_name,
        doc.status,
        doc.responsible_party,
        doc.orders?.id,
        doc.orders?.clients?.company,
        doc.orders?.clients?.country,
      ].filter(Boolean).join(' ').toLowerCase();
      return (!text || searchable.includes(text)) && (statusFilter === 'All' || doc.status === statusFilter);
    });
  }, [documents, query, statusFilter]);

  const uploaded = documents.filter((d) => ['Uploaded', 'Verified', 'Sent to Buyer'].includes(d.status)).length;
  const verified = documents.filter((d) => ['Verified', 'Sent to Buyer'].includes(d.status)).length;
  const pending = documents.filter((d) => ['Pending', 'In Progress'].includes(d.status)).length;

  async function handleView(filePath) {
    if (!filePath) return alert('No file uploaded yet.');
    const { data, error } = await supabase.storage.from('order-documents').createSignedUrl(filePath, 60);
    if (error) return alert(error.message);
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleRemove(docId, filePath) {
    if (!window.confirm('Remove this file from the checklist?')) return;
    if (filePath) {
      const { error } = await supabase.storage.from('order-documents').remove([filePath]);
      if (error) return alert(error.message);
    }
    const { error } = await supabase.from('order_documents').update({ file_path: null, file_name: null, status: 'Pending', updated_at: new Date().toISOString() }).eq('id', docId);
    if (error) return alert(error.message);
    load();
  }

  return (
    <div className="documents-workspace">
      <div className="page-header elevated-header">
        <div>
          <span className="eyebrow">Compliance</span>
          <h1>Documents</h1>
          <p>Central export document control for PI, BL, CO, SGS, fumigation and phytosanitary files.</p>
        </div>
      </div>

      <div className="order-health-grid">
        <DocMetric icon={FileText} label="Checklist Items" value={documents.length} helper="Across all orders" />
        <DocMetric icon={Download} label="Uploaded" value={uploaded} helper="Files attached" />
        <DocMetric icon={ShieldCheck} label="Verified" value={verified} helper="Ready for buyer/shipment" />
        <DocMetric icon={FileCheck2} label="Pending" value={pending} helper="Needs action" />
      </div>

      {error && <div className="card danger-alert"><AlertCircle size={18} /><div><strong>Couldn't load documents</strong><p>{error}</p></div></div>}

      <div className="card order-control-card">
        <div className="orders-toolbar">
          <div className="search-box wide-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search document, buyer, order, country or responsible party..." /></div>
          <select className="select-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>{DOC_FILTERS.map((status) => <option key={status}>{status}</option>)}</select>
        </div>

        {loading ? (
          <div className="empty-state"><Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} /><h4>Loading documents...</h4></div>
        ) : (
          <div className="orders-table-wrap">
            <table className="data-table documents-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Order</th>
                  <th>Buyer</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => (
                  <tr key={doc.id}>
                    <td><div className="doc-name-cell"><div className="doc-icon"><FileText size={16} /></div><div><strong>{doc.document_type}</strong><span>{doc.file_name || doc.responsible_party || 'No file uploaded'}</span></div></div></td>
                    <td>{doc.orders?.id ? <Link className="order-title-link" to={`/orders/${doc.orders.id}`}>{doc.orders.id}</Link> : '—'}</td>
                    <td><strong>{doc.orders?.clients?.company || '—'}</strong><div className="cell-muted">{doc.orders?.clients?.country || '—'}</div></td>
                    <td><Badge status={doc.status} /></td>
                    <td className="cell-muted">{doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : '—'}</td>
                    <td><div className="row-actions"><button className="icon-btn" onClick={() => handleView(doc.file_path)}><Download size={15} /></button><button className="icon-btn danger" onClick={() => handleRemove(doc.id, doc.file_path)}><X size={15} /></button></div></td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={6}><div className="empty-state"><FileText /><h4>No documents found</h4><p>Upload files from an order page. They will appear here automatically.</p></div></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DocMetric({ icon: Icon, label, value, helper }) {
  return <div className="trade-stat-card"><Icon size={18} /><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div>;
}
