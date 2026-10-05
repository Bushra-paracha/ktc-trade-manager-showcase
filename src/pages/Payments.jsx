import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { formatUSD } from '../data/mockData';

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    supabase
      .from('order_payments')
      .select('*, orders(id, clients(company))')
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        setPayments(data || []);
        setError(queryError?.message || '');
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const totals = useMemo(() => payments.reduce((result, payment) => {
    const amount = Number(payment.amount) || 0;
    if (payment.status === 'Due') result.due += amount;
    if (['Received', 'Reconciled'].includes(payment.status)) result.received += amount;
    return result;
  }, { due: 0, received: 0 }), [payments]);

  return (
    <div>
      <div className="page-header">
        <div><span className="eyebrow">Finance</span><h1>Payments</h1><p>Advance and balance payments across every order.</p></div>
      </div>
      <div className="order-health-grid payment-summary-grid">
        <div className="trade-stat-card"><CircleDollarSign size={18} /><div><span>Received</span><strong>{formatUSD(totals.received)}</strong><small>Received and reconciled</small></div></div>
        <div className="trade-stat-card"><CircleDollarSign size={18} /><div><span>Outstanding</span><strong>{formatUSD(totals.due)}</strong><small>Payments marked due</small></div></div>
      </div>
      {loading ? <div className="card loading-card"><Loader2 className="spin" /><p>Loading payments...</p></div>
        : error ? <div className="alert alert-danger">{error}</div>
          : payments.length === 0 ? <div className="card empty-state"><CircleDollarSign /><h4>No payments recorded</h4><p>Add an advance or balance payment from an order’s Payments tab.</p><Link className="btn btn-primary" to="/orders">Open orders</Link></div>
            : <div className="card payment-list">{payments.map((payment) => (
              <Link className="payment-list-row" to={`/orders/${payment.order_id}?tab=payments`} key={payment.id}>
                <div><strong>{payment.orders?.clients?.company || payment.order_id}</strong><span>{payment.order_id} · {payment.payment_type}</span></div>
                <div><strong>{formatUSD(payment.amount)}</strong><span className={`payment-state state-${payment.status?.toLowerCase()}`}>{payment.status}</span></div>
              </Link>
            ))}</div>}
    </div>
  );
}
