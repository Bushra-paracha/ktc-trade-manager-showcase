import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Mail,
  MousePointerClick,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Reply,
  Save,
  Send,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react';
import Badge from '../components/Badge';
import { htmlToText, textToHtml } from '../lib/emailText';
import InquiryFromClientModal from '../components/buyers/InquiryFromClientModal';
import BouncedPanel from '../components/outreach/BouncedPanel';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabaseClient';
import { primaryEmail } from '../lib/emailAddress';
import { REGION_NAMES, UNKNOWN, clientLocation } from '../lib/locations';
import Modal from '../components/Modal';
import { useClients } from '../hooks/useClients';
import {
  addEmailDomain,
  addEmailSender,
  createEmailTemplate,
  deleteEmailTemplate,
  updateEmailTemplate,
  renderTemplate,
  sendOutreachEmails,
  syncTemplatesFromBrevo,
  uploadTemplatePdf,
  useEmailSenders,
  useEmailMessages,
  useEmailTemplates,
  verifyEmailDomain,
  buildLastEmailedMap,
  formatDaysAgo,
} from '../hooks/useOutreach';

function FormRow({ label, children }) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        fontSize: 12.5,
        color: 'var(--color-ink-soft)',
        fontWeight: 600,
      }}
    >
      {label}
      {children}
    </label>
  );
}

