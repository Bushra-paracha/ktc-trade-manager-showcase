import { ArrowRight, CheckCircle2, Mail, MessageCircle, PackageCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import LeadScoreBadge from './LeadScoreBadge';

function sortByScore(clients) {
  return [...clients].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

export default function BuyerActionCenter({ clients = [] }) {
  const hot = sortByScore(clients).filter((c) => Number(c.score || 0) >= 70).slice(0, 5);
  const missingEmail = clients.filter((c) => !c.email).slice(0, 4);
  const negotiating = clients.filter((c) => ['Engaged', 'Negotiating'].includes(c.status)).slice(0, 4);

  return (
    <aside className="buyer-action-center">
      <div className="card buyer-next-card">
        <div className="card-header">
          <div>
            <h3>Buyer Action Center</h3>
            <div className="card-header-sub">The fastest way to move leads forward today.</div>
          </div>
        </div>

        <div className="buyer-action-list">
          <ActionItem icon={Mail} title="Send follow-ups" note={`${hot.length} high-priority buyers need attention`} />
          <ActionItem icon={MessageCircle} title="Use WhatsApp" note="Call or message buyers with phone numbers" />
          <ActionItem icon={PackageCheck} title="Prepare quotes" note={`${negotiating.length} buyers are in active discussion`} />
        </div>
      </div>

      <div className="card buyer-next-card">
        <div className="card-header"><h3>Hot Buyers</h3></div>
        {hot.length === 0 ? <p className="buyer-muted">No hot buyers yet.</p> : hot.map((buyer) => (
          <Link className="buyer-mini-row" to={`/clients/${buyer.id}`} key={buyer.id}>
            <div>
              <strong>{buyer.company || 'Unnamed buyer'}</strong>
              <span>{buyer.country || 'Unknown country'} · {buyer.products_interest?.[0] || 'Product TBD'}</span>
            </div>
            <LeadScoreBadge score={buyer.score} />
          </Link>
        ))}
      </div>

      <div className="card buyer-next-card">
        <div className="card-header"><h3>Clean-up Needed</h3></div>
        {missingEmail.length === 0 ? (
          <div className="buyer-clean-ok"><CheckCircle2 size={18} /> All recent records have emails.</div>
        ) : missingEmail.map((buyer) => (
          <Link className="buyer-mini-row compact" to={`/clients/${buyer.id}`} key={buyer.id}>
            <div>
              <strong>{buyer.company || 'Unnamed buyer'}</strong>
              <span>Missing email · {buyer.country || 'Unknown country'}</span>
            </div>
            <ArrowRight size={16} />
          </Link>
        ))}
      </div>
    </aside>
  );
}

function ActionItem({ icon: Icon, title, note }) {
  return (
    <div className="buyer-action-item">
      <div className="buyer-action-icon"><Icon size={17} /></div>
      <div>
        <strong>{title}</strong>
        <span>{note}</span>
      </div>
    </div>
  );
}
