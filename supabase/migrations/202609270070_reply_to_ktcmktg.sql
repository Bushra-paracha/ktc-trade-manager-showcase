-- Buyer replies to every CRM email go to outreach@example.com (Bushra, 2026-09-27).
-- Sequences and broadcasts: run-email-automation already sends Reply-To from these columns.
-- Outreach (send-campaign-email) and shipment emails (staff-notifier) use REPLY_TO_EMAIL in code.
-- Safe to re-run.
alter table public.email_sequences alter column reply_to_email set default 'outreach@example.com';
update public.email_sequences set reply_to_email = 'outreach@example.com';
alter table public.email_broadcasts alter column reply_to_email set default 'outreach@example.com';
update public.email_broadcasts set reply_to_email = 'outreach@example.com';
