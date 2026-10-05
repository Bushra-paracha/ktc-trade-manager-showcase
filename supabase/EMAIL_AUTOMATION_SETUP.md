# Email Automation — Setup Guide

Three automations, all sent through Brevo from `exports@example.com`:

| Automation | Trigger | Emails |
|---|---|---|
| **New Lead Follow-Up** | A client is added in the CRM with status `New` and an email | Day 0, 4, 10, 21 |
| **Website Inquiry Auto-Reply** | Someone submits the public inquiry form | Within 10 minutes, then day 3 |
| **Monthly Rice Offer** | 1st of each month, 11:00 PKT | One email to clients interested in rice |

Every automated email:
- stops the sequence when the buyer replies, bounces, submits an inquiry, or their CRM status moves to Engaged / Negotiating / Won / Lost
- carries an unsubscribe link; unsubscribes, hard bounces and spam complaints go to `email_suppressions` and are never mailed again
- shows up on the CRM Outreach page and in Brevo → Transactional → Logs, with open/click tracking
- counts against a daily cap (`DAILY_SEND_LIMIT`, default 80) so the 10,000-credit Starter plan lasts until January

Everything is seeded **inactive**. Nothing sends until you switch it on in step 6.

---

## 1. Secrets

Nothing to copy by hand. The migration generates the shared cron/unsubscribe secret inside
Supabase Vault (`ktc_automation_secret`) and stores the project URL (`ktc_project_url`).
Optional: `supabase secrets set DAILY_SEND_LIMIT=80` (80 is already the default).

## 2. Run the migration

Paste `supabase/migrations/202609270001_email_automation.sql` into the SQL Editor and run it
(or `supabase db push`). It creates the tables, triggers, seed emails and the two cron jobs.

## 3. Deploy the functions

```bash
supabase functions deploy run-email-automation --no-verify-jwt
supabase functions deploy email-unsubscribe --no-verify-jwt
supabase functions deploy check-email-replies --no-verify-jwt
supabase functions deploy brevo-webhook --no-verify-jwt
```

`run-email-automation` and `check-email-replies` check the `x-automation-secret` header against the Vault secret
(or, for check-email-replies, a signed-in CRM user), so they are not open to the public.

## 4. See replies inside Brevo

Replies go to `exports@example.com` (Google Workspace). To read and answer them in Brevo:

1. Brevo → **Conversations** → Settings → **Email** → Connect an email address → `exports@example.com`
2. Brevo gives you a forwarding address. In Gmail for exports@: Settings → Forwarding → add that address, confirm, and choose **keep Gmail's copy in the inbox** (the CRM's reply detection reads the inbox over IMAP).
3. Make sure `IMAP_MAILBOXES` includes `exports@example.com:<app password>` and `IMAP_HOST=imap.gmail.com`, so the CRM also stops sequences when someone replies.

## 5. Review and switch on

Check the copy first:

```sql
select s.name, st.step_number, st.delay_days, st.subject
from email_sequences s join email_sequence_steps st on st.sequence_id = s.id
order by s.name, st.step_number;
```

Send yourself a test by adding a client with your own email and status `New` after turning on the sequence. Then:

```sql
update email_sequences set active = true where name = 'Website Inquiry Auto-Reply';
update email_sequences set active = true where name = 'New Lead Follow-Up';
```

Enroll leads already in the CRM (only `New` clients never emailed before):

```sql
insert into email_sequence_enrollments (sequence_id, client_id, to_email, to_name, company, country, product_interest)
select s.id, c.id, lower(trim(c.email)), c.contact, c.company, c.country,
       nullif(regexp_replace(coalesce(c.products_interest::text, ''), '[\[\]{}"]', '', 'g'), '')
from clients c
cross join email_sequences s
where s.name = 'New Lead Follow-Up'
  and c.status = 'New' and c.email like '%@%'
  and not exists (select 1 from email_messages m where m.client_id = c.id)
  and not exists (select 1 from email_suppressions x where x.email = lower(trim(c.email)))
on conflict do nothing;
```

With the daily cap, a large backlog is spread over several days automatically.

## 6. Monthly offer (each month)

The broadcast only sends when the prices are filled in and approved for the current month:

```sql
update email_broadcasts
set body_html = replace(replace(body_html, '[PRICE]', '390'), ...),   -- or edit the text directly
    approved_through = '2026-10-31',
    active = true
where name = 'Monthly Rice Offer';
```

If `approved_through` is in the past, or any `[PLACEHOLDER]` is left in the text, it waits and does not send.

## Monitoring

```sql
select * from email_automation_status;
select to_email, reason, created_at from email_suppressions order by created_at desc;
select * from cron.job_run_details order by start_time desc limit 10;
```

Pause everything instantly:

```sql
update email_sequences set active = false;
update email_broadcasts set active = false;
```

## Sending sequences from the company mailbox (Primary inbox)

Brevo mail is filed under Gmail's Promotions tab. Since migration
`202609270040_sequences_send_via_smtp.sql`, the follow-up sequences send from the
real `exports@` mailbox on the cPanel mail server (`email_sequences.send_via = 'smtp'`):
follow-ups thread under the first email, and `check-email-replies` reads the same
mailbox over IMAP to stop on reply. The monthly broadcast stays on Brevo.

KTC has no Google Workspace. The domain's MX record must point at the cPanel
server (`mail.kassamtradingcompany.com`), not `SMTP.GOOGLE.com`, and cPanel
Email Routing must be set to Local Mail Exchanger, or inbound mail never reaches
the cPanel mailboxes.

```bash
supabase secrets set SMTP_HOST=mail.kassamtradingcompany.com SMTP_PORT=465 SMTP_USER=exports@example.com SMTP_PASSWORD='mailbox password'
supabase db query --linked -f supabase/migrations/202609270040_sequences_send_via_smtp.sql
supabase functions deploy run-email-automation --no-verify-jwt
supabase functions deploy check-email-replies --no-verify-jwt
```
Keep the daily cap modest (80 by default): shared hosting limits outgoing mail
per hour, and cold outreach well below that protects the mailbox and server IP.
