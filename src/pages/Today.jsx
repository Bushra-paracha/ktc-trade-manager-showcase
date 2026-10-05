import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Boxes,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  PackageCheck,
  Paperclip,
  Phone,
  RefreshCw,
  Ship,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToday, SHIPMENT_WINDOW_DAYS } from '../hooks/useToday';
import { formatDate, timeAgo } from '../lib/dates';
import { ORDER_STAGES, getNextStage, getStageIndex, normalizeStatus } from '../lib/orderWorkflow';
import { supabase } from '../lib/supabaseClient';
import OrderStatusSheet from '../components/today/OrderStatusSheet';
import FollowUpSheet from '../components/today/FollowUpSheet';
import MessageReviewSheet from '../components/today/MessageReviewSheet';

const KARACHI = 'Asia/Karachi';

const FLAG_LABELS = {
  risky_attachment: 'Risky attachment. Do not open it.',
  known_impersonator: 'Known impersonator.',
  brand_impersonation: 'Claims to be a shipping company from an unofficial address.',
  payment_or_login: 'Mentions bank details, payment or a login.',
  payment_or_link: 'Mentions bank details or contains a link.',
  shared_email: 'This address is shared by several buyers.',
  shared_number: 'This number is shared by several buyers.',
  attachment: 'Contains a file.',
};

function replyDueLabel(value) {
  if (!value) return null;
  const hours = (new Date(value) - Date.now()) / 3600000;
  if (hours < 0) {
    const late = -hours;
    return { text: `Reply overdue by ${late < 24 ? `${Math.max(1, Math.round(late))}h` : `${Math.round(late / 24)} days`}`, late: true };
  }
  if (hours < 24) return { text: `Reply due by ${new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`, late: false };
  return { text: `Reply due ${new Date(value).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`, late: false };
}

function greeting(date) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function ContactButtons({ phone, email }) {
  const number = digits(phone);
  if (!number && !email) return <p className="today-muted">No phone or email saved.</p>;
  return (
    <div className="today-contact-row">
      {number && (
        <a className="today-btn today-btn-whatsapp" href={`https://wa.me/${number}`} target="_blank" rel="noreferrer">
          <MessageCircle size={20} /> WhatsApp
        </a>
      )}
      {number && (
        <a className="today-btn today-btn-secondary" href={`tel:+${number}`}>
          <Phone size={20} /> Call
        </a>
      )}
      {email && (
        <a className="today-btn today-btn-secondary" href={`mailto:${email}`}>
          <Mail size={20} /> Email
        </a>
      )}
    </div>
  );
}

function Section({ id, icon: Icon, title, count, emptyText, children }) {
  return (
    <section className="today-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="today-section-title">
        <Icon size={22} aria-hidden="true" />
        {title}
        <span className={'today-count' + (count ? ' has-items' : '')}>{count}</span>
      </h2>
      {count === 0 ? (
        <div className="today-empty"><CheckCircle2 size={20} aria-hidden="true" /> {emptyText}</div>
      ) : (
        children
      )}
    </section>
  );
}

function StageBar({ status }) {
  const index = getStageIndex(status);
  return (
    <div className="today-stage-bar" aria-label={`Stage ${index + 1} of ${ORDER_STAGES.length}`}>
      {ORDER_STAGES.map((stage, i) => (
        <span key={stage.label} className={i <= index ? 'done' : ''} />
      ))}
    </div>
  );
}

function OrderCard({ order, stale, onUpdate }) {
  const current = normalizeStatus(order.status);
  const next = getNextStage(order.status);
  const products = (order.order_items || [])
    .map((item) => `${item.product_name}${item.quantity_mt ? ` · ${item.quantity_mt} MT` : ''}`)
    .join(', ');

  return (
    <article className={'today-card' + (stale ? ' attention' : '')}>
      <div className="today-card-head">
        <div>
          <strong className="today-card-title">{order.clients?.company || 'Unknown buyer'}</strong>
          <span className="today-card-sub">{order.id}{order.clients?.country ? ` · ${order.clients.country}` : ''}</span>
        </div>
        <Link to={`/orders/${order.id}`} className="today-open-link" aria-label={`Open ${order.id}`}>
          Open <ChevronRight size={18} />
        </Link>
      </div>
      {products && <p className="today-card-line">{products}</p>}
      <p className="today-card-stage">Now: <strong>{current}</strong></p>
      <StageBar status={order.status} />
      <p className={'today-card-meta' + (stale ? ' warn' : '')}>
        {order.daysSinceUpdate === 0 ? 'Updated today' : `No update for ${order.daysSinceUpdate} days`}
      </p>
      <div className="today-action-stack">
        {next && (
          <button type="button" className="today-btn today-btn-primary" onClick={() => onUpdate(order, next.label)}>
            Move to: {next.label}
          </button>
        )}
        <div className="today-action-pair">
          <button type="button" className="today-btn today-btn-secondary" onClick={() => onUpdate(order, current)}>
            Still {current}
          </button>
          <button type="button" className="today-btn today-btn-secondary" onClick={() => onUpdate(order, null)}>
            Other stage…
          </button>
        </div>
      </div>
    </article>
  );
}

