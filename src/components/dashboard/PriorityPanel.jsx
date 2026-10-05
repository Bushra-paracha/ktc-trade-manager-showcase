import { CheckCircle2, Circle, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function PriorityPanel({ inquiries, clients, orders }) {
  const hotInquiries = inquiries
    .filter((inquiry) => ['Pending Response', 'Quote Sent', 'In Negotiation'].includes(inquiry.status))
    .slice(0, 3);
  const newClients = clients.filter((client) => client.status === 'New').slice(0, 2);
  const readyOrders = orders.filter((order) => order.status === 'Ready to Ship').slice(0, 2);

  const priorities = [
    ...hotInquiries.map((item) => ({
      title: `Follow up ${item.clients?.company || item.buyer_name || 'new inquiry'}`,
      meta: item.product || item.status || 'Open inquiry',
      to: '/inquiries',
      type: 'Quote',
    })),
    ...newClients.map((item) => ({
      title: `Qualify ${item.company}`,
      meta: [item.country, item.email].filter(Boolean).join(' · ') || 'New buyer',
      to: '/clients',
      type: 'Buyer',
    })),
    ...readyOrders.map((item) => ({
      title: `Prepare shipment for ${item.clients?.company || item.buyer_name || 'order'}`,
      meta: item.status,
      to: '/orders',
      type: 'Order',
    })),
  ].slice(0, 6);

  const fallback = [
    { title: 'Follow up Haid Group China', meta: '10,000 MT/month broken rice negotiation', to: '/clients', type: 'Buyer' },
    { title: 'Prepare Amazon salt pack requirements', meta: 'USA and UK retail packs', to: '/amazon', type: 'Amazon' },
    { title: 'Review Malaysia confirmed order documents', meta: 'Zenline Consolidated · USD 18,088', to: '/orders', type: 'Order' },
  ];

  const list = priorities.length ? priorities : fallback;

  return (
    <div className="card dashboard-card-full">
      <div className="card-header">
        <div>
          <h3>Today’s priorities</h3>
          <div className="card-header-sub">The highest-value work to complete first</div>
        </div>
        <Link to="/tasks" className="btn btn-ghost btn-sm">View tasks</Link>
      </div>
      <div className="priority-list">
        {list.map((task, index) => (
          <Link to={task.to} className="priority-item" key={`${task.title}-${index}`}>
            <div className="priority-check">{index === 0 ? <Clock3 /> : <Circle />}</div>
            <div>
              <strong>{task.title}</strong>
              <span>{task.meta}</span>
            </div>
            <em>{task.type}</em>
          </Link>
        ))}
      </div>
      <div className="priority-footer"><CheckCircle2 size={15} /> Keep follow-ups inside buyer profiles so nothing gets lost.</div>
    </div>
  );
}
