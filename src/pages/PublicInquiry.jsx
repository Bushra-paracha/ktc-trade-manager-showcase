import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// Shown if the catalog can't be loaded, so the form always offers the core range.
const FALLBACK_PRODUCTS = [
  '1121 Kainaat Basmati', 'Super Kernel Basmati', 'Super Fine Basmati', 'PK-385 Basmati', 'D-98 Basmati',
  'IRRI-6', 'IRRI-9', 'KS-282', 'PK-386', 'C-9 Sella', '1121 Sella', '100% Broken Rice',
  'Himalayan Pink Salt', 'Refined White Salt', 'White Hulled Sesame Seeds', 'Yellow Corn / Maize', 'Wheat',
].map((name) => ({ id: name, name }));

// Visitors aren't logged in, so product names come from a public function that
// exposes names only (no costs or stock).
function usePublicProducts() {
  const [products, setProducts] = useState([]);
  useEffect(() => {
    let active = true;
    supabase.rpc('public_product_catalog').then(({ data, error }) => {
      if (!active) return;
      setProducts(!error && data?.length ? data : FALLBACK_PRODUCTS);
    });
    return () => {
      active = false;
    };
  }, []);
  return products;
}

const EMPTY_FORM = {
  full_name: '',
  company_name: '',
  email: '',
  phone: '',
  country: '',
  product_interest: '',
  quantity_estimate: '',
  message: '',
};

export default function PublicInquiry() {
  const products = usePublicProducts();
  // ?via=whatsapp is the link in the WhatsApp Business greeting: the WhatsApp number is
  // required (that's where we reply) and email is optional.
  const [params] = useSearchParams();
  const viaWhatsApp = params.get('via') === 'whatsapp';
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error } = await supabase.from('public_inquiry_submissions')
      .insert([{ ...form, via: viaWhatsApp ? 'whatsapp' : 'website' }]);

    setSubmitting(false);

    if (error) {
      setError("Something went wrong submitting your inquiry. Please try again or email us directly at exports@example.com.");
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <PublicPageShell>
        <div className="card" style={{ textAlign: 'center', padding: 48, maxWidth: 480, margin: '0 auto' }}>
          <CheckCircle2 size={40} color="var(--color-success)" style={{ marginBottom: 16 }} />
          <h2 style={{ marginBottom: 8 }}>Thank you for your inquiry</h2>
          <p style={{ color: 'var(--color-ink-soft)', fontSize: 14 }}>
            {viaWhatsApp
              ? 'Our export team will review your request and reply to you on WhatsApp shortly.'
              : 'Our export team will review your request and get back to you within 1 to 2 business days at the email address you provided.'}
          </p>
        </div>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell>
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ marginBottom: 6 }}>Request a Quote</h2>
          <p style={{ color: 'var(--color-ink-soft)', fontSize: 14 }}>
            Tell us what you're looking for and our team will follow up with pricing and availability.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grid grid-2">
            <FormRow label="Full Name *">
              <input className="select-input" required value={form.full_name} onChange={(e) => update('full_name', e.target.value)} />
            </FormRow>
            <FormRow label="Company Name">
              <input className="select-input" value={form.company_name} onChange={(e) => update('company_name', e.target.value)} />
            </FormRow>
          </div>

          <div className="grid grid-2">
            <FormRow label={viaWhatsApp ? 'Email' : 'Email *'}>
              <input type="email" required={!viaWhatsApp} className="select-input" value={form.email} onChange={(e) => update('email', e.target.value)} />
            </FormRow>
            <FormRow label={viaWhatsApp ? 'WhatsApp Number (with country code) *' : 'Phone / WhatsApp'}>
              <input type="tel" required={viaWhatsApp} className="select-input" placeholder={viaWhatsApp ? '+971 50 123 4567' : undefined}
                     value={form.phone} onChange={(e) => update('phone', e.target.value)} />
            </FormRow>
          </div>

          <FormRow label={viaWhatsApp ? 'Country *' : 'Country'}>
            <input className="select-input" required={viaWhatsApp} value={form.country} onChange={(e) => update('country', e.target.value)} />
          </FormRow>

          <FormRow label="Product of Interest">
            <select className="select-input" value={form.product_interest} onChange={(e) => update('product_interest', e.target.value)}>
              <option value="">— Select a product —</option>
              {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              <option value="Other / Not Listed">Other / Not Listed</option>
            </select>
          </FormRow>

          <FormRow label="Estimated Quantity">
            <input className="select-input" placeholder="e.g. 50 MT / month" value={form.quantity_estimate} onChange={(e) => update('quantity_estimate', e.target.value)} />
          </FormRow>

          <FormRow label="Message">
            <textarea className="select-input" rows={4} placeholder="Tell us more about your requirements..." value={form.message} onChange={(e) => update('message', e.target.value)} />
          </FormRow>

          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ justifyContent: 'center', marginTop: 4 }}>
            {submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Submit Inquiry'}
          </button>
        </form>
      </div>
    </PublicPageShell>
  );
}

function PublicPageShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 12, background: 'var(--color-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px', fontFamily: 'var(--font-display)', fontWeight: 700,
          fontSize: 18, color: 'var(--color-accent-soft)',
        }}>
          KTC
        </div>
        <h1 style={{ fontSize: 22 }}>Kassam Trading Company</h1>
        <p style={{ color: 'var(--color-ink-soft)', fontSize: 13, marginTop: 4 }}>Rice Millers, Processors &amp; Exporters</p>
      </div>
      {children}
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--color-ink-soft)', fontWeight: 600 }}>
      {label}
      {children}
    </label>
  );
}
