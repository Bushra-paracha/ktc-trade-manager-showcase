import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import BottomNav from './components/BottomNav';
import OfflineBanner from './components/OfflineBanner';
import { applyTheme, resolvedTheme } from './lib/theme';

const Login = lazy(() => import('./pages/Login'));
const PublicInquiry = lazy(() => import('./pages/PublicInquiry'));
const EnquiryForm = lazy(() => import('./pages/EnquiryForm'));
const Approvals = lazy(() => import('./pages/Approvals'));
const OrderTracking = lazy(() => import('./pages/OrderTracking'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Today = lazy(() => import('./pages/Today'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientProfile = lazy(() => import('./pages/ClientProfile'));
const Inquiries = lazy(() => import('./pages/Inquiries'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Documents = lazy(() => import('./pages/Documents'));
const Payments = lazy(() => import('./pages/Payments'));
const Outreach = lazy(() => import('./pages/Outreach'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Reengage = lazy(() => import('./pages/Reengage'));
const Settings = lazy(() => import('./pages/Settings'));

// Buyer-facing pages keep the light look whatever theme staff use.
function LightOnly({ children }) {
  useEffect(() => {
    applyTheme('light');
    return () => applyTheme(resolvedTheme());
  }, []);
  return children;
}

function PageLoader() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Loader2 size={28} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  );
}

function AwaitingApproval({ email, onSignOut }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 420, width: '100%', textAlign: 'center', padding: 28 }}>
        <h2 style={{ marginBottom: 8 }}>Waiting for approval</h2>
        <p style={{ marginBottom: 20 }}>
          You're signed in as {email}. An administrator needs to give your account access before you can see
          KTC data.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

export default function App() {
  const { user, profile, loading, signOut, isDirector } = useAuth();
  const awaitingApproval = profile && (!profile.role || profile.role === 'Pending');

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public route, no login required. Anyone with this link
            (from the website or LinkedIn) can submit an inquiry. */}
        <Route path="/quote" element={<LightOnly><PublicInquiry /></LightOnly>} />
        <Route path="/track/:token" element={<LightOnly><OrderTracking /></LightOnly>} />
        <Route path="/enquiry/:token" element={<LightOnly><EnquiryForm /></LightOnly>} />

        {/* Everything else requires login */}
        <Route
          path="/*"
          element={
            loading ? (
              <PageLoader />
            ) : !user ? (
              <Login />
            ) : awaitingApproval ? (
              <AwaitingApproval email={user.email} onSignOut={signOut} />
            ) : (
              <div className="app-shell">
                <Sidebar />
                <div className="app-main">
                  <Topbar />
                  <OfflineBanner />
                  <div className="page-content">
                    <Routes>
                      <Route path="/" element={isDirector ? <Navigate to="/today" replace /> : <Dashboard />} />
                      <Route path="/today" element={<Today />} />
                      <Route path="/clients" element={<Clients />} />
                      <Route path="/clients/:id" element={<ClientProfile />} />
                      <Route path="/inquiries" element={<Inquiries />} />
                      <Route path="/approvals" element={<Approvals />} />
                      <Route path="/orders" element={<Orders />} />
                      <Route path="/orders/:id" element={<OrderDetail />} />
                      <Route path="/documents" element={<Documents />} />
                      <Route path="/payments" element={<Payments />} />
                      <Route path="/outreach" element={<Outreach />} />
                      <Route path="/tasks" element={<Tasks />} />
                      <Route path="/inventory" element={<Inventory />} />
                      <Route path="/suppliers" element={<Suppliers />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/reengage" element={<Reengage />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/shipments" element={<Navigate to="/orders" replace />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </div>
                </div>
                <BottomNav />
              </div>
            )
          }
        />
      </Routes>
    </Suspense>
  );
}
