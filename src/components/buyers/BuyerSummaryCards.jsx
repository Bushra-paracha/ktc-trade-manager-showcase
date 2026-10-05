import { Globe2, MailCheck, TrendingUp, Users } from 'lucide-react';

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function countByStatus(clients, statuses) {
  return clients.filter((c) => statuses.includes(c.status)).length;
}

export default function BuyerSummaryCards({ clients = [] }) {
  const countries = unique(clients.map((c) => c.country));
  const hotBuyers = clients.filter((c) => Number(c.score || 0) >= 80).length;
  const activePipeline = countByStatus(clients, ['Engaged', 'Negotiating', 'Won']);
  const withEmail = clients.filter((c) => c.email).length;

  const cards = [
    { label: 'Total Buyers', value: clients.length, note: 'All saved buyer records', icon: Users, tone: 'green' },
    { label: 'Countries', value: countries.length, note: 'International buyer reach', icon: Globe2, tone: 'blue' },
    { label: 'Hot Buyers', value: hotBuyers, note: 'Score 80+ and ready for action', icon: TrendingUp, tone: 'red' },
    { label: 'Reachable Contacts', value: withEmail, note: 'Buyers with email addresses', icon: MailCheck, tone: 'gold' },
    { label: 'Active Pipeline', value: activePipeline, note: 'Engaged, negotiating or won', icon: TrendingUp, tone: 'teal' },
  ];

  return (
    <div className="buyer-summary-grid">
      {cards.map(({ label, value, note, icon: Icon, tone }) => (
        <div className={`buyer-summary-card ${tone}`} key={label}>
          <div className="buyer-summary-top">
            <span>{label}</span>
            <Icon size={18} />
          </div>
          <strong>{value}</strong>
          <p>{note}</p>
        </div>
      ))}
    </div>
  );
}
