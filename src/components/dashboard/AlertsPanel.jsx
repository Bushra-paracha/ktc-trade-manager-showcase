import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AlertsPanel({ inquiries, clients }) {
  const now = new Date();
  const expiringInquiries = inquiries.filter((inquiry) => {
    if (!['Pending Response', 'Quote Sent', 'In Negotiation'].includes(inquiry.status)) return false;
    const created = new Date(inquiry.created_at);
    const expiresAt = new Date(created);
    expiresAt.setDate(expiresAt.getDate() + (inquiry.quote_validity_days || 7));
    const daysLeft = (expiresAt - now) / (1000 * 60 * 60 * 24);
    return daysLeft >= 0 && daysLeft <= 3;
  }).slice(0, 3);

  const dormantClients = clients.filter((client) => {
    if (!client.last_activity) return false;
    const days = (now - new Date(client.last_activity)) / (1000 * 60 * 60 * 24);
    return days >= 60;
  }).slice(0, 3);

  const alerts = [
    ...expiringInquiries.map((inquiry) => ({
      icon: ArrowUpRight,
      title: 'Quote expiring soon',
      body: `${inquiry.clients?.company || 'Unknown buyer'} needs a follow-up within 3 days`,
      to: '/inquiries',
      tone: 'gold',
    })),
    ...dormantClients.map((client) => ({
      icon: ArrowDownRight,
      title: 'Lead going cold',
      body: `${client.company} has no activity in 60+ days`,
      to: '/clients',
      tone: 'red',
    })),
  ];

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Risk alerts</h3>
          <div className="card-header-sub">Quotes and buyers that need attention</div>
        </div>
      </div>
      {alerts.length === 0 ? (
        <div className="dashboard-clear-state">
          <AlertTriangle size={20} />
          <strong>No urgent alerts</strong>
          <span>Everything looks clear right now.</span>
        </div>
      ) : (
        alerts.map(({ icon: Icon, title, body, to, tone }) => (
          <Link className="alert-row" to={to} key={`${title}-${body}`}>
            <div className={`timeline-icon timeline-${tone}`}><Icon /></div>
            <div>
              <strong>{title}</strong>
              <span>{body}</span>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
