const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const ZOHO_SENDER_EMAILS = Deno.env.get('ZOHO_SENDER_EMAILS') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function brevo(path: string, init: RequestInit = {}) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY is not configured');
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...init,
    headers: {
      'api-key': BREVO_API_KEY,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Brevo request failed (${response.status})`);
  }
  return data;
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function configuredZohoEmails() {
  return ZOHO_SENDER_EMAILS.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes('@'));
}

function configuredZohoDomains() {
  return new Set(configuredZohoEmails().map((email) => email.split('@')[1]));
}

function zohoSenders() {
  return configuredZohoEmails().map((email) => ({
    id: `zoho:${email}`,
    email,
    name: 'NBMT Trading',
    active: true,
    provider: 'zoho',
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { action, domain, email, name } = await req.json();

    if (action === 'list') {
      const [senderData, domainData] = await Promise.all([
        brevo('/senders'),
        brevo('/senders/domains'),
      ]);
      return json({
        senders: [
          ...(senderData.senders || []).map((sender: Record<string, unknown>) => ({
            ...sender,
            provider: 'brevo',
          })),
          ...zohoSenders(),
        ],
        // Zoho-managed domains must never appear in Brevo's authentication workflow.
        domains: (domainData.domains || []).filter((domain: Record<string, unknown>) => {
          const name = String(domain.domain_name || domain.domain || domain.name || '').toLowerCase();
          return !configuredZohoDomains().has(name);
        }),
      });
    }

    if (action === 'add-domain') {
      const cleanDomain = normalizeDomain(domain || '');
      if (!cleanDomain || !cleanDomain.includes('.')) return json({ error: 'Enter a valid domain' }, 400);
      if (configuredZohoDomains().has(cleanDomain)) {
        return json({
          error: `${cleanDomain} is connected through Zoho Mail and must not be authenticated in Brevo.`,
        }, 409);
      }
      return json(await brevo('/senders/domains', {
        method: 'POST',
        body: JSON.stringify({ name: cleanDomain }),
      }));
    }

    if (action === 'verify-domain') {
      const cleanDomain = normalizeDomain(domain || '');
      if (!cleanDomain) return json({ error: 'Domain is required' }, 400);
      if (configuredZohoDomains().has(cleanDomain)) {
        return json({
          error: `${cleanDomain} is connected through Zoho Mail and does not use Brevo authentication.`,
        }, 409);
      }
      await brevo(`/senders/domains/${encodeURIComponent(cleanDomain)}/authenticate`, { method: 'PUT' });
      return json(await brevo(`/senders/domains/${encodeURIComponent(cleanDomain)}`));
    }

    if (action === 'add-sender') {
      const cleanEmail = (email || '').trim().toLowerCase();
      if (!cleanEmail.includes('@')) return json({ error: 'Enter a valid sender email' }, 400);
      const emailDomain = cleanEmail.split('@')[1];
      if (configuredZohoDomains().has(emailDomain)) {
        if (configuredZohoEmails().includes(cleanEmail)) {
          return json({
            message: `${cleanEmail} is already connected through Zoho OAuth.`,
            provider: 'zoho',
          });
        }
        return json({
          error: `${cleanEmail} belongs to a Zoho-managed domain. Add it to the Zoho sender configuration instead of Brevo.`,
        }, 409);
      }
      return json(await brevo('/senders', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail, name: (name || 'Kassam Trading Company').trim() }),
      }));
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 502);
  }
});
