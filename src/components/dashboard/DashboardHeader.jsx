import { CalendarDays, Plus, Send, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function DashboardHeader({ firstName }) {
  const todayStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <section className="dashboard-hero">
      <div>
        <div className="dashboard-eyebrow"><CalendarDays size={15} /> {todayStr}</div>
        <h1>Good morning, {firstName}</h1>
        <p>Manage buyers, quotations, orders, and shipments from one clear command center.</p>
      </div>
      <div className="dashboard-hero-actions">
        <Link to="/clients" className="btn btn-primary"><Plus /> New buyer</Link>
        <Link to="/outreach" className="btn btn-secondary"><Send /> Send outreach</Link>
        <Link to="/orders" className="btn btn-secondary"><FileText /> Create order</Link>
      </div>
    </section>
  );
}
