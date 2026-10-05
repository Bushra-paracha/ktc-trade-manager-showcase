import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { AlertCircle, Phone, Mail, Globe } from 'lucide-react';
import { parseDate } from '../lib/dates';

const STAGES = [
  { key: 'Confirmed',      label: 'Order Confirmed',     icon: '📋', desc: 'Your order has been confirmed and is awaiting advance payment.' },
  { key: 'In Production',  label: 'In Production',       icon: '🏭', desc: 'Your rice is being milled and packed at our Port Qasim facility.' },
  { key: 'Ready to Ship',  label: 'Ready to Ship',       icon: '📦', desc: 'Your order is packed, inspected and ready for loading.' },
  { key: 'Shipped',        label: 'Shipped',             icon: '🚢', desc: 'Your container has been loaded and is on its way.' },
  { key: 'Delivered',      label: 'Delivered',           icon: '✅', desc: 'Your shipment has arrived at the destination port.' },
];

function getStageIndex(status) {
  return STAGES.findIndex(s => s.key === status);
}

export default function OrderTracking() {
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchOrder() {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_buyer_order_tracking', {
        p_token: token,
      });
      if (error || !data) setError('Order not found. Please check your secure tracking link.');
      else setOrder(data);
      setLoading(false);
    }
    if (token) fetchOrder();
  }, [token]);

  const stageIndex = order ? getStageIndex(order.status) : -1;

  if (loading) return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={styles.spinner} />
          <p style={{ marginTop: 16, color: '#666' }}>Loading your order...</p>
        </div>
      </div>
    </div>
  );

  if (error || !order) return (
    <div style={styles.page}>
      <div style={styles.header}>
        <img src="https://kassamtradingcompany.com/wp-content/uploads/2023/06/KTC-Logo.png" alt="KTC Logo" style={{ height: 48, marginBottom: 8 }} onError={e => e.target.style.display='none'} />
        <h1 style={styles.brandName}>Kassam Trading Company</h1>
        <p style={styles.brandSub}>Order Tracking Portal</p>
      </div>
      <div style={{ ...styles.card, textAlign: 'center', padding: 48 }}>
        <AlertCircle size={48} color="#dc3545" style={{ marginBottom: 16 }} />
        <h2 style={{ color: '#dc3545', marginBottom: 8 }}>Order Not Found</h2>
        <p style={{ color: '#666', marginBottom: 24 }}>{error || 'Please check your order reference number and try again.'}</p>
        <p style={{ color: '#666', fontSize: 14 }}>Need help? Contact us on WhatsApp: <strong>+92-300-820-1074</strong></p>
      </div>
    </div>
  );

  const shipment = order.shipment;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <img src="https://kassamtradingcompany.com/wp-content/uploads/2023/06/KTC-Logo.png" alt="KTC Logo" style={{ height: 48, marginBottom: 8 }} onError={e => e.target.style.display='none'} />
        <h1 style={styles.brandName}>Kassam Trading Company</h1>
        <p style={styles.brandSub}>Order Tracking Portal</p>
      </div>

      {/* Order Header */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={styles.orderId}>{order.order_number}</div>
            <div style={styles.clientName}>{order.client_name || 'Valued Customer'}</div>
            {order.country && <div style={styles.meta}>📍 {order.country}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ ...styles.statusBadge, background: stageIndex === STAGES.length - 1 ? '#d4edda' : '#fff3cd', color: stageIndex === STAGES.length - 1 ? '#155724' : '#856404' }}>
              {STAGES[stageIndex]?.icon} {order.status}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Tracker */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Order Progress</h2>
        <div style={styles.progressContainer}>
          {STAGES.map((stage, i) => {
            const isComplete = i < stageIndex;
            const isCurrent = i === stageIndex;
            const isPending = i > stageIndex;
            return (
              <div key={stage.key} style={styles.stageItem}>
                {/* Connector line */}
                {i > 0 && (
                  <div style={{ ...styles.connector, background: isComplete || isCurrent ? '#14432A' : '#dee2e6' }} />
                )}
                {/* Stage dot */}
                <div style={{
                  ...styles.stageDot,
                  background: isComplete ? '#14432A' : isCurrent ? '#14432A' : '#dee2e6',
                  border: isCurrent ? '3px solid #14432A' : 'none',
                  boxShadow: isCurrent ? '0 0 0 4px rgba(20,67,42,0.15)' : 'none',
                }}>
                  {isComplete ? '✓' : stage.icon}
                </div>
                {/* Stage label */}
                <div style={styles.stageLabel}>
                  <div style={{ fontWeight: isCurrent ? 700 : 500, color: isPending ? '#aaa' : '#1a1a2e', fontSize: 13 }}>
                    {stage.label}
                  </div>
                  {isCurrent && (
                    <div style={{ fontSize: 11, color: '#14432A', marginTop: 4, maxWidth: 120, textAlign: 'center' }}>
                      {stage.desc}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div style={styles.progressBarBg}>
          <div style={{ ...styles.progressBarFill, width: `${Math.max(5, (stageIndex / (STAGES.length - 1)) * 100)}%` }} />
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#666', marginTop: 8 }}>
          Step {stageIndex + 1} of {STAGES.length}
        </div>
      </div>

      {/* Order Details */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Order Details</h2>
        <div style={styles.detailsGrid}>
          {order.items?.map((item, i) => (
            <div key={i} style={styles.detailRow}>
              <span style={styles.detailLabel}>Product</span>
              <span style={styles.detailValue}>{item.product_name} — {item.quantity_mt} MT</span>
            </div>
          ))}
          {order.incoterm && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Incoterm</span>
              <span style={styles.detailValue}>{order.incoterm}</span>
            </div>
          )}
          {order.pol_port && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Port of Loading</span>
              <span style={styles.detailValue}>{order.pol_port}</span>
            </div>
          )}
          {order.pod_port && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Port of Discharge</span>
              <span style={styles.detailValue}>{order.pod_port}</span>
            </div>
          )}
          {order.payment_method && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Payment Terms</span>
              <span style={styles.detailValue}>{order.payment_method}</span>
            </div>
          )}
          {order.shipment_deadline && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Shipment Deadline</span>
              <span style={styles.detailValue}>{parseDate(order.shipment_deadline)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </div>
          )}
        </div>
      </div>

      {/* Shipment Details */}
      {shipment && (
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>🚢 Shipment Details</h2>
          <div style={styles.detailsGrid}>
            {shipment.shipping_line && shipment.shipping_line !== 'TBC' && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Shipping Line</span>
                <span style={styles.detailValue}>{shipment.shipping_line}</span>
              </div>
            )}
            {shipment.vessel_voyage && shipment.vessel_voyage !== 'TBC' && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Vessel / Voyage</span>
                <span style={styles.detailValue}>{shipment.vessel_voyage}</span>
              </div>
            )}
            {shipment.container_number && shipment.container_number !== 'TBC' && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Container No.</span>
                <span style={styles.detailValue}>{shipment.container_number}</span>
              </div>
            )}
            {shipment.bl_number && shipment.bl_number !== 'TBC' && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Bill of Lading No.</span>
                <span style={styles.detailValue}>{shipment.bl_number}</span>
              </div>
            )}
            {shipment.etd && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Departure (ETD)</span>
                <span style={styles.detailValue}>{parseDate(shipment.etd)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
            )}
            {shipment.eta && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Arrival (ETA)</span>
                <span style={styles.detailValue}><strong>{parseDate(shipment.eta)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></span>
              </div>
            )}
            {shipment.tracking_url && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Track Vessel</span>
                <a href={shipment.tracking_url} target="_blank" rel="noopener noreferrer" style={{ color: '#14432A', fontWeight: 600, fontSize: 14 }}>
                  Click to track →
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contact */}
      <div style={{ ...styles.card, background: '#f0f9f4', borderLeft: '4px solid #14432A' }}>
        <h2 style={styles.sectionTitle}>Need Help?</h2>
        <p style={{ fontSize: 14, color: '#444', marginBottom: 16 }}>Our team is available to assist you with any questions about your order.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a href="https://wa.me/923000000000" target="_blank" rel="noopener noreferrer" style={styles.contactBtn}>
            <Phone size={14} /> WhatsApp
          </a>
          <a href="mailto:outreach@example.com" style={styles.contactBtn}>
            <Mail size={14} /> Email Us
          </a>
          <a href="https://kassamtradingcompany.com" target="_blank" rel="noopener noreferrer" style={{ ...styles.contactBtn, background: 'white', color: '#14432A', border: '1px solid #14432A' }}>
            <Globe size={14} /> Our Website
          </a>
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <p>Kassam Trading Company | Port Qasim, Karachi, Pakistan</p>
        <p>REAP Member #2-1-99-1195 | UNGM Supplier #495113</p>
        <p style={{ marginTop: 4, fontSize: 11 }}>© 2026 Kassam Trading Company. All rights reserved.</p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f4f6f9',
    padding: '0 0 48px 0',
    fontFamily: 'Inter, -apple-system, sans-serif',
  },
  header: {
    background: '#14432A',
    color: 'white',
    textAlign: 'center',
    padding: '32px 24px 24px',
    marginBottom: 24,
  },
  brandName: {
    fontSize: 22,
    fontWeight: 700,
    color: 'white',
    margin: '8px 0 4px',
  },
  brandSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    margin: 0,
  },
  card: {
    background: 'white',
    borderRadius: 12,
    padding: '20px 24px',
    margin: '0 16px 16px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  orderId: {
    fontSize: 22,
    fontWeight: 700,
    color: '#14432A',
    marginBottom: 4,
  },
  clientName: {
    fontSize: 16,
    fontWeight: 600,
    color: '#1a1a2e',
    marginBottom: 4,
  },
  meta: {
    fontSize: 13,
    color: '#666',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '6px 14px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 8,
  },
  value: {
    fontSize: 18,
    fontWeight: 700,
    color: '#14432A',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: 16,
    marginTop: 0,
  },
  progressContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    position: 'relative',
    marginBottom: 24,
    overflowX: 'auto',
    paddingBottom: 8,
  },
  stageItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    position: 'relative',
    flex: 1,
    minWidth: 80,
  },
  connector: {
    position: 'absolute',
    top: 20,
    right: '50%',
    width: '100%',
    height: 3,
    zIndex: 0,
  },
  stageDot: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    color: 'white',
    zIndex: 1,
    position: 'relative',
    marginBottom: 8,
  },
  stageLabel: {
    textAlign: 'center',
    padding: '0 4px',
  },
  progressBarBg: {
    height: 6,
    background: '#e9ecef',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    background: '#14432A',
    borderRadius: 3,
    transition: 'width 0.5s ease',
  },
  detailsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '0.5px solid #f0f0f0',
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: 500,
    minWidth: 140,
  },
  detailValue: {
    fontSize: 14,
    color: '#1a1a2e',
    fontWeight: 500,
    textAlign: 'right',
  },
  docRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '0.5px solid #f0f0f0',
  },
  downloadBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    background: '#14432A',
    color: 'white',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
  },
  contactBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: '#14432A',
    color: 'white',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
  },
  footer: {
    textAlign: 'center',
    padding: '24px 16px 0',
    fontSize: 12,
    color: '#999',
    lineHeight: 1.8,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #e9ecef',
    borderTop: '3px solid #14432A',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto',
  },
};
