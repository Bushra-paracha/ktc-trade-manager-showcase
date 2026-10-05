import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useClients } from '../hooks/useClients';
import { useOrders } from '../hooks/useOrders';
import { useInquiries } from '../hooks/useInquiries';
import { useAnalytics } from '../hooks/useAnalytics';
import { useEmailMessages } from '../hooks/useOutreach';
import AlertsPanel from '../components/dashboard/AlertsPanel';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import KpiGrid from '../components/dashboard/KpiGrid';
import PipelineOverview from '../components/dashboard/PipelineOverview';
import PriorityPanel from '../components/dashboard/PriorityPanel';
import QuickActions from '../components/dashboard/QuickActions';
import RecentActivity from '../components/dashboard/RecentActivity';

export default function Dashboard() {
  const { profile, user } = useAuth();
  const { clients, loading: clientsLoading, error: clientsError } = useClients();
  const { orders, loading: ordersLoading, error: ordersError } = useOrders();
  const { inquiries, loading: inquiriesLoading, error: inquiriesError } = useInquiries();
  const { monthlyRevenue, pipelineByStage, loading: analyticsLoading, error: analyticsError } = useAnalytics();
  const { messages: emailMessages, loading: emailsLoading, error: emailsError } = useEmailMessages();
  const errors = [
    ['Buyers', clientsError],
    ['Orders', ordersError],
    ['Inquiries', inquiriesError],
    ['Analytics', analyticsError],
    ['Emails', emailsError],
  ].filter(([, message]) => message);

  const firstName = (profile?.full_name || user?.email || 'there').split(' ')[0].split('@')[0];
  const loading = clientsLoading || ordersLoading || inquiriesLoading || analyticsLoading || emailsLoading;

  if (loading) {
    return (
      <div className="card dashboard-loading">
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
        <p>Loading KTC command center...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <DashboardHeader firstName={firstName} />
      {errors.length > 0 && (
        <div className="alert alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span style={{ flex: 1 }}>
            Some data didn't load, so figures below may be incomplete. {errors.map(([label, message]) => `${label}: ${message}`).join(' · ')}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}
      <KpiGrid clients={clients} orders={orders} monthlyRevenue={monthlyRevenue} />

      <div className="dashboard-layout">
        <div className="dashboard-main-column">
          <PriorityPanel inquiries={inquiries} clients={clients} orders={orders} />
          <PipelineOverview pipelineByStage={pipelineByStage} />
          <RecentActivity messages={emailMessages} orders={orders} clients={clients} />
        </div>
        <div className="dashboard-side-column">
          <QuickActions />
          <AlertsPanel inquiries={inquiries} clients={clients} />
        </div>
      </div>
    </div>
  );
}
