import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import Modal from '../components/Modal';
import { useClients } from '../hooks/useClients';
import { supabase } from '../lib/supabaseClient';
import { daysUntil } from '../lib/dates';

const CATEGORIES = ['All', 'Follow-up', 'Quotation', 'WhatsApp', 'Email', 'Order', 'Documents', 'Amazon', 'Finance', 'Operations', 'Admin', 'General'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = ['Todo', 'In Progress', 'Done'];
const VIEW_MODES = ['Action Center', 'Kanban', 'List'];

const EMPTY_FORM = {
  title: '',
  description: '',
  category: 'Follow-up',
  priority: 'Medium',
  status: 'Todo',
  due_date: '',
};

const priorityStyles = {
  High: { bg: 'var(--tint-red-2)', color: 'var(--text-red)', border: 'var(--border-red)' },
  Medium: { bg: 'var(--tint-amber-2)', color: 'var(--text-amber)', border: 'var(--color-accent-soft)' },
  Low: { bg: 'var(--tint-blue)', color: 'var(--text-blue)', border: 'var(--tint-blue-2)' },
};

const categoryStyles = {
  'Follow-up': 'var(--color-primary)',
  Quotation: 'var(--text-teal)',
  WhatsApp: 'var(--text-green)',
  Email: 'var(--text-blue-2)',
  Order: 'var(--text-violet)',
  Documents: 'var(--text-amber)',
  Amazon: 'var(--text-orange)',
  Finance: 'var(--text-blue)',
  Operations: 'var(--ink-slate-strong)',
  Admin: 'var(--text-violet)',
  General: 'var(--ink-slate-soft)',
};

function isPastDue(task) {
  if (!task?.due_date || task.status === 'Done') return false;
  const due = new Date(`${task.due_date}T23:59:59`);
  return due < new Date();
}

function isDueToday(task) {
  if (!task?.due_date || task.status === 'Done') return false;
  return daysUntil(task.due_date) === 0;
}

function formatDate(dateString) {
  if (!dateString) return 'No due date';
  return new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getProductsText(value) {
  if (Array.isArray(value)) return value.join(', ');
  return value || 'Rice / Salt';
}

function copyText(text) {
  if (navigator?.clipboard) navigator.clipboard.writeText(text);
}

function createWhatsappDraft(client) {
  return `Dear ${client.contact || client.company || 'Buyer'}, this is Bushra from Kassam Trading Company, Karachi. I wanted to follow up regarding your requirement for ${getProductsText(client.products_interest)}. We can offer direct mill pricing from Port Qasim and share FOB/CIF quotation, packing details, and documents. Please let me know your required quantity and destination port.`;
}

function createEmailDraft(client) {
  return `Dear ${client.contact || `${client.company || 'Team'}`},\n\nI hope you are doing well. I am following up from Kassam Trading Company regarding your interest in ${getProductsText(client.products_interest)}. We are a REAP-registered rice miller and exporter based in Karachi, Pakistan, with mills near Port Qasim.\n\nPlease share your required quantity, packing size, destination port, and preferred payment terms so we can prepare an updated quotation for you.\n\nBest regards,\nBushra Paracha\nKassam Trading Company`;
}

function downloadCsv(filename, rows) {
  const headers = ['title', 'category', 'priority', 'status', 'due_date', 'description'];
  const csv = [headers.join(',')]
    .concat(rows.map((row) => headers.map((key) => `"${String(row[key] || '').replaceAll('"', '""')}"`).join(',')))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('All');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('Action Center');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const { clients, loading: clientsLoading } = useClients();

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('status')
      .order('priority')
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false });
    if (!error) setTasks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== 'Done'), [tasks]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const body = [task.title, task.description, task.category, task.priority, task.status].join(' ').toLowerCase();
      if (q && !body.includes(q)) return false;
      if (filterCat !== 'All' && task.category !== filterCat) return false;
      if (filterStatus && task.status !== filterStatus) return false;
      if (filterPriority && task.priority !== filterPriority) return false;
      return true;
    });
  }, [tasks, search, filterCat, filterStatus, filterPriority]);

  const stats = useMemo(() => {
    const overdue = tasks.filter(isPastDue).length;
    const today = tasks.filter(isDueToday).length;
    const high = tasks.filter((task) => task.priority === 'High' && task.status !== 'Done').length;
    const done = tasks.filter((task) => task.status === 'Done').length;
    const followUps = tasks.filter((task) => ['Follow-up', 'WhatsApp', 'Email', 'Quotation'].includes(task.category) && task.status !== 'Done').length;
    return {
      active: activeTasks.length,
      overdue,
      today,
      high,
      done,
      followUps,
      completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    };
  }, [tasks, activeTasks.length]);

  const buyerQueue = useMemo(() => {
    const importantStatuses = ['New', 'Contacted', 'Engaged', 'Negotiating'];
    return [...clients]
      .filter((client) => importantStatuses.includes(client.status || '') || Number(client.score || 0) >= 70)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 6);
  }, [clients]);

  const grouped = useMemo(() => {
    return STATUSES.map((status) => ({ status, tasks: filtered.filter((task) => task.status === status) }));
  }, [filtered]);

  const todayPriorities = useMemo(() => {
    const urgent = activeTasks
      .filter((task) => task.priority === 'High' || isPastDue(task) || isDueToday(task))
      .sort((a, b) => {
        if (isPastDue(a) && !isPastDue(b)) return -1;
        if (!isPastDue(a) && isPastDue(b)) return 1;
        if (a.priority === 'High' && b.priority !== 'High') return -1;
        if (a.priority !== 'High' && b.priority === 'High') return 1;
        return String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
      });
    return urgent.slice(0, 5);
  }, [activeTasks]);

  async function cycleStatus(task) {
    const next = task.status === 'Todo' ? 'In Progress' : task.status === 'In Progress' ? 'Done' : 'Todo';
    await supabase.from('tasks').update({ status: next, updated_at: new Date().toISOString() }).eq('id', task.id);
    setTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, status: next, updated_at: new Date().toISOString() } : item)));
  }

  async function deleteTask(id) {
    if (!window.confirm('Delete this task?')) return;
    await supabase.from('tasks').delete().eq('id', id);
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  function openNew(defaults = {}) {
    setEditTask(null);
    setForm({ ...EMPTY_FORM, ...defaults });
    setModalOpen(true);
  }

  function openEdit(task) {
    setEditTask(task);
    setForm({
      title: task.title || '',
      description: task.description || '',
      category: task.category || 'General',
      priority: task.priority || 'Medium',
      status: task.status || 'Todo',
      due_date: task.due_date || '',
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = { ...form, title: form.title.trim(), updated_at: new Date().toISOString() };
    if (editTask) {
      await supabase.from('tasks').update(payload).eq('id', editTask.id);
      setTasks((prev) => prev.map((task) => (task.id === editTask.id ? { ...task, ...payload } : task)));
    } else {
      const { data } = await supabase.from('tasks').insert([payload]).select().single();
      if (data) setTasks((prev) => [data, ...prev]);
    }
    setSaving(false);
    setModalOpen(false);
  }

  async function createBuyerTask(client, type = 'WhatsApp') {
    const title = type === 'Quotation'
      ? `Send quotation to ${client.company}`
      : `Follow up ${client.company}`;
    const description = type === 'Email' ? createEmailDraft(client) : createWhatsappDraft(client);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase.from('tasks').insert([{
      title,
      description,
      category: type,
      priority: Number(client.score || 0) >= 80 ? 'High' : 'Medium',
      status: 'Todo',
      due_date: tomorrow,
      updated_at: new Date().toISOString(),
    }]).select().single();
    if (data) setTasks((prev) => [data, ...prev]);
  }

  function handleCopy(id, text) {
    copyText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  return (
    <div className="task-command-page">
      <div className="page-header task-hero">
        <div>
          <div className="eyebrow">Operations · Follow-up command center</div>
          <h1>Today’s Work</h1>
          <p>
            Prioritize buyer follow-ups, quotations, WhatsApp messages, export documents, and internal tasks from one place.
          </p>
        </div>
        <div className="task-hero-actions">
          <button className="btn btn-secondary" onClick={fetchTasks}><RefreshCw size={16} /> Refresh</button>
          <button className="btn btn-secondary" onClick={() => downloadCsv('ktc-tasks.csv', filtered)}><Download size={16} /> Export CSV</button>
          <button className="btn btn-primary" onClick={() => openNew()}><Plus size={16} /> New Task</button>
        </div>
      </div>

      <div className="task-metric-grid">
        <MetricCard icon={ClipboardCheck} label="Active tasks" value={stats.active} note={`${stats.completionRate}% completion`} />
        <MetricCard icon={AlertTriangle} label="Overdue" value={stats.overdue} note="Needs attention" tone="danger" />
        <MetricCard icon={CalendarDays} label="Due today" value={stats.today} note="Finish before close" tone="warning" />
        <MetricCard icon={MessageCircle} label="Buyer follow-ups" value={stats.followUps} note="Email / WhatsApp / quotes" tone="success" />
      </div>

      <div className="task-layout-grid">
        <section className="card task-focus-card">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">Priority queue</span>
              <h3>Must-do today</h3>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => openNew({ priority: 'High', category: 'Follow-up' })}>
              <Plus size={14} /> Add priority
            </button>
          </div>
          {todayPriorities.length === 0 ? (
            <EmptyMini icon={CheckCircle2} title="No urgent tasks" text="Your critical queue is clear." />
          ) : (
            <div className="priority-stack">
              {todayPriorities.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  expanded={expandedId === task.id}
                  onToggle={() => cycleStatus(task)}
                  onExpand={() => setExpandedId(expandedId === task.id ? null : task.id)}
                  onEdit={() => openEdit(task)}
                  onDelete={() => deleteTask(task.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="card buyer-queue-card">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">Buyer action center</span>
              <h3>Leads to contact next</h3>
            </div>
            <Users size={18} color="var(--color-ink-faint)" />
          </div>
          {clientsLoading ? (
            <EmptyMini icon={Loader2} title="Loading buyers" text="Checking your CRM list..." spin />
          ) : buyerQueue.length === 0 ? (
            <EmptyMini icon={Users} title="No buyer queue" text="High-value buyers will appear here." />
          ) : (
            <div className="buyer-followup-list">
              {buyerQueue.map((client) => (
                <div className="buyer-followup-card" key={client.id}>
                  <div className="buyer-followup-main">
                    <div className="avatar-mini">{String(client.company || 'K').slice(0, 1).toUpperCase()}</div>
                    <div>
                      <strong>{client.company}</strong>
                      <p>{client.country || 'Unknown market'} · Score {client.score || 0} · {getProductsText(client.products_interest)}</p>
                    </div>
                  </div>
                  <div className="buyer-followup-actions">
                    <button className="icon-text-btn" onClick={() => createBuyerTask(client, 'WhatsApp')}><MessageCircle size={14} /> Task</button>
                    <button className="icon-text-btn" onClick={() => handleCopy(`wa-${client.id}`, createWhatsappDraft(client))}><Copy size={14} /> {copiedId === `wa-${client.id}` ? 'Copied' : 'WhatsApp'}</button>
                    <button className="icon-text-btn" onClick={() => handleCopy(`em-${client.id}`, createEmailDraft(client))}><Mail size={14} /> {copiedId === `em-${client.id}` ? 'Copied' : 'Email'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card task-board-card">
        <div className="task-toolbar-row">
          <div>
            <span className="eyebrow">Task board</span>
            <h3>All work items</h3>
          </div>
          <div className="task-view-toggle">
            {VIEW_MODES.map((mode) => (
              <button key={mode} className={viewMode === mode ? 'active' : ''} onClick={() => setViewMode(mode)}>{mode}</button>
            ))}
          </div>
        </div>

        <div className="task-filters">
          <div className="search-box task-search-box">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task, buyer, quote, document..." />
          </div>
          <select className="select-input" value={filterCat} onChange={(event) => setFilterCat(event.target.value)}>
            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select className="select-input" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
            <option value="">All Statuses</option>
            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select className="select-input" value={filterPriority} onChange={(event) => setFilterPriority(event.target.value)}>
            <option value="">All Priorities</option>
            {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading-state"><Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} /> Loading tasks...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state refined-empty"><Sparkles size={34} /><h3>No tasks found</h3><p>Create a follow-up, quotation, shipment, or document task to keep the export workflow moving.</p></div>
        ) : viewMode === 'Kanban' || viewMode === 'Action Center' ? (
          <div className="task-kanban-grid">
            {grouped.map(({ status, tasks: columnTasks }) => (
              <div className="task-column" key={status}>
                <div className="task-column-head">
                  <StatusIcon status={status} />
                  <span>{status}</span>
                  <small>{columnTasks.length}</small>
                </div>
                <div className="task-column-body">
                  {columnTasks.length === 0 ? (
                    <div className="task-column-empty">No tasks</div>
                  ) : columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      expanded={expandedId === task.id}
                      onToggle={() => cycleStatus(task)}
                      onExpand={() => setExpandedId(expandedId === task.id ? null : task.id)}
                      onEdit={() => openEdit(task)}
                      onDelete={() => deleteTask(task.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="priority-stack">
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                expanded={expandedId === task.id}
                onToggle={() => cycleStatus(task)}
                onExpand={() => setExpandedId(expandedId === task.id ? null : task.id)}
                onEdit={() => openEdit(task)}
                onDelete={() => deleteTask(task.id)}
              />
            ))}
          </div>
        )}
      </section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTask ? 'Edit Task' : 'New Task'}>
        <div className="task-modal-form">
          <FormRow label="Title *">
            <input className="select-input" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="e.g. Send quotation to Haid Group China" autoFocus />
          </FormRow>
          <FormRow label="Details / draft message">
            <textarea className="select-input" rows={6} value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Add next steps, buyer requirements, quote details, or follow-up message..." />
          </FormRow>
          <div className="task-modal-grid">
            <FormRow label="Category">
              <select className="select-input" value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>
                {CATEGORIES.filter((category) => category !== 'All').map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </FormRow>
            <FormRow label="Priority">
              <select className="select-input" value={form.priority} onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}>
                {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </FormRow>
            <FormRow label="Status">
              <select className="select-input" value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </FormRow>
            <FormRow label="Due Date">
              <input type="date" className="select-input" value={form.due_date} onChange={(event) => setForm((prev) => ({ ...prev, due_date: event.target.value }))} />
            </FormRow>
          </div>
          <div className="task-modal-actions">
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.title.trim()}>{saving ? 'Saving...' : editTask ? 'Save Changes' : 'Add Task'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, note, tone = 'default' }) {
  return (
    <div className={`task-metric-card ${tone}`}>
      <div className="task-metric-icon"><Icon size={18} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === 'Done') return <CheckCircle2 size={17} color="var(--color-primary)" />;
  if (status === 'In Progress') return <Clock3 size={17} color="var(--text-amber)" />;
  return <Circle size={17} color="var(--color-ink-faint)" />;
}

function PriorityBadge({ priority }) {
  const style = priorityStyles[priority] || priorityStyles.Medium;
  return <span className="priority-badge" style={{ background: style.bg, color: style.color, borderColor: style.border }}>{priority}</span>;
}

function CategoryBadge({ category }) {
  return <span className="category-badge" style={{ color: categoryStyles[category] || 'var(--ink-slate-soft)' }}>{category || 'General'}</span>;
}

function TaskCard({ task, expanded, onToggle, onExpand, onEdit, onDelete }) {
  return (
    <article className={`task-card ${isPastDue(task) ? 'is-overdue' : ''} ${task.status === 'Done' ? 'is-done' : ''}`}>
      <div className="task-card-top">
        <button className="icon-btn" onClick={onToggle} title="Move status"><StatusIcon status={task.status} /></button>
        <button className="task-title-btn" onClick={onExpand}>{task.title}</button>
      </div>
      <div className="task-card-meta">
        <PriorityBadge priority={task.priority} />
        <CategoryBadge category={task.category} />
      </div>
      <div className={`task-due ${isPastDue(task) ? 'danger' : isDueToday(task) ? 'warning' : ''}`}>
        <CalendarDays size={13} /> {isPastDue(task) ? 'Overdue · ' : isDueToday(task) ? 'Today · ' : ''}{formatDate(task.due_date)}
      </div>
      {expanded && task.description && <p className="task-description">{task.description}</p>}
      <div className="task-card-actions">
        {task.description && <button onClick={onExpand}>{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {expanded ? 'Hide' : 'Details'}</button>}
        <button onClick={onEdit}>Edit</button>
        <button onClick={onDelete} className="danger-link"><Trash2 size={13} /> Delete</button>
      </div>
    </article>
  );
}

function TaskRow({ task, expanded, onToggle, onExpand, onEdit, onDelete }) {
  return (
    <article className={`task-row ${isPastDue(task) ? 'is-overdue' : ''} ${task.status === 'Done' ? 'is-done' : ''}`}>
      <button className="icon-btn" onClick={onToggle}><StatusIcon status={task.status} /></button>
      <div className="task-row-body">
        <div className="task-row-titleline">
          <button onClick={onExpand}>{task.title}</button>
          <PriorityBadge priority={task.priority} />
          <CategoryBadge category={task.category} />
          <span className={`task-due ${isPastDue(task) ? 'danger' : isDueToday(task) ? 'warning' : ''}`}><CalendarDays size={13} /> {formatDate(task.due_date)}</span>
        </div>
        {expanded && task.description && <p className="task-description">{task.description}</p>}
      </div>
      <div className="task-row-actions">
        <button className="icon-text-btn" onClick={onEdit}>Edit</button>
        <button className="icon-text-btn danger-link" onClick={onDelete}><Trash2 size={13} /> Delete</button>
      </div>
    </article>
  );
}

function EmptyMini({ icon: Icon, title, text, spin = false }) {
  return (
    <div className="empty-mini">
      <Icon size={22} style={spin ? { animation: 'spin 1s linear infinite' } : undefined} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function FormRow({ label, children }) {
  return <label className="form-row-label">{label}{children}</label>;
}