export default function Today() {
  const { profile, user } = useAuth();
  const { newInquiries, messages, followUps, staleOrders, otherOrders, shipments, dueTasks, lowStock, loading, error, refresh } = useToday();
  const now = useClock();
  const [statusTarget, setStatusTarget] = useState(null); // { order, initialStatus }
  const [followUpTarget, setFollowUpTarget] = useState(null); // { client, replying }
  const [reviewMessage, setReviewMessage] = useState(null);
  const [dismissing, setDismissing] = useState(null);
  const [notice, setNotice] = useState('');
  const [taskBusy, setTaskBusy] = useState(null);

  const firstName = (profile?.full_name || user?.email || '').split(' ')[0].split('@')[0];
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const karachiTime = now.toLocaleTimeString(undefined, { timeZone: KARACHI, hour: 'numeric', minute: '2-digit' });
  const localTime = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  function done(message) {
    setStatusTarget(null);
    setFollowUpTarget(null);
    setReviewMessage(null);
    setNotice(message);
    refresh();
  }

  async function taskAction(task, action) {
    setTaskBusy(task.id);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    const { error: rpcError } = action === 'done'
      ? await supabase.rpc('complete_task', { p_task_id: task.id })
      : await supabase.rpc('reschedule_task', {
        p_task_id: task.id,
        p_due_date: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`,
      });
    setTaskBusy(null);
    if (rpcError) return setNotice(`Couldn't update the task: ${rpcError.message}`);
    done(action === 'done' ? `Done: ${task.title}` : `Moved to tomorrow: ${task.title}`);
  }

  async function dismiss(message) {
    if (!window.confirm('Mark this as not an inquiry? It will leave this list.')) return;
    setDismissing(message.key);
    const { error: rpcError } = await supabase.rpc('dismiss_message', { p_source: message.source, p_message_id: message.id });
    setDismissing(null);
    if (rpcError) return setNotice(`Couldn't update the message: ${rpcError.message}`);
    done('Message set aside.');
  }

  const total = newInquiries.length + messages.length + followUps.length + staleOrders.length + shipments.length + dueTasks.length + lowStock.length;

  return (
    <div className="today-page">
      <header className="today-header">
        <h1>{greeting(now)}{firstName ? `, ${firstName}` : ''}</h1>
        <p>
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          {deviceZone !== KARACHI ? ` · ${localTime} here, ${karachiTime} in Karachi` : ` · ${karachiTime}`}
        </p>
        {!loading && !error && (
          <p className="today-summary">
            {total === 0 ? 'Nothing needs your attention right now.' : `${total} ${total === 1 ? 'thing needs' : 'things need'} your attention.`}
          </p>
        )}
      </header>

      {notice && (
        <div className="today-notice" role="status">
          <CheckCircle2 size={20} aria-hidden="true" />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button>
        </div>
      )}

      {loading ? (
        <div className="today-loading" role="status"><Loader2 className="spin" size={28} /> Loading…</div>
      ) : error ? (
        <div className="today-error" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <p>Couldn't load today's list. Check your connection and try again.</p>
          <small>{error}</small>
          <button type="button" className="today-btn today-btn-primary" onClick={refresh}>
            <RefreshCw size={20} /> Try again
          </button>
        </div>
      ) : (
        <>
          <Section id="today-orders" icon={PackageCheck} title="Orders to update" count={staleOrders.length}
            emptyText="Every order has been updated this week.">
            {staleOrders.map((order) => (
              <OrderCard key={order.id} order={order} stale onUpdate={(o, s) => setStatusTarget({ order: o, initialStatus: s })} />
            ))}
          </Section>

          <Section id="today-inquiries" icon={Inbox} title="New inquiries" count={newInquiries.length}
            emptyText="No new inquiries.">
            {newInquiries.map((item) => (
              <article className="today-card" key={item.key}>
                <div className="today-card-head">
                  <div>
                    <strong className="today-card-title">{item.name}</strong>
                    <span className="today-card-sub">
                      {[item.person, item.country].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <Link to={item.link} className="today-open-link">Open <ChevronRight size={18} /></Link>
                </div>
                {(item.products || item.quantity) && (
                  <p className="today-card-line">
                    {[item.products, item.quantity && (typeof item.quantity === 'number' ? `${item.quantity} MT` : item.quantity)].filter(Boolean).join(' · ')}
                  </p>
                )}
                {item.message && <p className="today-card-quote">“{item.message}”</p>}
                <p className="today-card-meta">{item.source} · received {timeAgo(item.receivedAt)}</p>
                {replyDueLabel(item.replyDueAt) && (
                  <p className={'today-card-meta' + (replyDueLabel(item.replyDueAt).late ? ' warn' : '')}>
                    {replyDueLabel(item.replyDueAt).text}
                  </p>
                )}
                <ContactButtons phone={item.phone} email={item.email} />
                {item.client && (
                  <button type="button" className="today-btn today-btn-primary" onClick={() => setFollowUpTarget({ client: item.client, replying: true })}>
                    <CheckCircle2 size={20} /> I've replied
                  </button>
                )}
              </article>
            ))}
          </Section>

          <Section id="today-messages" icon={ShieldAlert} title="Messages to check" count={messages.length}
            emptyText="No unknown senders waiting.">
            <p className="today-section-note">
              From senders not in the CRM, or with warning signs. Don't open attachments or send bank details until you're sure who it is.
            </p>
            {messages.map((message) => (
              <article className={'today-card' + (message.flags.length ? ' danger' : '')} key={message.key}>
                <div className="today-card-head">
                  <div>
                    <strong className="today-card-title">{message.title || message.from}</strong>
                    <span className="today-card-sub">{message.title ? `${message.from} · ` : ''}{message.source === 'email' ? `to ${message.to}` : 'WhatsApp'}</span>
                  </div>
                </div>
                {message.body && <p className="today-card-quote">“{message.body.slice(0, 280)}{message.body.length > 280 ? '…' : ''}”</p>}
                {message.attachments.length > 0 && (
                  <p className="today-card-meta"><Paperclip size={15} aria-hidden="true" /> {message.attachments.join(', ')}</p>
                )}
                {message.flags.length > 0 ? (
                  <ul className="today-flag-list">
                    {message.flags.map((flag) => <li key={flag}><AlertTriangle size={16} aria-hidden="true" /> {FLAG_LABELS[flag] || flag}</li>)}
                  </ul>
                ) : (
                  <p className="today-card-meta">Not in the CRM yet.</p>
                )}
                <p className="today-card-meta">Received {timeAgo(message.receivedAt)}</p>
                <div className="today-action-pair">
                  <button type="button" className="today-btn today-btn-primary" onClick={() => setReviewMessage(message)}>
                    It's an inquiry
                  </button>
                  <button type="button" className="today-btn today-btn-secondary" disabled={dismissing === message.key} onClick={() => dismiss(message)}>
                    Not an inquiry
                  </button>
                </div>
              </article>
            ))}
          </Section>

          <Section id="today-followups" icon={CalendarCheck} title="Buyers to follow up" count={followUps.length}
            emptyText="No buyers are waiting on a follow-up.">
            {followUps.map(({ client, reason, dueAt }) => (
              <article className="today-card" key={client.id}>
                <div className="today-card-head">
                  <div>
                    <strong className="today-card-title">{client.company}</strong>
                    <span className="today-card-sub">{[client.contact, client.country].filter(Boolean).join(' · ')}</span>
                  </div>
                  <Link to={`/clients/${client.id}`} className="today-open-link">Open <ChevronRight size={18} /></Link>
                </div>
                <p className="today-card-meta warn">{reason}</p>
                {replyDueLabel(dueAt) && (
                  <p className={'today-card-meta' + (replyDueLabel(dueAt).late ? ' warn' : '')}>{replyDueLabel(dueAt).text}</p>
                )}
                <p className="today-card-meta">
                  Last contact: {client.last_contacted_at ? timeAgo(client.last_contacted_at) : 'never'}
                </p>
                <ContactButtons phone={client.whatsapp_number || client.phone} email={client.email} />
                <button type="button" className="today-btn today-btn-primary" onClick={() => setFollowUpTarget({ client, replying: Boolean(dueAt) })}>
                  <CheckCircle2 size={20} /> {dueAt ? "I've replied" : "I've followed up"}
                </button>
              </article>
            ))}
          </Section>

          <Section id="today-shipments" icon={Ship} title="Shipments coming up" count={shipments.length}
            emptyText={`Nothing due in the next ${SHIPMENT_WINDOW_DAYS} days.`}>
            {shipments.map((item) => (
              <article className={'today-card compact' + (item.days < 0 ? ' attention' : '')} key={`${item.order.id}-${item.label}-${item.date}`}>
                <div className="today-card-head">
                  <div>
                    <strong className="today-card-title">{item.label}: {formatDate(item.date, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                    <span className="today-card-sub">{item.order.clients?.company || 'Unknown buyer'} · {item.order.id}</span>
                  </div>
                  <Link to={`/orders/${item.order.id}`} className="today-open-link">Open <ChevronRight size={18} /></Link>
                </div>
                <p className={'today-card-meta' + (item.days < 0 ? ' warn' : '')}>
                  {item.days < 0 ? `${-item.days} days overdue` : item.days === 0 ? 'Today' : `In ${item.days} days`}
                  {' · '}Now: {normalizeStatus(item.order.status)}
                </p>
              </article>
            ))}
          </Section>

          {lowStock.length > 0 && (
            <Section id="today-stock" icon={Boxes} title="Stock running low" count={lowStock.length} emptyText="">
              {lowStock.map((p) => (
                <article className="today-card compact attention" key={p.product_id}>
                  <strong className="today-card-title">{p.name}</strong>
                  <p className="today-card-meta warn">
                    {Number(p.available_mt).toLocaleString(undefined, { maximumFractionDigits: 1 })} MT available
                    {Number(p.reserved_mt) > 0 ? ` after ${Number(p.reserved_mt).toLocaleString()} MT reserved for open orders` : ''}
                    {' '}(warning below {Number(p.low_stock_mt).toLocaleString()} MT)
                  </p>
                  <Link to="/inventory" className="today-open-link" style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>Open inventory <ChevronRight size={18} /></Link>
                </article>
              ))}
            </Section>
          )}

          {dueTasks.length > 0 && (
            <Section id="today-tasks" icon={CheckCircle2} title="Tasks due" count={dueTasks.length} emptyText="">
              {dueTasks.map((task) => (
                <article className="today-card compact" key={task.id}>
                  <strong className="today-card-title">{task.title}</strong>
                  <p className="today-card-meta warn">Due {formatDate(task.due_date, { day: 'numeric', month: 'short' })}</p>
                  <div className="today-action-pair">
                    <button type="button" className="today-btn today-btn-primary" disabled={taskBusy === task.id} onClick={() => taskAction(task, 'done')}>
                      Done
                    </button>
                    <button type="button" className="today-btn today-btn-secondary" disabled={taskBusy === task.id} onClick={() => taskAction(task, 'tomorrow')}>
                      Tomorrow
                    </button>
                  </div>
                </article>
              ))}
            </Section>
          )}

          {otherOrders.length > 0 && (
            <section className="today-section" aria-labelledby="today-other-title">
              <h2 id="today-other-title" className="today-section-title">
                <PackageCheck size={22} aria-hidden="true" /> Other open orders
              </h2>
              {otherOrders.map((order) => (
                <OrderCard key={order.id} order={order} onUpdate={(o, s) => setStatusTarget({ order: o, initialStatus: s })} />
              ))}
            </section>
          )}
        </>
      )}

      {statusTarget && (
        <OrderStatusSheet
          key={`${statusTarget.order.id}-${statusTarget.initialStatus || 'pick'}`}
          order={statusTarget.order}
          initialStatus={statusTarget.initialStatus}
          onClose={() => setStatusTarget(null)}
          onSaved={done}
        />
      )}
      {followUpTarget && (
        <FollowUpSheet
          key={followUpTarget.client.id}
          client={followUpTarget.client}
          replying={followUpTarget.replying}
          onClose={() => setFollowUpTarget(null)}
          onSaved={done}
        />
      )}
      {reviewMessage && (
        <MessageReviewSheet
          key={reviewMessage.key}
          message={reviewMessage}
          onClose={() => setReviewMessage(null)}
          onSaved={done}
        />
      )}
    </div>
  );
}
