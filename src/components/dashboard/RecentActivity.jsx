import { Mail, ShoppingBag, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';

function dateLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RecentActivity({ messages, orders, clients }) {
  const emailItems = messages.slice(0, 3).map((message) => ({
    icon: Mail,
    title: message.clients?.company || message.to_email,
    body: `${message.subject || 'Email'} · ${message.status || 'Sent'}`,
    time: dateLabel(message.sent_at),
    tone: 'blue',
  }));

  const orderItems = orders.slice(0, 2).map((order) => ({
    icon: ShoppingBag,
    title: order.clients?.company || order.buyer_name || 'Order',
    body: order.status || 'Order updated',
    time: dateLabel(order.created_at),
    tone: 'green',
  }));

  const clientItems = clients.slice(0, 2).map((client) => ({
    icon: UserPlus,
    title: client.company,
    body: [client.country, client.status].filter(Boolean).join(' · ') || 'Buyer added',
    time: dateLabel(client.created_at || client.last_activity),
    tone: 'gold',
  }));

  const activity = [...emailItems, ...orderItems, ...clientItems].slice(0, 6);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Recent activity</h3>
          <div className="card-header-sub">Latest buyer and order movement</div>
        </div>
        <Link to="/outreach" className="btn btn-ghost btn-sm">View outreach</Link>
      </div>
      {activity.length === 0 ? (
        <div className="empty-state" style={{ padding: '28px 12px' }}><p>No recent activity yet.</p></div>
      ) : (
        activity.map(({ icon: Icon, title, body, time, tone }) => (
          <div className="timeline-item" key={`${title}-${body}-${time}`}>
            <div className={`timeline-icon timeline-${tone}`}><Icon /></div>
            <div className="timeline-body" style={{ flex: 1 }}>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
            <div className="timeline-time">{time}</div>
          </div>
        ))
      )}
    </div>
  );
}
