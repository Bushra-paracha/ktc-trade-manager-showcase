import { Boxes, FileCheck2, Globe2, Ship, WalletCards } from 'lucide-react';
import { formatUSD } from '../../data/mockData';
import { summarizeOrderValue } from '../../lib/orderWorkflow';

export default function OrderSummaryCards({ orders = [] }) {
  const activeOrders = orders.filter((order) => !['Delivered', 'Delivered & Closed', 'Closed', 'Cancelled'].includes(order.status));
  const shippingOrders = orders.filter((order) => ['Ready to Ship', 'Shipped', 'In Transit'].includes(order.status));
  const confirmedValue = summarizeOrderValue(orders);
  const countries = new Set(orders.map((order) => order.clients?.country).filter(Boolean));

  const cards = [
    {
      label: 'Confirmed value',
      value: formatUSD(confirmedValue),
      helper: 'Total order book',
      icon: WalletCards,
    },
    {
      label: 'Active orders',
      value: activeOrders.length,
      helper: 'Need operational follow-up',
      icon: Boxes,
    },
    {
      label: 'Shipping queue',
      value: shippingOrders.length,
      helper: 'Ready or already moving',
      icon: Ship,
    },
    {
      label: 'Export markets',
      value: countries.size || '—',
      helper: 'Countries in orders',
      icon: Globe2,
    },
    {
      label: 'Document control',
      value: 'Checklist',
      helper: 'PI, BL, CO, SGS, phytosanitary',
      icon: FileCheck2,
    },
  ];

  return (
    <div className="order-summary-grid">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div className="trade-stat-card" key={card.label}>
            <div className="trade-stat-icon"><Icon size={18} /></div>
            <div>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.helper}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
