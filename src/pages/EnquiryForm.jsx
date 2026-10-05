import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// Public form linked from the WhatsApp greeting (/enquiry/:token). The token identifies
// the buyer's WhatsApp enquiry; details go to the approval queue, never straight to the CRM.

const EMPTY = { contact_name: '', company: '', country: '', email: '', product: '', quantity: '', destination_port: '', message: '' };

export default function EnquiryForm() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true });
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [doneRef, setDoneRef] = useState(null);

  useEffect(() => {
    let active = true;
    supabase.rpc('get_enquiry_form', { p_token: token }).then(({ data, error: err }) => {
      if (!active) return;
      if (err || !data?.found) {
        setState({ loading: false, missing: true });
        return;
      }
      setState({ loading: false, ...data });
      setForm({
        ...EMPTY,
        ...Object.fromEntries(Object.keys(EMPTY).map((key) => [key, data[key] || ''])),
        message: '',
      });
    });
    return () => {
      active = false;
    };
  }, [token]);

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('submit_enquiry_form', { p_token: token, p_data: form });
    setSubmitting(false);
    if (err) {
      setError(err.message || 'Something went wrong. Please try again or reply to us on WhatsApp.');
      return;
    }
    setDoneRef(data?.ref || state.ref);
  }

  if (state.loading) {
    return <Shell><div className="card" style={{ textAlign: 'center', padding: 40 }}><Loader2 className="spin" /></div></Shell>;
  }

  if (state.missing) {
    return (
      <Shell>
        <Card title="This link is no longer active">
          <p style={{ fontSize: 14, color: 'var(--color-ink-soft)' }}>
            Please send us a message on WhatsApp and we will share a new link.
          </p>
        </Card>
      </Shell>
    );
  }

  if (doneRef || (!state.open && state.submitted)) {
    return (
      <Shell>
        <div className="card" style={{ textAlign: 'center', padding: 40, maxWidth: 480, margin: '0 auto' }}>
          <CheckCircle2 size={40} color="var(--color-success)" style={{ marginBottom: 16 }} />
          <h2 style={{ marginBottom: 8 }}>Thank you</h2>
          <p style={{ color: 'var(--color-ink-soft)', fontSize: 14 }}>
            We have received your enquiry {doneRef || state.ref}. Our team will review it and contact you on WhatsApp shortly.
          </p>
        </div>
      </Shell>
    );
  }

  const products = Array.isArray(state.products) ? state.products : [];

  return (
    <Shell>
      <Card title="Your requirement" subtitle={`Enquiry ${state.ref}. This takes about a minute.`}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grid grid-2">
            <Row label="Your name *">
              <input className="select-input" required value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} />
            </Row>
            <Row label="Company">
              <input className="select-input" value={form.company} onChange={(e) => update('company', e.target.value)} />
            </Row>
          </div>
          <div className="grid grid-2">
            <Row label="Country *">
              <input className="select-input" required value={form.country} onChange={(e) => update('country', e.target.value)} />
            </Row>
            <Row label="Email">
              <input type="email" className="select-input" value={form.email} onChange={(e) => update('email', e.target.value)} />
            </Row>
          </div>
          <Row label="Product *">
            <select className="select-input" required value={form.product} onChange={(e) => update('product', e.target.value)}>
              <option value="">Select a product</option>
              {products.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="Other">Other (tell us below)</option>
            </select>
          </Row>
          <div className="grid grid-2">
            <Row label="Quantity *">
              <input className="select-input" required placeholder="e.g. 500 MT / month" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} />
            </Row>
            <Row label="Destination port">
              <input className="select-input" placeholder="e.g. Jebel Ali" value={form.destination_port} onChange={(e) => update('destination_port', e.target.value)} />
            </Row>
          </div>
          <Row label="Anything else (packing, specification, terms)">
            <textarea className="select-input" rows={4} value={form.message} onChange={(e) => update('message', e.target.value)} />
          </Row>
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ justifyContent: 'center' }}>
            {submitting ? <Loader2 size={16} className="spin" /> : 'Send enquiry'}
          </button>
        </form>
      </Card>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '32px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 12, background: 'var(--color-primary)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontFamily: 'var(--font-display)',
          fontWeight: 700, fontSize: 18, color: 'var(--color-accent-soft)',
        }}>KTC</div>
        <h1 style={{ fontSize: 22 }}>Kassam Trading Company</h1>
        <p style={{ color: 'var(--color-ink-soft)', fontSize: 13, marginTop: 4 }}>Rice, salt and sesame exporters, Karachi</p>
      </div>
      {children}
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ marginBottom: 6 }}>{title}</h2>
        {subtitle && <p style={{ color: 'var(--color-ink-soft)', fontSize: 14 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--color-ink-soft)', fontWeight: 600 }}>
      {label}
      {children}
    </label>
  );
}