function MetricCard({ label, value, icon: Icon }) {
  return (
    <div className="card padded">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="cell-muted" style={{ fontSize: 12, marginBottom: 5 }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
        </div>
        <Icon size={22} color="var(--color-accent)" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function Outreach() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { clients, loading: clientsLoading } = useClients();
  const { canEdit } = useAuth();
  const {
    messages,
    loading: messagesLoading,
    error: messagesError,
    refetch,
    checkForReplies,
    checkingReplies,
    checkError,
    checkResult,
  } = useEmailMessages();
  const {
    templates,
    loading: templatesLoading,
    error: templatesError,
    refetch: refetchTemplates,
  } = useEmailTemplates();
  const {
    senders,
    domains,
    loading: sendersLoading,
    error: sendersError,
    refetch: refetchSenders,
  } = useEmailSenders();

  const [composeOpen, setComposeOpen] = useState(false);
  const [repliesOnly, setRepliesOnly] = useState(false);
  const [inquiryFrom, setInquiryFrom] = useState(null); // { client, sourceRef, note }
  const [templateOpen, setTemplateOpen] = useState(false);
  const [sendersOpen, setSendersOpen] = useState(false);
  const [selectedClientIds, setSelectedClientIds] = useState([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [hideRecent, setHideRecent] = useState(false);
  const [bulkCount, setBulkCount] = useState(30);
  const [historyView, setHistoryView] = useState('history');
  const [bouncedCount, setBouncedCount] = useState(null);
  const [templateId, setTemplateId] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [templateDraft, setTemplateDraft] = useState({ name: '', subject: '', body: '', pdf: null, removePdf: false });
  const [editingTemplate, setEditingTemplate] = useState(null); // template being edited, or null when adding
  const [templateSaving, setTemplateSaving] = useState(false);
  const [managementMessage, setManagementMessage] = useState('');
  const [domainDraft, setDomainDraft] = useState('');
  const [senderDraft, setSenderDraft] = useState({ name: 'Kassam Trading Company', email: '' });
  const [managingSender, setManagingSender] = useState(false);

  useEffect(() => {
    if (!senderEmail && senders.length) setSenderEmail(senders[0].email);
  }, [senderEmail, senders]);

  // Count for the Bounced tab label before it's opened.
  useEffect(() => {
    let active = true;
    supabase.rpc('bounced_buyers').then(({ data }) => {
      if (active && Array.isArray(data)) setBouncedCount(data.length);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (searchParams.get('compose') !== '1') return;

    const clientId = searchParams.get('client');
    if (clientId) setSelectedClientIds([clientId]);
    setComposeOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const lastEmailedByClient = useMemo(() => buildLastEmailedMap(messages), [messages]);

  // Addresses that bounced before; buyers still on one can't be emailed until it's replaced (Bounced tab).
  const bouncedEmails = useMemo(
    () => new Set(messages.filter((m) => m.status === 'Bounced').map((m) => String(m.to_email || '').toLowerCase())),
    [messages],
  );

  // Every buyer with their tidied location and whether they can be emailed.
  const recipientPool = useMemo(() => clients.map((client) => {
    const email = primaryEmail(client.email);
    let blockedReason = null;
    if (!email) blockedReason = 'No email saved';
    else if (client.email_status && client.email_status !== 'ok') blockedReason = `Email ${client.email_status}`;
    else if (bouncedEmails.has(email)) blockedReason = 'Email bounced (see Bounced tab)';
    return { client, email, location: clientLocation(client), blockedReason };
  }), [clients, bouncedEmails]);

  const selectedSet = useMemo(() => new Set(selectedClientIds), [selectedClientIds]);
  const selectedClients = useMemo(
    () => recipientPool
      .filter((r) => selectedSet.has(r.client.id) && !r.blockedReason)
      .map((r) => ({ ...r.client, email: r.email })),
    [recipientPool, selectedSet],
  );

  const recentlyEmailed = useCallback((clientId) => {
    const last = lastEmailedByClient.get(clientId);
    return Boolean(last) && Date.now() - new Date(last).getTime() < 7 * 86400000;
  }, [lastEmailedByClient]);

  // Source -> region -> country -> city -> text search -> recently emailed.
  const sourceOptions = useMemo(() => {
    const counts = new Map();
    for (const r of recipientPool) counts.set(r.client.source || 'Other', (counts.get(r.client.source || 'Other') || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [recipientPool]);
  const sourcePool = useMemo(
    () => recipientPool.filter((r) => !sourceFilter || (r.client.source || 'Other') === sourceFilter),
    [recipientPool, sourceFilter],
  );
  const regionPool = useMemo(
    () => sourcePool.filter((r) => !regionFilter || r.location.region === regionFilter),
    [sourcePool, regionFilter],
  );
  const countryOptions = useMemo(() => {
    const counts = new Map();
    for (const r of regionPool) counts.set(r.location.country, (counts.get(r.location.country) || 0) + 1);
    return [...counts.entries()].sort((a, b) => (a[0] === UNKNOWN) - (b[0] === UNKNOWN) || b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [regionPool]);
  const filteredRecipients = useMemo(() => {
    const query = recipientSearch.trim().toLowerCase();
    const city = cityFilter.trim().toLowerCase();
    return regionPool.filter((r) => (!countryFilter || r.location.country === countryFilter)
      && (!city || r.location.city.toLowerCase().includes(city))
      && (!hideRecent || !recentlyEmailed(r.client.id))
      && (!query || [r.client.company, r.client.contact, r.client.country, r.client.city, r.client.email]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(query))));
  }, [regionPool, countryFilter, cityFilter, hideRecent, recipientSearch, recentlyEmailed]);
  const RECIPIENT_RENDER_LIMIT = 300;
  const eligibleInFilter = useMemo(
    () => filteredRecipients.filter((r) => !r.blockedReason && !selectedSet.has(r.client.id)),
    [filteredRecipients, selectedSet],
  );

  function selectFirstN() {
    const n = Math.max(1, Math.min(500, Math.floor(Number(bulkCount) || 0)));
    const add = eligibleInFilter.slice(0, n).map((r) => r.client.id);
    setSelectedClientIds((current) => [...current, ...add]);
  }

  function changeRegion(value) {
    setRegionFilter(value);
    setCountryFilter('');
  }

  const totals = useMemo(() => {
    const sentStatuses = ['Sent', 'Delivered', 'Opened', 'Clicked', 'Replied'];
    const sent = messages.filter((message) => sentStatuses.includes(message.status)).length;
    const opened = messages.filter((message) => message.opened_at).length;
    const clicked = messages.filter((message) => message.clicked_at).length;
    const replied = messages.filter((message) => message.status === 'Replied').length;
    return {
      total: messages.length,
      sent,
      opened,
      clicked,
      replied,
      bounced: messages.filter((message) => message.status === 'Bounced').length,
    };
  }, [messages]);

  function toggleClient(id) {
    setSelectedClientIds((current) =>
      current.includes(id) ? current.filter((clientId) => clientId !== id) : [...current, id],
    );
  }

  function applyTemplate(id) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    setSubject(template?.subject || '');
    setBody(htmlToText(template?.body_html || ''));
    setAttachment(template?.attachment_path
      ? { path: template.attachment_path, name: template.attachment_name || 'Attachment.pdf' }
      : null);
  }

  function closeCompose() {
    setComposeOpen(false);
    setSelectedClientIds([]);
    setRecipientSearch('');
    setRegionFilter('');
    setCountryFilter('');
    setCityFilter('');
    setHideRecent(false);
    setTemplateId('');
    setSubject('');
    setBody('');
    setAttachment(null);
    setSendResults(null);
  }

  async function handleSyncTemplates() {
    setSyncing(true);
    setSyncMessage('');
    const { data, error } = await syncTemplatesFromBrevo();
    setSyncing(false);
    if (error) {
      setSyncMessage(error);
      return;
    }
    setSyncMessage(`Synced ${data.created || 0} new and ${data.updated || 0} updated templates.`);
    await refetchTemplates();
  }

  async function handleSend() {
    if (!selectedClients.length || !subject.trim() || !body.trim()) return;

    const recipientLabel = selectedClients.length === 1
      ? `${selectedClients[0].company || selectedClients[0].email} (${selectedClients[0].email})`
      : `${selectedClients.length} selected buyers`;
    const selectedSender = senders.find((sender) => sender.email === senderEmail);
    const providerLabel = selectedSender?.provider === 'zoho' ? 'Zoho Mail' : 'Brevo';
    if (!window.confirm(`Send this email through ${providerLabel} to ${recipientLabel}?`)) return;

    setSending(true);
    setSendResults(null);
    const results = await sendOutreachEmails({
      clients: selectedClients,
      subjectTemplate: subject,
      bodyTemplate: textToHtml(body),
      senderEmail,
      attachmentPath: attachment?.path || null,
      attachmentName: attachment?.name || null,
    });
    setSending(false);
    setSendResults(results);
    await refetch();
  }

  function openNewTemplate() {
    setEditingTemplate(null);
    setTemplateDraft({ name: '', subject: '', body: '', pdf: null, removePdf: false });
    setTemplateOpen(true);
  }

  function openEditTemplate(template) {
    setEditingTemplate(template);
    setTemplateDraft({ name: template.name || '', subject: template.subject || '', body: htmlToText(template.body_html || ''), pdf: null, removePdf: false });
    setTemplateOpen(true);
  }

  function closeTemplateModal() {
    setTemplateOpen(false);
    setEditingTemplate(null);
    setTemplateDraft({ name: '', subject: '', body: '', pdf: null, removePdf: false });
  }

  async function handleSaveTemplateEdit({ asCopy = false } = {}) {
    if (!editingTemplate || asCopy) return handleCreateTemplate();
    if (!templateDraft.name.trim() || !templateDraft.subject.trim() || !templateDraft.body.trim()) return;
    setTemplateSaving(true);
    let attachmentChange;
    if (templateDraft.pdf) {
      const upload = await uploadTemplatePdf(templateDraft.pdf);
      if (upload.error) {
        setTemplateSaving(false);
        setManagementMessage(upload.error);
        return;
      }
      attachmentChange = upload.data;
    } else if (templateDraft.removePdf) {
      attachmentChange = null;
    }
    const { data, error } = await updateEmailTemplate(editingTemplate, {
      name: templateDraft.name,
      subject: templateDraft.subject,
      bodyHtml: textToHtml(templateDraft.body),
      attachment: attachmentChange,
    });
    setTemplateSaving(false);
    if (error) {
      setManagementMessage(error);
      return;
    }
    await refetchTemplates();
    // Keep the compose form in step if this template is the one in use.
    if (templateId === data.id) {
      setSubject(data.subject);
      setBody(htmlToText(data.body_html));
      setAttachment(data.attachment_path ? { path: data.attachment_path, name: data.attachment_name || 'Attachment.pdf' } : null);
    }
    closeTemplateModal();
    setManagementMessage(`Template "${data.name}" updated.`);
  }

  async function handleCreateTemplate() {
    if (!templateDraft.name.trim() || !templateDraft.subject.trim() || !templateDraft.body.trim()) return;
    setTemplateSaving(true);
    let uploadedPdf = null;
    if (templateDraft.pdf) {
      const upload = await uploadTemplatePdf(templateDraft.pdf);
      if (upload.error) {
        setTemplateSaving(false);
        setManagementMessage(upload.error);
        return;
      }
      uploadedPdf = upload.data;
    }
    if (!uploadedPdf && editingTemplate?.attachment_path && !templateDraft.removePdf) {
      uploadedPdf = { path: editingTemplate.attachment_path, name: editingTemplate.attachment_name || 'Attachment.pdf' };
    }
    const { data, error } = await createEmailTemplate({
      name: editingTemplate && templateDraft.name.trim() === editingTemplate.name ? `${templateDraft.name} (copy)` : templateDraft.name,
      subject: templateDraft.subject,
      bodyHtml: textToHtml(templateDraft.body),
      attachmentPath: uploadedPdf?.path || null,
      attachmentName: uploadedPdf?.name || null,
    });
    setTemplateSaving(false);
    if (error) {
      setManagementMessage(error);
      return;
    }
    await refetchTemplates();
    setTemplateId(data.id);
    setSubject(data.subject);
    setBody(htmlToText(data.body_html));
    setAttachment(uploadedPdf);
    closeTemplateModal();
    setManagementMessage('Email template saved and selected.');
  }

  async function handleDeleteTemplate(template) {
    if (!window.confirm(`Delete the template "${template.name}"? This cannot be undone.`)) return;
    const { error } = await deleteEmailTemplate(template);
    if (error) {
      setManagementMessage(error);
      return;
    }
    if (templateId === template.id) applyTemplate('');
    await refetchTemplates();
    setManagementMessage('Email template deleted.');
  }

  async function runSenderAction(action) {
    setManagingSender(true);
    setManagementMessage('');
    try {
      const data = action === 'domain'
        ? await addEmailDomain(domainDraft)
        : action === 'sender'
          ? await addEmailSender(senderDraft)
          : await verifyEmailDomain(action);
      setManagementMessage(data.message || 'Sender settings updated.');
      if (action === 'domain') setDomainDraft('');
      if (action === 'sender') setSenderDraft({ name: 'Kassam Trading Company', email: '' });
      await refetchSenders();
    } catch (err) {
      setManagementMessage(err.message);
    }
    setManagingSender(false);
  }

  const openRate = totals.sent ? `${((totals.opened / totals.sent) * 100).toFixed(1)}%` : '0.0%';
  const replyRate = totals.sent ? `${((totals.replied / totals.sent) * 100).toFixed(1)}%` : '0.0%';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Email Outreach</h1>
          <p>Send KTC email through Brevo or NBMT email through Zoho, with one shared CRM history.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={openNewTemplate}>
            <Plus size={16} /> Templates
          </button>
          <button className="btn btn-secondary" onClick={() => setSendersOpen(true)}>
            <Settings size={16} /> Senders & domains
          </button>
          <button className="btn btn-secondary" onClick={handleSyncTemplates} disabled={syncing}>
            {syncing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={16} />}
            Sync templates
          </button>
          <button className="btn btn-secondary" onClick={checkForReplies} disabled={checkingReplies}>
            {checkingReplies ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Reply size={16} />}
            Check replies
          </button>
          <button className="btn btn-primary" onClick={() => setComposeOpen(true)}>
            <Send size={16} /> Compose Email
          </button>
        </div>
      </div>

      {(messagesError || templatesError || sendersError || checkError) && (
        <div className="card padded" style={{ color: 'var(--color-danger)', marginBottom: 16 }}>
          <AlertTriangle size={17} /> {messagesError || templatesError || sendersError || checkError}
        </div>
      )}
      {(syncMessage || managementMessage || checkResult) && (
        <div className="card padded" style={{ marginBottom: 16 }}>
          {syncMessage || managementMessage || `Reply check complete: ${checkResult.newReplies || 0} new replies found.`}
        </div>
      )}

      <div className="stats-grid">
        <MetricCard label="Tracked" value={totals.total} icon={Mail} />
        <MetricCard label="Sent" value={totals.sent} icon={Send} />
        <MetricCard label="Open rate" value={openRate} icon={MousePointerClick} />
        <MetricCard label="Reply rate" value={replyRate} icon={Reply} />
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="outreach-views" role="tablist" aria-label="Outreach view">
              <button type="button" role="tab" aria-selected={historyView === 'history'} className={'tab' + (historyView === 'history' ? ' active' : '')} onClick={() => setHistoryView('history')}>
                Email history
              </button>
              <button type="button" role="tab" aria-selected={historyView === 'bounced'} className={'tab' + (historyView === 'bounced' ? ' active' : '')} onClick={() => setHistoryView('bounced')}>
                Bounced{bouncedCount != null ? ` (${bouncedCount})` : ''}
              </button>
            </div>
            {historyView === 'history' && <p>{totals.bounced} bounced · {totals.clicked} clicked</p>}
          </div>
          {historyView === 'history' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={repliesOnly} onChange={(event) => setRepliesOnly(event.target.checked)} /> Replies only
            </label>
          )}
        </div>
        {historyView === 'bounced' ? (
          <BouncedPanel canEdit={canEdit} onCountChange={setBouncedCount} />
        ) : messagesLoading ? (
          <div className="empty-state"><Loader2 style={{ animation: 'spin 1s linear infinite' }} /><p>Loading email history…</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Subject</th>
                  <th>From</th>
                  <th>Status</th>
                  <th>Opens</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {messages.filter((message) => !repliesOnly || message.status === 'Replied' || message.replied_at).map((message) => {
                  const reply = (message.email_replies || [])[0];
                  return (
                  <tr key={message.id}>
                    <td>
                      <div className="cell-strong">{message.clients?.company || message.to_email}</div>
                      <div className="cell-muted">{message.to_email}</div>
                    </td>
                    <td>
                      {message.subject}
                      {reply && <div className="cell-muted" style={{ marginTop: 4 }}>Reply: “{String(reply.body_text || '').slice(0, 140)}{String(reply.body_text || '').length > 140 ? '…' : ''}”</div>}
                      {(message.status === 'Replied' || message.replied_at) && message.client_id && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ marginTop: 6 }}
                          onClick={() => setInquiryFrom({
                            client: { id: message.client_id, company: message.clients?.company || message.to_email },
                            sourceRef: reply ? `email_replies:${reply.id}` : `email_messages:${message.id}`,
                            note: reply ? `${reply.subject || ''}\n\n${reply.body_text || ''}`.trim() : '',
                          })}
                        >
                          <Plus size={14} /> Create inquiry
                        </button>
                      )}
                    </td>
                    <td className="cell-muted">{message.sender_email}</td>
                    <td><Badge status={message.status} /></td>
                    <td>{message.open_count || 0}</td>
                    <td className="cell-muted">
                      {message.sent_at ? new Date(message.sent_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                  );
                })}
                {!messages.length && (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state"><Mail /><h4>No outreach emails yet</h4><p>Compose an email to begin.</p></div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {inquiryFrom && (
        <InquiryFromClientModal
          client={inquiryFrom.client}
          sourceRef={inquiryFrom.sourceRef}
          initialNote={inquiryFrom.note}
          onClose={() => setInquiryFrom(null)}
          onSaved={(data) => {
            setInquiryFrom(null);
            setManagementMessage(`Inquiry ${data?.inquiry_id || ''} created. It's on Today with a reply due in 4 hours.`);
          }}
        />
      )}

      <Modal open={composeOpen} onClose={closeCompose} title="Compose Outreach Email">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormRow label="Send from">
            <select
              className="select-input"
              value={senderEmail}
              onChange={(event) => setSenderEmail(event.target.value)}
              disabled={sendersLoading || !senders.length}
            >
              {!senders.length && <option value="">No configured senders available</option>}
              {senders.map((sender) => (
                <option key={sender.id || sender.email} value={sender.email}>
                  {sender.name ? `${sender.name} — ` : ''}{sender.email} ({sender.provider === 'zoho' ? 'Zoho' : 'Brevo'})
                </option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Template">
            <select
              className="select-input"
              value={templateId}
              onChange={(event) => applyTemplate(event.target.value)}
              disabled={templatesLoading}
            >
              <option value="">Blank email</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            {templateId && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  const current = templates.find((item) => item.id === templateId);
                  if (current) openEditTemplate(current);
                }}
              >
                <Pencil size={14} /> Edit template
              </button>
            )}
          </FormRow>

          <FormRow label={`Recipients (${selectedClients.length} selected)`}>
            <div className="recipient-filters">
              <select className="select-input" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Source">
                <option value="">All sources</option>
                {sourceOptions.map(([source, count]) => <option key={source} value={source}>{source} ({count})</option>)}
              </select>
              <select className="select-input" value={regionFilter} onChange={(event) => changeRegion(event.target.value)} aria-label="Region">
                <option value="">All regions</option>
                {[...REGION_NAMES, 'Other', UNKNOWN].map((region) => <option key={region} value={region}>{region === UNKNOWN ? 'Unknown location' : region}</option>)}
              </select>
              <select className="select-input" value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)} aria-label="Country">
                <option value="">All countries</option>
                {countryOptions.map(([country, count]) => (
                  <option key={country} value={country}>{country === UNKNOWN ? 'Unknown country' : country} ({count})</option>
                ))}
              </select>
              <input className="select-input" value={cityFilter} onChange={(event) => setCityFilter(event.target.value)} placeholder="City" aria-label="City" />
            </div>
            <input
              className="select-input"
              value={recipientSearch}
              onChange={(event) => setRecipientSearch(event.target.value)}
              placeholder="Search company, contact, country, city or email"
            />
            <div className="recipient-bulk">
              <label className="recipient-hide">
                <input type="checkbox" checked={hideRecent} onChange={(event) => setHideRecent(event.target.checked)} />
                Hide buyers emailed in the last 7 days
              </label>
              <div className="recipient-bulk-actions">
                <span className="cell-muted">{filteredRecipients.length} match · {eligibleInFilter.length} can be added</span>
                <label className="recipient-count">
                  Select
                  <input
                    className="select-input"
                    type="number"
                    min="1"
                    max="500"
                    value={bulkCount}
                    onChange={(event) => setBulkCount(event.target.value)}
                    aria-label="How many to select"
                  />
                </label>
                <button type="button" className="btn btn-secondary btn-sm" onClick={selectFirstN} disabled={!eligibleInFilter.length || !(Number(bulkCount) > 0)}>
                  Add {Math.min(Math.max(1, Math.floor(Number(bulkCount) || 0)), 500, eligibleInFilter.length) || 0}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedClientIds([])} disabled={!selectedClientIds.length}>
                  Clear
                </button>
              </div>
            </div>
            <div className="recipient-list">
              {clientsLoading && <div className="cell-muted" style={{ padding: 12 }}>Loading buyers…</div>}
              {!clientsLoading && !filteredRecipients.length && <div className="cell-muted" style={{ padding: 12 }}>No buyers match these filters.</div>}
              {filteredRecipients.slice(0, RECIPIENT_RENDER_LIMIT).map(({ client, email, location, blockedReason }) => (
                <label key={client.id} className={'recipient-row' + (blockedReason ? ' blocked' : '')}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(client.id)}
                    onChange={() => toggleClient(client.id)}
                    disabled={Boolean(blockedReason) && !selectedSet.has(client.id)}
                  />
                  <span>
                    <span className="cell-strong">{client.company || client.contact || 'Unnamed buyer'}</span>
                    <span className="cell-muted recipient-line">
                      {email || 'No email saved'}
                      {' · '}
                      {location.country === UNKNOWN ? 'Location unknown' : [location.city, location.country].filter(Boolean).join(', ')}
                      {location.inferred && ' (from email)'}
                    </span>
                    <span className={'cell-muted recipient-line' + (blockedReason || recentlyEmailed(client.id) ? ' warn' : '')}>
                      {blockedReason || (lastEmailedByClient.has(client.id)
                        ? `Last emailed ${formatDaysAgo(lastEmailedByClient.get(client.id))}`
                        : 'Never emailed')}
                    </span>
                  </span>
                </label>
              ))}
              {filteredRecipients.length > RECIPIENT_RENDER_LIMIT && (
                <div className="cell-muted" style={{ padding: 10 }}>
                  Showing the first {RECIPIENT_RENDER_LIMIT} of {filteredRecipients.length}. Narrow the filters, or use Select to add them in bulk.
                </div>
              )}
            </div>
          </FormRow>

          <FormRow label="Subject">
            <input
              className="select-input"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject line"
            />
          </FormRow>
          <FormRow label="Message (plain text; leave a blank line between paragraphs)">
            <textarea
              className="select-input"
              rows={9}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={'Dear {{contact}},\n\nThank you for your interest in Kassam Trading Company…\n\nBest regards,\nSultan Ali Paracha'}
            />
          </FormRow>
          {attachment && (
            <div className="card padded" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Paperclip size={16} />
              <span style={{ flex: 1 }}>{attachment.name}</span>
              <button className="btn btn-secondary" onClick={() => setAttachment(null)}>Remove</button>
            </div>
          )}
          <div className="cell-muted" style={{ fontSize: 12 }}>
            Merge tags: <code>{'{{company}}'}</code> <code>{'{{contact}}'}</code> <code>{'{{country}}'}</code> <code>{'{{city}}'}</code>
          </div>

          {selectedClients[0] && (subject || body) && (
            <div className="card padded" style={{ background: 'var(--color-surface-alt)' }}>
              <strong>{renderTemplate(subject, selectedClients[0])}</strong>
              <div
                className="cell-muted"
                style={{ marginTop: 8 }}
                dangerouslySetInnerHTML={{ __html: renderTemplate(textToHtml(body), selectedClients[0]) }}
              />
            </div>
          )}

          {sendResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sendResults.map((result) => (
                <div key={`${result.client}-${result.success}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {result.success
                    ? <CheckCircle2 size={16} color="var(--color-success)" />
                    : <XCircle size={16} color="var(--color-danger)" />}
                  <span>{result.client}{result.error ? ` — ${result.error}` : ''}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={closeCompose}>Close</button>
            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={sending || !senderEmail || !selectedClients.length || !subject.trim() || !body.trim()}
            >
              {sending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
              {sending ? 'Sending…' : `Send to ${selectedClients.length || 0}`}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={templateOpen} onClose={closeTemplateModal} title={editingTemplate ? `Edit template: ${editingTemplate.name}` : 'Add Email Template'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {editingTemplate?.brevo_template_id && (
            <div className="alert alert-info">
              This template was imported from Brevo. "Sync templates" will overwrite changes saved here, so use
              <strong> Save as copy</strong> to keep your version, or edit it in Brevo.
            </div>
          )}
          <FormRow label="Template name">
            <input
              className="select-input"
              value={templateDraft.name}
              onChange={(event) => setTemplateDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Example: New buyer introduction"
            />
          </FormRow>
          <FormRow label="Subject">
            <input
              className="select-input"
              value={templateDraft.subject}
              onChange={(event) => setTemplateDraft((current) => ({ ...current, subject: event.target.value }))}
              placeholder="Export inquiry for {{company}}"
            />
          </FormRow>
          <FormRow label="Message (plain text; leave a blank line between paragraphs)">
            <textarea
              className="select-input"
              rows={10}
              value={templateDraft.body}
              onChange={(event) => setTemplateDraft((current) => ({ ...current, body: event.target.value }))}
              placeholder={'Dear {{contact}},\n\nThank you for your interest in Kassam Trading Company…\n\nBest regards,\nSultan Ali Paracha'}
            />
          </FormRow>
          <FormRow label={editingTemplate ? 'PDF attachment (choose a file to replace, maximum 10 MB)' : 'PDF attachment (optional, maximum 10 MB)'}>
            {editingTemplate?.attachment_name && !templateDraft.pdf && (
              <label className="cell-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Paperclip size={12} /> {editingTemplate.attachment_name}
                <input
                  type="checkbox"
                  checked={templateDraft.removePdf}
                  onChange={(event) => setTemplateDraft((current) => ({ ...current, removePdf: event.target.checked }))}
                />
                Remove
              </label>
            )}
            <input
              className="select-input"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setTemplateDraft((current) => ({
                ...current,
                pdf: event.target.files?.[0] || null,
              }))}
            />
          </FormRow>
          <div className="cell-muted" style={{ fontSize: 12 }}>
            Available merge tags: <code>{'{{company}}'}</code> <code>{'{{contact}}'}</code> <code>{'{{country}}'}</code> <code>{'{{city}}'}</code>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={closeTemplateModal}>Cancel</button>
            {editingTemplate && (
              <button
                className="btn btn-secondary"
                onClick={() => handleSaveTemplateEdit({ asCopy: true })}
                disabled={templateSaving || !templateDraft.name.trim() || !templateDraft.subject.trim() || !templateDraft.body.trim()}
              >
                <Copy size={16} /> Save as copy
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => (editingTemplate ? handleSaveTemplateEdit() : handleCreateTemplate())}
              disabled={templateSaving || !templateDraft.name.trim() || !templateDraft.subject.trim() || !templateDraft.body.trim()}
            >
              {templateSaving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : editingTemplate ? <Save size={16} /> : <Plus size={16} />}
              {editingTemplate ? 'Save changes' : 'Save template'}
            </button>
          </div>
          {!editingTemplate && !!templates.length && (
            <div>
              <h4 style={{ margin: '6px 0' }}>Saved templates</h4>
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="card padded"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}
                >
                  <div style={{ flex: 1 }}>
                    <strong>{template.name}</strong>
                    {template.attachment_name && (
                      <div className="cell-muted"><Paperclip size={12} /> {template.attachment_name}</div>
                    )}
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={() => openEditTemplate(template)}
                    aria-label={`Edit ${template.name}`}
                  >
                    <Pencil size={16} /> Edit
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleDeleteTemplate(template)}
                    aria-label={`Delete ${template.name}`}
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal open={sendersOpen} onClose={() => setSendersOpen(false)} title="Senders & Domains">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card padded" style={{ background: 'var(--color-surface-alt)' }}>
            <strong>NBMT uses Zoho Mail</strong>
            <p className="cell-muted" style={{ margin: '6px 0 0' }}>
              NBMT addresses listed below are connected through Zoho OAuth. Do not add nbmttrading.com
              as a Brevo domain; Zoho does not require Brevo authentication.
            </p>
          </div>

          <div>
            <h4 style={{ marginBottom: 8 }}>Active sender addresses</h4>
            {senders.map((sender) => (
              <div key={sender.id || sender.email} className="card padded" style={{ marginBottom: 8 }}>
                <strong>{sender.name || 'Kassam Trading Company'}</strong>
                <div className="cell-muted">{sender.email} · {sender.provider === 'zoho' ? 'Zoho OAuth' : 'Brevo'}</div>
              </div>
            ))}
            {!senders.length && <div className="cell-muted">No active sender addresses found.</div>}
          </div>

          <div>
            <h4 style={{ marginBottom: 8 }}>Add a Brevo sender (KTC only)</h4>
            <div className="grid-2">
              <FormRow label="Display name">
                <input
                  className="select-input"
                  value={senderDraft.name}
                  onChange={(event) => setSenderDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </FormRow>
              <FormRow label="Email address">
                <input
                  className="select-input"
                  type="email"
                  value={senderDraft.email}
                  onChange={(event) => setSenderDraft((current) => ({ ...current, email: event.target.value }))}
                  placeholder="sales@yourdomain.com"
                />
              </FormRow>
            </div>
            <button
              className="btn btn-secondary"
              style={{ marginTop: 10 }}
              onClick={() => runSenderAction('sender')}
              disabled={managingSender || !senderDraft.email.includes('@')}
            >
              <Plus size={16} /> Add Brevo sender
            </button>
          </div>

          <div>
            <h4 style={{ marginBottom: 8 }}>Brevo domains (KTC only)</h4>
            {domains.map((domain) => {
              const domainName = domain.domain_name || domain.domain || domain.name;
              const ready = domain.authenticated || domain.verified;
              const dnsRecords = Object.values(domain.dns_records || {}).filter(Boolean);
              return (
                <div key={domain.id || domainName} className="card padded" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <strong>{domainName}</strong>
                      <div className="cell-muted">{ready ? 'Authenticated and ready' : 'DNS authentication required'}</div>
                    </div>
                    {!ready && (
                      <button className="btn btn-secondary" onClick={() => runSenderAction(domainName)} disabled={managingSender}>
                        <RefreshCw size={16} /> Check DNS
                      </button>
                    )}
                  </div>
                  {!ready && dnsRecords.length > 0 && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {dnsRecords.map((record) => (
                        <div key={`${record.host_name}-${record.type}`} style={{ fontSize: 12 }}>
                          <strong>{record.type} · {record.host_name}</strong>
                          <code style={{ display: 'block', marginTop: 3, overflowWrap: 'anywhere' }}>{record.value}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                className="select-input"
                value={domainDraft}
                onChange={(event) => setDomainDraft(event.target.value)}
                placeholder="yourdomain.com"
              />
              <button
                className="btn btn-secondary"
                onClick={() => runSenderAction('domain')}
                disabled={managingSender || !domainDraft.includes('.')}
              >
                <Plus size={16} /> Add domain
              </button>
            </div>
            <p className="cell-muted" style={{ fontSize: 12, marginTop: 8 }}>
              Use this only for a domain that should send through Brevo, such as kassamtradingcompany.com.
              NBMT is connected through Zoho and should not be added here.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
