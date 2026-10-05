-- KTC email automation: follow-up sequences, website-inquiry auto-reply,
-- monthly offer broadcasts, suppression list, and the 10-minute scheduler.
--
-- Sending is done by the run-email-automation Edge Function through Brevo.
-- Every seeded sequence/broadcast starts INACTIVE: review the copy and the
-- sender, then switch them on (see supabase/EMAIL_AUTOMATION_SETUP.md).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Suppression list (unsubscribes, hard bounces, spam complaints, manual blocks)
-- ---------------------------------------------------------------------------
create table if not exists public.email_suppressions (
  email text primary key,
  reason text not null default 'manual',          -- unsubscribed | hard_bounce | spam | manual
  created_at timestamptz not null default now()
);

create or replace function public.normalize_email(value text)
returns text language sql immutable as $$
  select nullif(lower(trim(value)), '')
$$;

-- ---------------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------------
create table if not exists public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  trigger_event text not null check (trigger_event in ('new_lead', 'website_inquiry')),
  sender_email text not null,
  sender_name text not null default 'Sultan Ali Paracha, Kassam Trading Company',
  -- Replies go here. Connect this mailbox to Brevo Conversations to read them in Brevo.
  reply_to_email text,
  active boolean not null default false,
  -- Stop the sequence once the lead's CRM status reaches one of these.
  stop_on_client_statuses text[] not null default array['Engaged', 'Negotiating', 'Won', 'Lost'],
  created_at timestamptz not null default now()
);

create table if not exists public.email_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  step_number int not null check (step_number >= 1),
  -- Days to wait after the PREVIOUS step (after enrollment for step 1).
  delay_days numeric not null default 0 check (delay_days >= 0),
  subject text not null,
  body_html text not null,
  attachment_path text,
  attachment_name text,
  unique (sequence_id, step_number)
);

create table if not exists public.email_sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  client_id text,
  inquiry_id uuid,
  to_email text not null,
  to_name text,
  company text,
  country text,
  product_interest text,
  quantity text,
  current_step int not null default 0,
  next_send_at timestamptz not null default now(),
  status text not null default 'Active' check (status in ('Active', 'Completed', 'Stopped')),
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_sequence_enrollments_one_per_email
  on public.email_sequence_enrollments (sequence_id, public.normalize_email(to_email));
create index if not exists email_sequence_enrollments_due
  on public.email_sequence_enrollments (next_send_at) where status = 'Active';

-- ---------------------------------------------------------------------------
-- Monthly broadcasts (e.g. the rate sheet). Only sends while approved_through
-- is today or later, so an old price list is never mailed by accident.
-- ---------------------------------------------------------------------------
create table if not exists public.email_broadcasts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sender_email text not null,
  sender_name text not null default 'Sultan Ali Paracha, Kassam Trading Company',
  reply_to_email text,
  subject text not null,
  body_html text not null,
  attachment_path text,
  attachment_name text,
  audience_statuses text[] not null default array['New', 'Contacted', 'Engaged', 'Dormant'],
  audience_countries text[],                 -- null = all countries
  audience_product_keyword text,             -- matched (case-insensitive) inside clients.products_interest; null = all
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  send_hour_pkt int not null default 11 check (send_hour_pkt between 0 and 23),
  approved_through date,                     -- prices/copy approved until this date
  active boolean not null default false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

