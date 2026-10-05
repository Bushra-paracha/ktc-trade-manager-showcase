# Outreach Module — Backend Setup Guide

This covers deploying the two Edge Functions that power real email sending
and tracking via Brevo.

---

## Prerequisites

- [x] `01_clients_table.sql` and `02_outreach_tables.sql` already run in Supabase
- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] Logged in (`supabase login`)
- [ ] Project linked (`supabase link --project-ref your-project-ref`)
- [ ] Brevo API key ready (Brevo → Settings → SMTP & API → API Keys)

---

## Step 1 — Add secrets to Supabase

Edge Functions need your Brevo API key and the Supabase **service role** key
(different from the publishable key used in the frontend — this one has full
database access and must NEVER be in frontend code).

Find your service role key: Supabase Dashboard → Settings → API Keys →
**Secret keys** section (the one you saw earlier, starts with `sb_secret_...`).

Run these commands from inside the `ktc-app` folder:

```bash
supabase secrets set BREVO_API_KEY=xkeysib-your-key-here
supabase secrets set SUPABASE_URL=https://your-project-ref.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_your-secret-key-here
```

---

## Step 2 — Deploy the functions

```bash
supabase functions deploy send-campaign-email
supabase functions deploy brevo-webhook
```

After deploying, Supabase will print URLs like:
```
https://your-project-ref.supabase.co/functions/v1/send-campaign-email
https://your-project-ref.supabase.co/functions/v1/brevo-webhook
```

---

## Step 3 — Register the webhook in Brevo

1. Go to Brevo → **Settings → Webhooks** (under "Transactional" section)
2. Click **Create a webhook**
3. URL: `https://your-project-ref.supabase.co/functions/v1/brevo-webhook`
4. Events to enable: **Delivered, Opens, Clicks, Hard bounces, Soft bounces, Spam complaints**
5. Save

---

## Step 4 — Allow public access to the webhook

By default, Supabase Edge Functions require an auth token. The Brevo webhook
needs to be callable WITHOUT Supabase auth (Brevo doesn't send your tokens).

Run:
```bash
supabase functions deploy brevo-webhook --no-verify-jwt
```

(The `send-campaign-email` function should KEEP requiring auth since it's
called from your own app — deploy that one normally, without `--no-verify-jwt`.)

---

## Step 5 — Test it

Once deployed, we'll test by sending one email from the app's Outreach page
(built in the next step) to your own email address, and confirm:
1. It arrives in your inbox
2. Opening it updates the status to "Opened" in Supabase within a minute or two

---

## Troubleshooting

- **"Function not found"** — make sure you're in the `ktc-app` directory and the
  function folders exist under `supabase/functions/`
- **"Invalid API key" from Brevo** — double check the key starts with `xkeysib-`
  and was copied in full
- **Webhook not firing** — confirm the webhook URL in Brevo has no typos and
  that you deployed with `--no-verify-jwt`
