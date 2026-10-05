# KTC Trade Manager

A full-stack CRM and order-management system for an agricultural export business — built for **Kassam Trading Company**, a rice milling and export company in Karachi, and used by its team day to day.

> **About this repository:** this is a public showcase copy of a private production codebase (~135 commits, June–October 2026). Business contacts and infrastructure identifiers have been replaced with placeholders, and history has been squashed into a single commit.

## What it does

The app covers the whole export trade workflow in one place:

**Client CRM → Outreach → Inquiries → Approvals → Orders → Shipments → Documents → Payments → Analytics**

- **CRM** — searchable buyer and lead database with full per-client history of emails, orders and documents
- **Email outreach** — campaigns and personalised follow-up sequences sent through Brevo, with open/click/bounce webhooks, reply detection, unsubscribe handling, and automatic search for alternative contacts when an email bounces
- **WhatsApp capture** — inbound WhatsApp Business messages logged as enquiries via webhook, with an outbox and manual mode
- **Public inquiry form** — buyers submit enquiries from a public page; staff review them in an admin queue with an approval step
- **Orders & export tracking** — kanban + list views, document checklists per order, a step-by-step export process tracker, and a public order-tracking page for buyers
- **Proforma invoices** — generated as PDFs in the browser
- **Inventory, suppliers, tasks and payments** modules
- **Analytics** — revenue, pipeline and re-engagement dashboards
- **Mobile-first PWA** — installable, works on phones with a bottom nav, offline banner and service worker

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React, Vite, React Router, Recharts, jsPDF |
| Backend | Supabase — PostgreSQL, Auth, Row-Level Security, Storage |
| Server logic | 12 Supabase Edge Functions (Deno / TypeScript) |
| Integrations | Brevo (email + webhooks), WhatsApp Cloud API |
| Database | 23 versioned SQL migrations — RLS policies, triggers and scheduled automation |

## Architecture notes

- **Security first:** tables are protected by row-level security policies; Edge Functions use a service role only server-side, and role-based approvals ("director mode") gate sensitive actions.
- **Automation in the database:** follow-up sequences, order status changes and staff notifications are driven by Postgres triggers and scheduled jobs, so the frontend stays thin.
- **Data hooks:** each module reads and writes through its own React hook (`src/hooks/`), keeping pages free of data-access code.

## Project structure

```
src/
  pages/        21 screens — Dashboard, Clients, Outreach, Orders, Inquiries, Analytics…
  components/   shared UI, settings panels, navigation
  hooks/        one hook per data domain (useOutreach, useOrders, usePublicInquiries…)
  lib/          Supabase client, PDF invoice generation, helpers
supabase/
  migrations/   schema, RLS and automation as SQL
  functions/    Edge Functions for email, WhatsApp, webhooks and notifications
public/         PWA manifest, icons, service worker
```

## Running locally

Requires Node.js 18+ and a Supabase project.

```bash
npm install
cp .env.example .env   # add your Supabase URL and anon key
npm run dev
```

Apply the SQL in `supabase/migrations/` to your project, and see `supabase/OUTREACH_SETUP.md` and `supabase/EMAIL_AUTOMATION_SETUP.md` for Edge Function secrets and webhooks.
