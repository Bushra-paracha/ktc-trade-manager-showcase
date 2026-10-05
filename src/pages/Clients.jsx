import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUpDown,
  Download,
  Edit2,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import Papa from 'papaparse';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import { useClients } from '../hooks/useClients';
import { supabase } from '../lib/supabaseClient';
import BuyerActionCenter from '../components/buyers/BuyerActionCenter';
import BuyerSummaryCards from '../components/buyers/BuyerSummaryCards';
import LeadScoreBadge, { getLeadTier } from '../components/buyers/LeadScoreBadge';
import { formatDaysAgo, useLastEmailedByClient } from '../hooks/useOutreach';

const STATUSES = ['New', 'Contacted', 'Engaged', 'Negotiating', 'Won', 'Lost', 'Dormant'];
const SOURCES = [
  'B2B Platform',
  'B2B Platform — Rice Importers List',
  'B2B Platform — Supermarkets/Retailers List',
  'B2B Platform — Amazon/Ecommerce Sellers List',
  'Trade Fair',
  'Referral',
  'Inbound Inquiry',
  'LinkedIn',
  'WhatsApp / Cold Outreach',
  'Other',
];

const EMPTY_FORM = {
  company: '',
  contact: '',
  title: '',
  country: '',
  city: '',
  email: '',
  phone: '',
  source: 'B2B Platform',
  products_interest: '',
  est_volume: '',
    status: 'New',
  score: 0,
  assigned_to: '',
  notes: '',
  status_detail: '',
  preferred_incoterm: '',
  destination_ports: '',
  packing_preference: '',
  payment_terms: '',
};

const INCOTERMS = ['', 'FOB', 'CFR', 'CIF', 'EXW'];

function productsText(value) {
  if (Array.isArray(value)) return value.join(', ');
  return value || '';
}

function normalizeProducts(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'B';
}

function getSegment(client) {
  const src = client.source || '';
  if (src.includes('Rice Importers')) return 'Rice Importers';
  if (src.includes('Supermarkets')) return 'Supermarkets / Retail';
  if (src.includes('Amazon')) return 'Amazon / Ecommerce';
  if (src.includes('Inbound')) return 'Inbound';
  if (src.includes('WhatsApp')) return 'WhatsApp Outreach';
  return 'Other / Manual';
}

