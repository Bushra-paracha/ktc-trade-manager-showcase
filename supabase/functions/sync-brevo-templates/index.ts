// Supabase Edge Function: sync-brevo-templates
//
// Fetches all transactional email templates from Brevo and syncs them
// into the app's email_templates table, so they appear as selectable
// templates in the Outreach > Compose Email flow.
//
// Templates created directly in Brevo's own template editor are matched
// by their Brevo template ID (stored in brevo_template_id) and kept in
// sync — re-running this updates existing rows rather than duplicating them.
//
// Called manually from the app via a "Sync Templates from Brevo" button.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const result = { fetched: 0, created: 0, updated: 0, skipped: 0, errors: [] };

  try {
    // Brevo returns up to 1000 templates per page; KTC won't have anywhere
    // near that many, so a single page request is sufficient.
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/templates?limit=100&sort=desc', {
      method: 'GET',
      headers: {
        'api-key': BREVO_API_KEY,
        'Accept': 'application/json',
      },
    });

    const brevoData = await brevoRes.json();

    if (!brevoRes.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch templates from Brevo', details: brevoData }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const templates = brevoData.templates || [];
    result.fetched = templates.length;

    for (const tpl of templates) {
      // Skip templates with no usable HTML content
      if (!tpl.htmlContent && !tpl.subject) {
        result.skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('email_templates')
        .select('id')
        .eq('brevo_template_id', tpl.id)
        .maybeSingle();

      const payload = {
        name: tpl.name || `Brevo Template ${tpl.id}`,
        subject: tpl.subject || '',
        body_html: tpl.htmlContent || '',
        category: 'Synced from Brevo',
        brevo_template_id: tpl.id,
      };

      if (existing) {
        const { error } = await supabase
          .from('email_templates')
          .update(payload)
          .eq('id', existing.id);
        if (error) {
          result.errors.push(`Update failed for "${tpl.name}": ${error.message}`);
        } else {
          result.updated++;
        }
      } else {
        const { error } = await supabase
          .from('email_templates')
          .insert([payload]);
        if (error) {
          result.errors.push(`Insert failed for "${tpl.name}": ${error.message}`);
        } else {
          result.created++;
        }
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
