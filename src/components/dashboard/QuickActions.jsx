import { ClipboardList, FileQuestion, Mail, Package, ShoppingCart, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

const actions = [
  { to: '/clients', icon: Users, label: 'Add buyer', note: 'Create or update buyer profile' },
  { to: '/inquiries', icon: FileQuestion, label: 'Review inquiries', note: 'Convert requests into quotes' },
  { to: '/outreach', icon: Mail, label: 'Send campaign', note: 'Follow up rice and salt buyers' },
  { to: '/orders', icon: ClipboardList, label: 'Track orders', note: 'Production, shipment, delivery' },
  { to: '/products', icon: Package, label: 'Update prices', note: 'FOB Port Qasim product list' },
  { to: '/amazon', icon: ShoppingCart, label: 'Amazon salt packs', note: 'USA/UK retail launch' },
];

export default function QuickActions() {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Quick actions</h3>
          <div className="card-header-sub">Common workflows for KTC export operations</div>
        </div>
      </div>
      <div className="quick-action-grid">
        {actions.map(({ to, icon: Icon, label, note }) => (
          <Link to={to} className="quick-action" key={label}>
            <div><Icon /></div>
            <strong>{label}</strong>
            <span>{note}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
