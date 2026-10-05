import { ArrowUpRight, ClipboardList, Globe2, Ship, TrendingUp, Users } from 'lucide-react';
import { formatUSD } from '../../data/mockData';

function KpiCard({ icon: Icon, label, value, note, tone = 'green' }) {
  return (
    <div className={`dashboard-kpi dashboard-kpi-${tone}`}>
      <div className="dashboard-kpi-top">
        <div className="dashboard-kpi-icon"><Icon /></div>
        <ArrowUpRight className="dashboard-kpi-arrow" />
      </div>
      <div className="dashboard-kpi-value">{value}</div>
      <div className="dashboard-kpi-label">{label}</div>
      <div className="dashboard-kpi-note">{note}</div>
    </div>
  );
}

export default function KpiGrid({ clients, orders, monthlyRevenue }) {
  const activeOrders = orders.filter((o) => !['Closed', 'Delivered'].includes(o.status)).length;
  const inTransit = orders.filter((o) => (o.shipments || []).some((s) => s.status === 'In Transit')).length;
  const revenue = monthlyRevenue.reduce((sum, m) => sum + m.revenue, 0);
  const countries = new Set(clients.map((client) => client.country).filter(Boolean)).size;
  const newBuyers = clients.filter((client) => client.status === 'New').length;

  return (
    <div className="dashboard-kpi-grid">
      <KpiCard icon={Users} label="Buyers tracked" value={clients.length} note={`${newBuyers} new buyers need attention`} tone="green" />
      <KpiCard icon={ClipboardList} label="Active orders" value={activeOrders} note="Open production and shipment work" tone="gold" />
      <KpiCard icon={TrendingUp} label="Revenue pipeline" value={formatUSD(revenue)} note="Based on current order records" tone="blue" />
      <KpiCard icon={Ship} label="In transit" value={inTransit} note="Shipments currently moving" tone="red" />
      <KpiCard icon={Globe2} label="Countries" value={countries || 22} note="International buyer coverage" tone="teal" />
    </div>
  );
}