-- Outbox for broadcasts: filled in one go, drained within the daily send cap.
create table if not exists public.email_automation_queue (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid references public.email_broadcasts(id) on delete cascade,
  run_key text not null,                     -- e.g. '2026-10'
  client_id text,
  to_email text not null,
  to_name text,
  company text,
  country text,
  status text not null default 'Queued' check (status in ('Queued', 'Sent', 'Skipped', 'Failed')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists email_automation_queue_once_per_run
  on public.email_automation_queue (broadcast_id, run_key, to_email);  -- to_email is stored lower-cased
create index if not exists email_automation_queue_pending
  on public.email_automation_queue (created_at) where status = 'Queued';

-- Link sent messages back to the automation that produced them.
alter table public.email_messages
  add column if not exists enrollment_id uuid references public.email_sequence_enrollments(id) on delete set null,
  add column if not exists broadcast_id uuid references public.email_broadcasts(id) on delete set null,
  add column if not exists automation_kind text;   -- sequence | broadcast

-- ---------------------------------------------------------------------------
-- Auto-enrollment triggers
-- ---------------------------------------------------------------------------
create or replace function public.enroll_new_client_in_sequences()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.normalize_email(new.email) is null or coalesce(new.status, 'New') <> 'New' then
    return new;
  end if;

  insert into public.email_sequence_enrollments
    (sequence_id, client_id, to_email, to_name, company, country, product_interest, next_send_at)
  select s.id, new.id, public.normalize_email(new.email), new.contact, new.company, new.country,
         -- products_interest is an array in the CRM; flatten it to "Rice, Basmati"
         nullif(regexp_replace(coalesce(new.products_interest::text, ''), '[\[\]{}"]', '', 'g'), ''),
         now() + make_interval(secs => coalesce((
           select st.delay_days from public.email_sequence_steps st
           where st.sequence_id = s.id and st.step_number = 1), 0) * 86400)
  from public.email_sequences s
  where s.active and s.trigger_event = 'new_lead'
    and not exists (select 1 from public.email_suppressions x where x.email = public.normalize_email(new.email))
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists enroll_new_client_in_sequences on public.clients;
create trigger enroll_new_client_in_sequences
  after insert on public.clients
  for each row execute function public.enroll_new_client_in_sequences();

create or replace function public.enroll_inquiry_in_sequences()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.normalize_email(new.email) is null then
    return new;
  end if;

  insert into public.email_sequence_enrollments
    (sequence_id, inquiry_id, to_email, to_name, company, country, product_interest, quantity, next_send_at)
  select s.id, new.id, public.normalize_email(new.email), new.full_name, new.company_name, new.country,
         new.product_interest, new.quantity_estimate,
         now() + make_interval(secs => coalesce((
           select st.delay_days from public.email_sequence_steps st
           where st.sequence_id = s.id and st.step_number = 1), 0) * 86400)
  from public.email_sequences s
  where s.active and s.trigger_event = 'website_inquiry'
    and not exists (select 1 from public.email_suppressions x where x.email = public.normalize_email(new.email))
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists enroll_inquiry_in_sequences on public.public_inquiry_submissions;
create trigger enroll_inquiry_in_sequences
  after insert on public.public_inquiry_submissions
  for each row execute function public.enroll_inquiry_in_sequences();

-- ---------------------------------------------------------------------------
-- RLS: staff (authenticated) can read/manage; the Edge Function uses the
-- service role and bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.email_suppressions enable row level security;
alter table public.email_sequences enable row level security;
alter table public.email_sequence_steps enable row level security;
alter table public.email_sequence_enrollments enable row level security;
alter table public.email_broadcasts enable row level security;
alter table public.email_automation_queue enable row level security;

do $$
declare t text;
begin
  foreach t in array array['email_suppressions', 'email_sequences', 'email_sequence_steps',
                           'email_sequence_enrollments', 'email_broadcasts', 'email_automation_queue']
  loop
    execute format('drop policy if exists "Staff manage %1$s" on public.%1$I', t);
    execute format('create policy "Staff manage %1$s" on public.%1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Quick status view for the SQL editor
-- ---------------------------------------------------------------------------
create or replace view public.email_automation_status as
select s.name as sequence, s.active, e.status, count(*) as enrollments,
       min(e.next_send_at) filter (where e.status = 'Active') as next_due
from public.email_sequences s
left join public.email_sequence_enrollments e on e.sequence_id = s.id
group by s.name, s.active, e.status
order by s.name, e.status;

-- ---------------------------------------------------------------------------
-- Seed content (inactive until reviewed)
-- ---------------------------------------------------------------------------
insert into public.email_sequences (name, trigger_event, sender_email, active)
values
  ('New Lead Follow-Up', 'new_lead', 'exports@example.com', false),
  ('Website Inquiry Auto-Reply', 'website_inquiry', 'exports@example.com', false)
on conflict (name) do nothing;

insert into public.email_sequence_steps (sequence_id, step_number, delay_days, subject, body_html)
select s.id, v.step_number, v.delay_days, v.subject, v.body_html
from public.email_sequences s
join (values
  (1, 0, 'Pakistan rice supply for {{company}}',
   $html$<p>Dear {{contact}},</p>
<p>Kassam Trading Company has milled and exported Pakistani rice since 1999. We run our own processing mills at Port Qasim, Karachi, producing around 250 metric tons a day, and ship regularly to buyers in the Middle East, Africa and Asia.</p>
<p>Our range covers Basmati (1121, Super Kernel, PK-385), non-Basmati (IRRI-6, IRRI-9, PK-386, C-9 and 1121 Sella) and 100% broken rice, packed in 5 to 50 kg bags or under your own brand. We also supply Himalayan pink salt and sesame seeds.</p>
<p>If {{company}} is buying rice, I would be glad to send current prices. Please let me know the variety, quantity and destination port you have in mind.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Director, Kassam Trading Company<br>WhatsApp +92 300 820 1074 | kassamtradingcompany.com</p>$html$),
  (2, 4, 'Specifications and packing for {{company}}',
   $html$<p>Dear {{contact}},</p>
<p>A short follow-up to my earlier email. Buyers usually ask us about three things first, so here they are:</p>
<ul>
<li><strong>Quality control:</strong> every lot is Sortexed, fumigated and can be inspected by SGS or another agency of your choice before loading.</li>
<li><strong>Certification:</strong> ISO 9001:2015, ISO 22000:2018 and REAP registration.</li>
<li><strong>Shipping:</strong> FOB Port Qasim or CFR/CIF to your port, in 20ft or 40ft containers, with established lines including Maersk, MSC, COSCO and ONE.</li>
</ul>
<p>If it helps, I can send a sample or a full specification sheet for the variety you use.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company</p>$html$),
  (3, 6, 'Quick question about your rice requirement',
   $html$<p>Dear {{contact}},</p>
<p>I wanted to ask one simple question: which rice does {{company}} buy most often, and roughly how many containers a month?</p>
<p>With that, I can prepare a CFR quotation to your port rather than a general price list, which is usually more useful.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company</p>$html$),
  (4, 11, 'Closing the loop',
   $html$<p>Dear {{contact}},</p>
<p>I have not heard back, so I will assume the timing is not right for {{company}} at the moment and will not follow up further.</p>
<p>If a requirement comes up later, for rice, pink salt or sesame, just reply to this email and we will send current prices the same day.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company</p>$html$)
) as v(step_number, delay_days, subject, body_html) on true
where s.name = 'New Lead Follow-Up'
on conflict (sequence_id, step_number) do nothing;

insert into public.email_sequence_steps (sequence_id, step_number, delay_days, subject, body_html)
select s.id, v.step_number, v.delay_days, v.subject, v.body_html
from public.email_sequences s
join (values
  (1, 0, 'Your inquiry to Kassam Trading Company',
   $html$<p>Dear {{contact}},</p>
<p>Thank you for your inquiry about {{product}}. We have received it and our export team will reply with prices and availability within one working day.</p>
<p>To help us quote accurately, please reply with anything below that you have not already shared:</p>
<ul>
<li>Variety and specification (e.g. broken percentage, grain length)</li>
<li>Quantity per shipment and how often you buy</li>
<li>Packing (bag size, plain or private label)</li>
<li>Destination port and preferred terms (FOB, CFR or CIF)</li>
</ul>
<p>For anything urgent, you can reach Sultan Ali Paracha on WhatsApp at +92 300 820 1074.</p>
<p>Best regards,<br>Kassam Trading Company<br>Port Qasim, Karachi, Pakistan | kassamtradingcompany.com</p>$html$),
  (2, 3, 'Following up on your {{product}} inquiry',
   $html$<p>Dear {{contact}},</p>
<p>I am following up on your recent inquiry to make sure our quotation reached you and answered your questions.</p>
<p>If you would like a revised price for a different quantity, packing or destination port, or would like a sample before ordering, please let me know and I will arrange it.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Director, Kassam Trading Company<br>WhatsApp +92 300 820 1074</p>$html$)
) as v(step_number, delay_days, subject, body_html) on true
where s.name = 'Website Inquiry Auto-Reply'
on conflict (sequence_id, step_number) do nothing;

insert into public.email_broadcasts (name, sender_email, subject, body_html, audience_product_keyword, day_of_month, send_hour_pkt, active)
values (
  'Monthly Rice Offer',
  'exports@example.com',
  'Pakistan IRRI-6 rice offer for {{month}} | FOB Port Qasim',
  $html$<p>Dear {{contact}},</p>
<p>Please find our rice offer for {{month}}.</p>
<p><strong>IRRI-6 Long Grain White Rice, 5% Broken</strong><br>Well milled, silky polished, Sortexed<br>USD [PRICE] per MT, FOB Port Qasim, Karachi</p>
<p><strong>IRRI-6 Long Grain White Rice, 100% Broken</strong><br>Well milled, polished, Sortexed, fumigated<br>USD [PRICE] per MT, FOB Port Qasim, Karachi</p>
<p><strong>Terms</strong><br>
Packing: 25 kg or 50 kg PP bags<br>
Quantity: 250 to 1,000 MT (10 to 40 x 20ft FCL)<br>
Inspection: SGS<br>
Validity: until [VALIDITY DATE]</p>
<p>FOB ocean freight is for the buyer's account. CFR/CIF prices are available on request and are based on the shipping line's rate on the booking date; any surcharges imposed by shipping lines after shipment are for the buyer's account.</p>
<p>Reply with your quantity and destination port and we will send a CFR quotation.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Director, Kassam Trading Company<br>WhatsApp +92 300 820 1074 | kassamtradingcompany.com</p>$html$,
  'rice',
  1,
  11,
  false
)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Shared secret for cron -> Edge Function calls and unsubscribe links.
-- Generated inside the database and kept in Vault; nobody has to copy it.
-- Edge Functions read it through ktc_automation_secret() (service role only).
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ktc_automation_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ktc_automation_secret');
  end if;
  if not exists (select 1 from vault.secrets where name = 'ktc_project_url') then
    perform vault.create_secret('https://your-project-ref.supabase.co', 'ktc_project_url');
  end if;
end $$;

create or replace function public.ktc_automation_secret()
returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ktc_automation_secret'
$$;
revoke all on function public.ktc_automation_secret() from public, anon, authenticated;
grant execute on function public.ktc_automation_secret() to service_role;

-- ---------------------------------------------------------------------------
-- Scheduler: every 10 minutes, call the Edge Function. Reads the project URL
-- and shared secret from Vault (created above).
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('ktc-email-automation')
  where exists (select 1 from cron.job where jobname = 'ktc-email-automation');
  perform cron.unschedule('ktc-check-email-replies')
  where exists (select 1 from cron.job where jobname = 'ktc-check-email-replies');
end $$;

select cron.schedule(
  'ktc-check-email-replies',
  '5,35 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ktc_project_url')
           || '/functions/v1/check-email-replies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ktc_automation_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'ktc-email-automation',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ktc_project_url')
           || '/functions/v1/run-email-automation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ktc_automation_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