export default function Clients() {
  const {
    clients,
    loading,
    error,
    refetch,
    addClient,
    updateClient,
    deleteClient,
    bulkAddClients,
  } = useClients();
  const { isAdmin } = useAuth();
  const { lastEmailedByClient } = useLastEmailedByClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [tier, setTier] = useState('');
  const [segment, setSegment] = useState('');
  const [sortBy, setSortBy] = useState('score');
  const [modalOpen, setModalOpen] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState(null);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreMessage, setRescoreMessage] = useState(null);

  const countries = useMemo(() => [...new Set(clients.map((c) => c.country).filter(Boolean))].sort(), [clients]);
  const segments = useMemo(() => [...new Set(clients.map(getSegment))].sort(), [clients]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = clients.filter((client) => {
      const text = [client.company, client.contact, client.country, client.email, client.phone, productsText(client.products_interest)]
        .join(' ')
        .toLowerCase();
      const matchesSearch = !q || text.includes(q);
      const matchesStatus = !status || client.status === status;
      const matchesCountry = !country || client.country === country;
      const matchesTier = !tier || getLeadTier(client.score).label === tier;
      const matchesSegment = !segment || getSegment(client) === segment;
      return matchesSearch && matchesStatus && matchesCountry && matchesTier && matchesSegment;
    });

    if (sortBy === 'score') list = [...list].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    if (sortBy === 'company') list = [...list].sort((a, b) => String(a.company || '').localeCompare(String(b.company || '')));
    if (sortBy === 'recent') list = [...list].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return list;
  }, [clients, search, status, country, tier, segment, sortBy]);

  function openCreate() {
    setEditClient(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(client) {
    setEditClient(client);
    setForm({
      company: client.company || '',
      contact: client.contact || '',
      title: client.title || '',
      country: client.country || '',
      city: client.city || '',
      email: client.email || '',
      phone: client.phone || '',
      source: client.source || 'B2B Platform',
      products_interest: productsText(client.products_interest),
      est_volume: client.est_volume || '',
      status: client.status || 'New',
      score: client.score || 0,
      assigned_to: client.assigned_to || '',
      notes: client.notes || '',
      status_detail: client.status_detail || '',
      preferred_incoterm: client.preferred_incoterm || '',
      destination_ports: client.destination_ports || '',
      packing_preference: client.packing_preference || '',
      payment_terms: client.payment_terms || '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const payload = {
      ...form,
      score: Number(form.score) || 0,
      products_interest: normalizeProducts(form.products_interest),
      contact: form.contact || null,
      title: form.title || null,
      country: form.country || null,
      city: form.city || null,
      email: form.email || null,
      phone: form.phone || null,
      est_volume: form.est_volume || null,
      assigned_to: form.assigned_to || null,
      notes: form.notes || null,
      status_detail: form.status_detail || null,
      preferred_incoterm: form.preferred_incoterm || null,
      destination_ports: form.destination_ports || null,
      packing_preference: form.packing_preference || null,
      payment_terms: form.payment_terms || null,
    };

    const result = editClient ? await updateClient(editClient.id, payload) : await addClient(payload);
    if (result.error) {
      setFormError(result.error);
    } else {
      setModalOpen(false);
      setEditClient(null);
      setForm(EMPTY_FORM);
    }
    setSaving(false);
  }

  async function handleDelete(client) {
    if (!window.confirm(`Delete ${client.company}? This cannot be undone.`)) return;
    const result = await deleteClient(client.id);
    if (result.error) window.alert(result.error);
  }

  async function handleRescore() {
    setRescoring(true);
    setRescoreMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('rescore_clients');
      if (rpcError) throw new Error(rpcError.message);
      setRescoreMessage(`Rescored ${data?.updated || 'all'} buyer records.`);
      refetch();
    } catch (err) {
      setRescoreMessage(`Could not rescore buyers: ${err.message}`);
    }
    setRescoring(false);
  }

  function handleCsv(file) {
    setImportMessage(null);
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = (results.data || [])
          .map((row) => ({
            company: row.company || row.Company || row['Company Name'] || '',
            contact: row.contact || row.Contact || row['Contact Person'] || '',
            title: row.title || row.Title || '',
            country: row.country || row.Country || '',
            city: row.city || row.City || '',
            email: row.email || row.Email || '',
            phone: row.phone || row.Phone || row.WhatsApp || '',
            source: row.source || row.Source || 'Other',
            products_interest: row.products_interest || row.products || row.Products || '',
            est_volume: row.est_volume || row.Volume || row['Estimated Volume'] || '',
            assigned_to: row.assigned_to || row.Assigned || '',
            notes: row.notes || row.Notes || '',
          }))
          .filter((row) => row.company);
        setImportRows(rows);
      },
      error: (parseError) => setImportMessage(parseError.message),
    });
  }

  async function handleImport() {
    if (!importRows.length) return;
    setImporting(true);
    const result = await bulkAddClients(importRows);
    const skippedNote = result.skipped?.length
      ? ` Skipped ${result.skipped.length} already in the CRM or repeated in the file: ${result.skipped.slice(0, 5).join(', ')}${result.skipped.length > 5 ? '…' : ''}.`
      : '';
    if (result.errorCount) {
      setImportMessage(`Imported ${result.successCount}. Errors: ${result.errors.join(', ')}.${skippedNote}`);
    } else {
      setImportMessage(`Imported ${result.successCount} buyers.${skippedNote}`);
      setImportRows([]);
    }
    setImporting(false);
  }

  function downloadTemplate() {
    const csv = 'company,contact,title,country,city,email,phone,source,products_interest,est_volume,assigned_to,notes\nABC Foods,Ahmed Khan,Purchase Manager,Malaysia,Kuala Lumpur,buyer@example.com,+60123456789,B2B Platform,IRRI-6 White Rice,500 MT/month,Bushra,Interested in FOB pricing\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ktc-buyer-import-template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (loading) {
    return (
      <div className="card dashboard-loading">
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
        <p>Loading buyers...</p>
      </div>
    );
  }

  return (
    <div className="buyers-page">
      <section className="buyers-hero">
        <div>
          <div className="dashboard-eyebrow"><UserPlus size={16} /> Buyer CRM</div>
          <h1>Manage every international buyer from one place.</h1>
          <p>
            Track rice, salt and sesame leads by priority, country, product interest and next action — without jumping between separate pages.
          </p>
        </div>
        <div className="buyers-hero-actions">
          <button className="btn btn-secondary" onClick={downloadTemplate}><Download /> CSV Template</button>
          <button className="btn btn-secondary" onClick={() => setImportOpen(true)}><Upload /> Import</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus /> New Buyer</button>
        </div>
      </section>

      {error && (
        <div className="buyer-error"><AlertCircle size={18} /> {error}</div>
      )}

      <BuyerSummaryCards clients={clients} />

      <div className="buyers-workspace">
        <main className="buyers-main">
          <div className="card buyers-table-card">
            <div className="buyers-toolbar">
              <div className="buyers-search">
                <Search size={16} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search buyer, country, email, product..." />
              </div>
              <select className="select-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((item) => <option key={item}>{item}</option>)}
              </select>
              <select className="select-input" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">All countries</option>
                {countries.map((item) => <option key={item}>{item}</option>)}
              </select>
              <select className="select-input" value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">All lead scores</option>
                {['Hot', 'Warm', 'Nurture', 'Cold'].map((item) => <option key={item}>{item}</option>)}
              </select>
              <select className="select-input" value={segment} onChange={(e) => setSegment(e.target.value)}>
                <option value="">All segments</option>
                {segments.map((item) => <option key={item}>{item}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={() => setSortBy(sortBy === 'score' ? 'recent' : 'score')}>
                <ArrowUpDown /> {sortBy === 'score' ? 'Top score' : 'Newest'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleRescore} disabled={rescoring}>
                {rescoring ? <Loader2 style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw />} Rescore
              </button>
            </div>

            {(rescoreMessage) && <div className="buyer-inline-note">{rescoreMessage}</div>}

            <div className="buyer-results-header">
              <strong>{filtered.length} buyers</strong>
              <span>Showing the most important buyer details for daily follow-up.</span>
            </div>

            <div className="buyers-list">
              {filtered.map((client) => (
                <article className="buyer-row" key={client.id}>
                  <Link className="buyer-row-main" to={`/clients/${client.id}`}>
                    <div className="buyer-avatar">{getInitials(client.company)}</div>
                    <div className="buyer-row-text">
                      <div className="buyer-row-title">
                        <strong>{client.company || 'Unnamed buyer'}</strong>
                        <Badge status={client.status || 'New'} />
                      </div>
                      <div className="buyer-row-meta">
                        <span>{client.country || 'Unknown country'}</span>
                        <span>{client.contact || 'No contact name'}</span>
                        <span>{productsText(client.products_interest) || 'Products not set'}</span>
                      </div>
                      <div className="buyer-contact-strip">
                        <span><Mail size={13} /> {client.email || 'No email'}</span>
                        <span><MessageCircle size={13} /> {client.phone || 'No WhatsApp'}</span>
                        <span style={lastEmailedByClient.has(client.id) && (Date.now() - new Date(lastEmailedByClient.get(client.id)).getTime()) < 1000 * 60 * 60 * 24 * 7 ? { color: 'var(--color-danger)' } : undefined}>
                          {lastEmailedByClient.has(client.id)
                            ? `Emailed ${formatDaysAgo(lastEmailedByClient.get(client.id))}`
                            : 'Never emailed'}
                        </span>
                      </div>
                    </div>
                  </Link>
                  <div className="buyer-row-side">
                    <LeadScoreBadge score={client.score} />
                    <span className="buyer-segment-pill">{getSegment(client)}</span>
                    <div className="buyer-row-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(client)}><Edit2 /> Edit</button>
                      {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(client)}><Trash2 /> Delete</button>}
                    </div>
                  </div>
                </article>
              ))}
              {filtered.length === 0 && (
                <div className="empty-state"><h4>No buyers found</h4><p>Try clearing filters or adding a new buyer.</p></div>
              )}
            </div>
          </div>
        </main>

        <BuyerActionCenter clients={clients} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editClient ? 'Edit Buyer' : 'Add New Buyer'}>
        <form onSubmit={handleSubmit} className="form-grid buyer-form-grid">
          {formError && <div className="form-error"><AlertCircle size={16} /> {formError}</div>}
          <label>Company<input value={form.company} onChange={(e) => updateForm('company', e.target.value)} required /></label>
          <label>Contact Person<input value={form.contact} onChange={(e) => updateForm('contact', e.target.value)} /></label>
          <label>Title<input value={form.title} onChange={(e) => updateForm('title', e.target.value)} /></label>
          <label>Country<input value={form.country} onChange={(e) => updateForm('country', e.target.value)} /></label>
          <label>City<input value={form.city} onChange={(e) => updateForm('city', e.target.value)} /></label>
          <label>Email<input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} /></label>
          <label>Phone / WhatsApp<input value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} /></label>
          <label>Source<select value={form.source} onChange={(e) => updateForm('source', e.target.value)}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Products Interested<input value={form.products_interest} onChange={(e) => updateForm('products_interest', e.target.value)} placeholder="IRRI-6, 1121 Sella, Pink Salt" /></label>
          <label>Estimated Volume<input value={form.est_volume} onChange={(e) => updateForm('est_volume', e.target.value)} placeholder="500 MT/month" /></label>
          <label>Status<select value={form.status} onChange={(e) => updateForm('status', e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Status note<input value={form.status_detail} onChange={(e) => updateForm('status_detail', e.target.value)} placeholder="e.g. Needs qualification" /></label>
          <label>Lead Score<input type="number" min="0" max="100" value={form.score} onChange={(e) => updateForm('score', e.target.value)} /></label>
          <label>Preferred Incoterm<select value={form.preferred_incoterm} onChange={(e) => updateForm('preferred_incoterm', e.target.value)}>{INCOTERMS.map((t) => <option key={t} value={t}>{t || 'Not set'}</option>)}</select></label>
          <label>Destination Port(s)<input value={form.destination_ports} onChange={(e) => updateForm('destination_ports', e.target.value)} placeholder="Jebel Ali, Port Klang" /></label>
          <label>Packing<input value={form.packing_preference} onChange={(e) => updateForm('packing_preference', e.target.value)} placeholder="25 kg PP bags, private label" /></label>
          <label>Payment Terms<input value={form.payment_terms} onChange={(e) => updateForm('payment_terms', e.target.value)} placeholder="30% advance, 70% CAD" /></label>
          <label>Assigned To<input value={form.assigned_to} onChange={(e) => updateForm('assigned_to', e.target.value)} /></label>
          <label className="full">Notes<textarea rows="4" value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} /></label>
          <div className="modal-actions full">
            <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Loader2 style={{ animation: 'spin 1s linear infinite' }} /> : null}{editClient ? 'Save Changes' : 'Add Buyer'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import Buyers from CSV">
        <div className="import-panel">
          <p>Upload a CSV with columns like company, contact, country, email, phone, products_interest and est_volume.</p>
          <input type="file" accept=".csv" onChange={(e) => handleCsv(e.target.files?.[0])} />
          {importRows.length > 0 && <div className="buyer-inline-note">Ready to import {importRows.length} buyer records.</div>}
          {importMessage && <div className="buyer-inline-note">{importMessage}</div>}
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={downloadTemplate}><Download /> Download Template</button>
            <button className="btn btn-primary" onClick={handleImport} disabled={!importRows.length || importing}>{importing ? <Loader2 style={{ animation: 'spin 1s linear infinite' }} /> : <Upload />} Import Buyers</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
