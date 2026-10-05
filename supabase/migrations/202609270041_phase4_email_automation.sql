-- Phase 4: buyer email automation (2026-09-27)
--
-- Builds on the email automation engine (202609270001, run-email-automation):
--   * Website inquiry acknowledgement: existing "Website Inquiry Auto-Reply", now ON;
--     its day-3 email is reworded so it reads correctly whether or not we have replied.
--   * Quote follow-ups: new "Quotation Follow-Up" sequence (day 3, 7, 14) that starts
--     when an inquiry is marked 'Quote Sent' and stops when the inquiry moves on.
--   * Dormant re-engagement: new two-email sequence, started only by staff clicking
--     "Re-engage" (reengage_clients).
--   * Shipment update: one email to the buyer when an order is marked Shipped, sent
--     2 hours later (time to add vessel/ETA or undo a mistaken tap) by staff-notifier.
-- Every sequence stops when the buyer replies by email or WhatsApp; the acknowledgement
-- and cold sequences also stop once staff log that they've replied or followed up.
-- Bounces, spam complaints and unsubscribes are recorded on the buyer (email_status)
-- and on their timeline. No automated email contains prices, contracts or bank details.
--
-- Also: auto-captured inquirers are now 'Engaged' (the standard pipeline status)
-- instead of 'Hot'.
--
-- Apply with the SQL editor or `supabase db query --linked -f <this file>`. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
alter table public.email_sequences drop constraint if exists email_sequences_trigger_event_check;
alter table public.email_sequences add constraint email_sequences_trigger_event_check
  check (trigger_event in ('new_lead', 'website_inquiry', 'quote_sent', 'manual_reengage'));

alter table public.email_sequence_enrollments
  add column if not exists crm_inquiry_id text references public.inquiries(id) on delete set null;

alter table public.clients add column if not exists email_status text not null default 'ok';
alter table public.clients drop constraint if exists clients_email_status_check;
alter table public.clients add constraint clients_email_status_check
  check (email_status in ('ok', 'bounced', 'unsubscribed', 'complained'));

create table if not exists public.buyer_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('shipment_update')),
  client_id text references public.clients(id) on delete cascade,
  order_id text references public.orders(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  email_message_id uuid,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists buyer_notifications_due_idx on public.buyer_notifications (scheduled_for) where status in ('pending', 'failed');

alter table public.buyer_notifications enable row level security;
drop policy if exists "staff read" on public.buyer_notifications;
create policy "staff read" on public.buyer_notifications
  for select to authenticated using ((select public.is_staff()));

-- First usable address from a client's email field (some hold several).
create or replace function public.primary_email(p_emails text)
returns text
language sql
immutable
as $$
  select public.normalize_email(e)
  from unnest(regexp_split_to_array(coalesce(p_emails, ''), '[\s,;]+')) with ordinality as t(e, n)
  where e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  order by n limit 1
$$;

-- ---------------------------------------------------------------------------
-- 2. Sequences and their emails (personal style, no prices)
-- ---------------------------------------------------------------------------
insert into public.email_sequences (name, trigger_event, sender_email, sender_name, reply_to_email, active, stop_on_client_statuses)
values
  ('Quotation Follow-Up', 'quote_sent', 'exports@example.com', 'Sultan Ali Paracha',
   'exports@example.com', true, array['Negotiating', 'Won', 'Lost']),
  ('Dormant Re-Engagement', 'manual_reengage', 'exports@example.com', 'Sultan Ali Paracha',
   'exports@example.com', true, array['Negotiating', 'Won', 'Lost'])
on conflict (name) do nothing;

insert into public.email_sequence_steps (sequence_id, step_number, delay_days, subject, body_html)
select s.id, v.step_number, v.delay_days, v.subject, v.body_html
from public.email_sequences s
join (values
  (1, 3, 'Your {{product}} quotation',
   $html$<p>Dear {{contact}},</p>
<p>I wanted to make sure our quotation for {{product}} reached you and to ask whether it fits what {{company}} needs.</p>
<p>If the quantity, packing or destination port has changed, tell me and I will revise the offer the same day.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company, Karachi</p>$html$),
  (2, 4, 'Re: Your {{product}} quotation',
   $html$<p>Dear {{contact}},</p>
<p>Following up on the {{product}} offer. If it would help your decision, we can send a sample from the current lot, a full specification sheet, or arrange inspection by SGS or another agency before loading.</p>
<p>A short reply with your thoughts on the offer would help me plan our production schedule.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company</p>$html$),
  (3, 7, 'Is the {{product}} requirement still open?',
   $html$<p>Dear {{contact}},</p>
<p>I have not heard back about our {{product}} quotation, so I will assume the timing is not right for {{company}} at the moment.</p>
<p>When you are ready to buy, reply to this email and I will send an updated offer based on the latest crop and freight rates.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company</p>$html$)
) as v(step_number, delay_days, subject, body_html) on true
where s.name = 'Quotation Follow-Up'
on conflict (sequence_id, step_number) do nothing;

insert into public.email_sequence_steps (sequence_id, step_number, delay_days, subject, body_html)
select s.id, v.step_number, v.delay_days, v.subject, v.body_html
from public.email_sequences s
join (values
  (1, 0, 'Checking in from Kassam Trading Company',
   $html$<p>Dear {{contact}},</p>
<p>It has been a while since we last spoke, so I wanted to check whether {{company}} has any upcoming requirement for {{product}}.</p>
<p>This season's crop is milled and ready at our Port Qasim units, and we can quote FOB Karachi or CFR/CIF to your port. If you send the variety, quantity and destination, I will reply with an offer the same day.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company, Karachi</p>$html$),
  (2, 7, 'Re: Checking in from Kassam Trading Company',
   $html$<p>Dear {{contact}},</p>
<p>A brief follow-up to my last email. If {{product}} is no longer on your list, I would be glad to hear what {{company}} is buying now; we also supply Himalayan pink salt, sesame seeds and maize.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company</p>$html$)
) as v(step_number, delay_days, subject, body_html) on true
where s.name = 'Dormant Re-Engagement'
on conflict (sequence_id, step_number) do nothing;

-- Acknowledgement ON; day-3 email reads correctly whether or not we've replied yet.
update public.email_sequences set active = true where name = 'Website Inquiry Auto-Reply';
update public.email_sequence_steps st
set body_html = $html$<p>Dear {{contact}},</p>
<p>Following up on your inquiry about {{product}}. If our offer has reached you, I would welcome your thoughts on it. If you have not heard from us yet, please reply to this email or message me on WhatsApp at +92 300 820 1074 and I will send it straight away.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company</p>$html$
from public.email_sequences s
where s.id = st.sequence_id and s.name = 'Website Inquiry Auto-Reply' and st.step_number = 2;

-- ---------------------------------------------------------------------------
-- 3. Quote follow-ups: start on 'Quote Sent', stop when the inquiry moves on
-- ---------------------------------------------------------------------------
create or replace function public.sync_quote_followups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seq public.email_sequences;
  c public.clients;
  v_email text;
  v_product text;
begin
  select * into seq from public.email_sequences where trigger_event = 'quote_sent' and active limit 1;
  if not found then return new; end if;

  if new.status = 'Quote Sent' and old.status is distinct from 'Quote Sent' then
    select * into c from public.clients where id = new.client_id;
    v_email := public.primary_email(c.email);
    if v_email is null or c.email_status <> 'ok'
       or exists (select 1 from public.email_suppressions x where x.email = v_email) then
      return new;
    end if;
    v_product := coalesce(
      (select string_agg(distinct ii.product_name, ', ') from public.inquiry_items ii where ii.inquiry_id = new.id),
      nullif(new.product_interest, ''),
      'your requirement');

    insert into public.email_sequence_enrollments
      (sequence_id, client_id, crm_inquiry_id, to_email, to_name, company, country, product_interest, quantity,
       current_step, next_send_at, status)
    values
      (seq.id, c.id, new.id, v_email, c.contact, c.company, c.country, v_product, new.quantity_estimate,
       0, now() + interval '3 days', 'Active')
    on conflict (sequence_id, public.normalize_email(to_email)) do update
      set client_id = excluded.client_id, crm_inquiry_id = excluded.crm_inquiry_id,
          to_name = excluded.to_name, company = excluded.company, country = excluded.country,
          product_interest = excluded.product_interest, quantity = excluded.quantity,
          current_step = 0, next_send_at = excluded.next_send_at, status = 'Active',
          stop_reason = null, updated_at = now();

    perform public.log_interaction(c.id, new.id, 'system', 'internal',
      'Quote follow-up emails scheduled (day 3, 7 and 14)', null);

  elsif old.status = 'Quote Sent' and new.status is distinct from 'Quote Sent' then
    update public.email_sequence_enrollments
      set status = 'Stopped', stop_reason = 'inquiry moved to ' || coalesce(new.status, 'another stage'), updated_at = now()
      where crm_inquiry_id = new.id and status = 'Active';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_quote_followups on public.inquiries;
create trigger sync_quote_followups
after update of status on public.inquiries
for each row execute function public.sync_quote_followups();

-- ---------------------------------------------------------------------------
-- 4. Stop sequences when the buyer engages or staff take over
-- ---------------------------------------------------------------------------
create or replace function public.stop_sequences_on_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events text[];
  v_reason text;
  v_emails text[];
begin
  if new.direction = 'in' and new.channel in ('email', 'whatsapp', 'call', 'meeting') then
    -- The buyer answered: every automated sequence to them stops.
    v_events := array['new_lead', 'website_inquiry', 'quote_sent', 'manual_reengage'];
    v_reason := 'buyer replied (' || new.channel || ')';
  elsif new.direction = 'in' and new.channel = 'website' then
    -- A fresh website inquiry replaces cold outreach (its own acknowledgement continues).
    v_events := array['new_lead', 'manual_reengage'];
    v_reason := 'website inquiry received';
  elsif new.direction = 'out' and new.created_by is not null
        and new.channel in ('email', 'whatsapp', 'call', 'meeting') then
    -- Staff replied personally: no more acknowledgement or cold emails.
    -- Quote follow-ups keep running until the buyer answers or the inquiry moves on.
    v_events := array['new_lead', 'website_inquiry', 'manual_reengage'];
    v_reason := 'staff followed up (' || new.channel || ')';
  else
    return new;
  end if;

  select array_agg(public.normalize_email(e)) into v_emails
  from public.clients c, unnest(regexp_split_to_array(coalesce(c.email, ''), '[\s,;]+')) e
  where c.id = new.client_id and e like '%@%';

  update public.email_sequence_enrollments en
    set status = 'Stopped', stop_reason = v_reason, updated_at = now()
    from public.email_sequences s
    where s.id = en.sequence_id and en.status = 'Active' and s.trigger_event = any(v_events)
      and (en.client_id = new.client_id or public.normalize_email(en.to_email) = any(coalesce(v_emails, '{}')));
  return new;
end;
$$;

drop trigger if exists stop_sequences_on_interaction on public.client_interactions;
create trigger stop_sequences_on_interaction
after insert on public.client_interactions
for each row execute function public.stop_sequences_on_interaction();

-- ---------------------------------------------------------------------------
-- 5. Bounces / complaints / unsubscribes on the buyer record
-- ---------------------------------------------------------------------------
create or replace function public.mark_client_email_suppressed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_status text := case
    when new.reason in ('hard_bounce', 'bounced', 'invalid') then 'bounced'
    when new.reason in ('spam', 'complaint') then 'complained'
    else 'unsubscribed' end;
begin
  for c in
    select id from public.clients
    where public.normalize_email(new.email) = any(
      select public.normalize_email(e) from unnest(regexp_split_to_array(coalesce(email, ''), '[\s,;]+')) e)
  loop
    update public.clients set email_status = v_status where id = c.id;
    perform public.log_interaction(c.id, null, 'system', 'internal',
      format('Email %s: %s — no more automated emails', v_status, new.email), null,
      'email_suppressions', new.email || ':' || c.id);
  end loop;
  return new;
end;
$$;

drop trigger if exists mark_client_email_suppressed on public.email_suppressions;
create trigger mark_client_email_suppressed
after insert on public.email_suppressions
for each row execute function public.mark_client_email_suppressed();

-- ---------------------------------------------------------------------------
-- 6. Shipment update email (queued on Shipped, sent 2 hours later)
-- ---------------------------------------------------------------------------
create or replace function public.queue_shipment_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'Shipped' and old.status is distinct from 'Shipped' and new.client_id is not null then
    insert into public.buyer_notifications (kind, client_id, order_id, scheduled_for, dedupe_key)
    values ('shipment_update', new.client_id, new.id, now() + interval '2 hours', 'shipped:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists queue_shipment_update on public.orders;
create trigger queue_shipment_update
after update of status on public.orders
for each row execute function public.queue_shipment_update();

-- Content is built at send time so it uses the latest shipment details.
-- Returns null (skip) if the order is no longer at/after Shipped, or the buyer
-- has no usable email.
create or replace function public.shipment_email_content(p_notification_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n public.buyer_notifications;
  o public.orders;
  c public.clients;
  s public.shipments;
  v_email text;
  v_items text;
  rows text := '';
begin
  select * into n from public.buyer_notifications where id = p_notification_id;
  select * into o from public.orders where id = n.order_id;
  if o.id is null or o.status not in ('Shipped', 'Balance Payment Received', 'Delivered & Closed') then
    return jsonb_build_object('skip', 'order is not shipped');
  end if;
  select * into c from public.clients where id = o.client_id;
  v_email := public.primary_email(c.email);
  if v_email is null then return jsonb_build_object('skip', 'buyer has no email'); end if;
  if c.email_status <> 'ok' or exists (select 1 from public.email_suppressions x where x.email = v_email) then
    return jsonb_build_object('skip', 'buyer email suppressed');
  end if;

  select * into s from public.shipments where order_id = o.id order by created_at desc nulls last limit 1;
  select string_agg(format('%s%s', oi.product_name, case when oi.quantity_mt is not null then ' — ' || oi.quantity_mt || ' MT' else '' end), '<br>')
    into v_items from public.order_items oi where oi.order_id = o.id;

  rows := concat_ws('',
    case when v_items is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">Goods</td><td>%s</td></tr>', v_items) end,
    format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">From</td><td>%s</td></tr>', coalesce(nullif(o.pol_port, ''), 'Port Qasim, Karachi')),
    case when nullif(o.pod_port, '') is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">To</td><td>%s</td></tr>', o.pod_port) end,
    case when nullif(s.shipping_line, '') is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">Shipping line</td><td>%s</td></tr>', s.shipping_line) end,
    case when nullif(s.vessel_voyage, '') is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">Vessel / voyage</td><td>%s</td></tr>', s.vessel_voyage) end,
    case when nullif(s.container_number, '') is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">Container</td><td>%s</td></tr>', s.container_number) end,
    case when nullif(s.bl_number, '') is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">Bill of lading</td><td>%s</td></tr>', s.bl_number) end,
    case when s.etd is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">Departed</td><td>%s</td></tr>', to_char(s.etd, 'DD Mon YYYY')) end,
    case when s.eta is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">Expected arrival</td><td>%s</td></tr>', to_char(s.eta, 'DD Mon YYYY')) end,
    case when nullif(s.tracking_url, '') is not null then format('<tr><td style="padding:4px 12px 4px 0;color:#5C6760">Track</td><td><a href="%s">%s</a></td></tr>', s.tracking_url, s.tracking_url) end);

  return jsonb_build_object(
    'client_id', c.id,
    'to', v_email,
    'to_name', c.contact,
    'subject', format('Your order %s has shipped', o.id),
    'html', format($h$<p>Dear %s,</p>
<p>Your order %s has been loaded and shipped. The details are below.</p>
<table style="border-collapse:collapse;font-size:15px">%s</table>
<p>We will send the shipping documents separately. If anything here does not match your records, please reply to this email.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company, Karachi</p>$h$,
      coalesce(nullif(btrim(c.contact), ''), 'Sir/Madam'), o.id, rows),
    'sender_email', 'exports@example.com',
    'sender_name', 'Sultan Ali Paracha');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Re-engage dormant buyers (staff click)
-- ---------------------------------------------------------------------------
create or replace function public.reengage_clients(p_client_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  seq public.email_sequences;
  c public.clients;
  v_email text;
  started integer := 0;
  skipped jsonb := '[]'::jsonb;
begin
  if not public.can_edit() then raise exception 'Not authorised'; end if;
  if coalesce(array_length(p_client_ids, 1), 0) > 200 then raise exception 'Choose at most 200 buyers at a time'; end if;
  select * into seq from public.email_sequences where trigger_event = 'manual_reengage' and active limit 1;
  if not found then raise exception 'The re-engagement sequence is switched off'; end if;

  for c in select * from public.clients where id = any(p_client_ids) loop
    v_email := public.primary_email(c.email);
    if v_email is null then
      skipped := skipped || jsonb_build_object('company', c.company, 'reason', 'no email');
      continue;
    end if;
    if c.email_status <> 'ok' or exists (select 1 from public.email_suppressions x where x.email = v_email) then
      skipped := skipped || jsonb_build_object('company', c.company, 'reason', 'email bounced or unsubscribed');
      continue;
    end if;
    if exists (select 1 from public.email_sequence_enrollments e
               where public.normalize_email(e.to_email) = v_email and e.status = 'Active') then
      skipped := skipped || jsonb_build_object('company', c.company, 'reason', 'already in an email sequence');
      continue;
    end if;
    if exists (select 1 from public.email_sequence_enrollments e
               where e.sequence_id = seq.id and public.normalize_email(e.to_email) = v_email
                 and e.updated_at > now() - interval '60 days') then
      skipped := skipped || jsonb_build_object('company', c.company, 'reason', 're-engaged in the last 60 days');
      continue;
    end if;

    insert into public.email_sequence_enrollments
      (sequence_id, client_id, to_email, to_name, company, country, product_interest, current_step, next_send_at, status)
    values
      (seq.id, c.id, v_email, c.contact, c.company, c.country,
       coalesce(nullif(regexp_replace(coalesce(c.products_interest::text, ''), '[\[\]{}"]', '', 'g'), ''), 'rice'),
       0, now(), 'Active')
    on conflict (sequence_id, public.normalize_email(to_email)) do update
      set client_id = excluded.client_id, to_name = excluded.to_name, company = excluded.company,
          country = excluded.country, product_interest = excluded.product_interest,
          current_step = 0, next_send_at = now(), status = 'Active', stop_reason = null, updated_at = now();

    perform public.log_interaction(c.id, null, 'system', 'internal', 'Re-engagement emails started', null);
    started := started + 1;
  end loop;

  return jsonb_build_object('started', started, 'skipped', skipped);
end;
$$;

-- Staff can stop every automated email to one buyer (client profile button).
create or replace function public.stop_client_sequences(p_client_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.can_edit() then raise exception 'Not authorised'; end if;
  update public.email_sequence_enrollments en
    set status = 'Stopped', stop_reason = 'stopped by staff', updated_at = now()
    where en.status = 'Active'
      and (en.client_id = p_client_id
           or public.normalize_email(en.to_email) in (
             select public.normalize_email(e) from public.clients c,
                    unnest(regexp_split_to_array(coalesce(c.email, ''), '[\s,;]+')) e
             where c.id = p_client_id and e like '%@%'));
  get diagnostics n = row_count;
  if n > 0 then
    perform public.log_interaction(p_client_id, null, 'system', 'internal', 'Automated emails stopped by staff', null);
  end if;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. "I sent a price quotation" from Today (replaces the Phase 3 version)
-- ---------------------------------------------------------------------------
drop function if exists public.log_client_followup(text, integer, text, text);
create or replace function public.log_client_followup(
  p_client_id text,
  p_next_in_days integer default 7,
  p_note text default null,
  p_channel text default 'whatsapp',
  p_quote_sent boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_date date;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  author text;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if p_next_in_days is null or p_next_in_days < 1 or p_next_in_days > 365 then
    raise exception 'Next follow-up must be 1 to 365 days away';
  end if;
  if p_channel not in ('whatsapp', 'call', 'email', 'meeting', 'note') then raise exception 'Unknown channel'; end if;
  if clean_note is not null and char_length(clean_note) > 2000 then raise exception 'Note is too long'; end if;

  next_date := (now() at time zone 'Asia/Karachi')::date + p_next_in_days;
  select coalesce(nullif(full_name, ''), email) into author from public.profiles where id = auth.uid();

  update public.clients
  set last_contacted_at = now(), last_activity = now(), next_followup_at = next_date,
      status = case when status in ('New', 'Contacted', 'Dormant') then 'Engaged' else status end
  where id = p_client_id;
  if not found then raise exception 'Buyer not found'; end if;

  perform public.log_interaction(p_client_id, null, p_channel, 'out',
    format('%s by %s%s', case p_channel when 'whatsapp' then 'WhatsApp follow-up' when 'call' then 'Call'
                                        when 'email' then 'Email follow-up' when 'meeting' then 'Meeting'
                                        else 'Note' end, coalesce(author, 'staff'),
           case when p_quote_sent then ' — price quotation sent' else '' end),
    clean_note);

  update public.tasks set status = 'Done', updated_at = now()
  where client_id = p_client_id and source = 'auto' and status <> 'Done';

  update public.inquiries
    set status = case when p_quote_sent then 'Quote Sent' else 'Pending Response' end,
        replied_at = coalesce(replied_at, now())
  where client_id = p_client_id
    and (status = 'New' or (p_quote_sent and status in ('Pending Response', 'In Negotiation')));

  return jsonb_build_object('id', p_client_id, 'next_followup_at', next_date, 'quote_sent', p_quote_sent);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Inbound inquirers are 'Engaged' in the standard pipeline (was 'Hot')
-- ---------------------------------------------------------------------------
-- capture_inquiry is re-created below with that single change.
create or replace function public.capture_inquiry(
  p_channel text,
  p_company text, p_contact text, p_email text, p_phone text, p_country text,
  p_product text, p_quantity text, p_message text,
  p_source_table text default null, p_source_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.normalize_email(p_email);
  v_phone text := public.normalize_phone(p_phone, p_country);
  v_label text;
  v_client public.clients;
  v_created boolean := false;
  v_inquiry_id text;
  v_task_id uuid;
  v_due timestamptz := now() + interval '4 hours';
  v_ref text := case when p_source_table is not null and p_source_id is not null
                     then p_source_table || ':' || p_source_id end;
  v_channel_label text := case p_channel when 'website' then 'Website' when 'email' then 'Email'
                                         when 'whatsapp' then 'WhatsApp' else 'Manual' end;
  v_interest text := concat_ws(' · ', nullif(btrim(p_product), ''), nullif(btrim(p_quantity), ''));
  v_existing record;
begin
  if p_channel not in ('website', 'email', 'whatsapp', 'manual') then raise exception 'Unknown channel %', p_channel; end if;

  if v_ref is not null then
    select id, client_id into v_existing from public.inquiries where source_ref = v_ref;
    if found then
      return jsonb_build_object('client_id', v_existing.client_id, 'inquiry_id', v_existing.id, 'duplicate', true);
    end if;
  end if;

  v_label := coalesce(nullif(btrim(p_company), ''), nullif(btrim(p_contact), ''), v_email, v_phone);
  if v_label is null then raise exception 'Need a company, name, email or phone'; end if;

  select * into v_client from public.clients c
  where public.company_key(c.company) = public.company_key(v_label)
  order by c.created_at limit 1;

  if not found then
    insert into public.clients
      (id, company, contact, email, phone, whatsapp_number, country, source, products_interest,
       status, score, last_activity, contact_method)
    values
      (public.next_client_id(), left(v_label, 200), nullif(btrim(p_contact), ''), v_email, v_phone,
       case when p_channel = 'whatsapp' then v_phone end, nullif(btrim(p_country), ''),
       v_channel_label || ' inquiry',
       case when nullif(btrim(p_product), '') is not null then array[btrim(p_product)] else '{}'::text[] end,
       'Engaged', 70, now(), case when p_channel = 'whatsapp' then 'WhatsApp' else 'Email' end)
    returning * into v_client;
    v_created := true;
  else
    update public.clients set
      contact = coalesce(contact, nullif(btrim(p_contact), '')),
      email = coalesce(nullif(email, ''), v_email),
      phone = coalesce(nullif(phone, ''), v_phone),
      whatsapp_number = coalesce(nullif(whatsapp_number, ''), case when p_channel = 'whatsapp' then v_phone end),
      country = coalesce(nullif(country, ''), nullif(btrim(p_country), '')),
      last_activity = now()
    where id = v_client.id
    returning * into v_client;
  end if;

  v_inquiry_id := public.next_inquiry_id();
  insert into public.inquiries
    (id, client_id, status, notes, source_channel, source_ref, product_interest, quantity_estimate, reply_due_at)
  values
    (v_inquiry_id, v_client.id, 'New', left(nullif(btrim(p_message), ''), 5000), p_channel, v_ref,
     nullif(btrim(p_product), ''), nullif(btrim(p_quantity), ''), v_due);

  insert into public.tasks
    (title, description, category, priority, status, due_date, due_at, client_id, inquiry_id, source)
  values
    (format('Reply to %s (%s inquiry)', v_client.company, v_channel_label),
     left(concat_ws(E'\n', nullif(v_interest, ''), nullif(btrim(p_message), '')), 2000),
     'Follow-up', 'High', 'Todo', (v_due at time zone 'Asia/Karachi')::date, v_due,
     v_client.id, v_inquiry_id, 'auto')
  returning id into v_task_id;

  perform public.log_interaction(
    v_client.id, v_inquiry_id, case when p_channel = 'manual' then 'note' else p_channel end, 'in',
    format('%s inquiry%s', v_channel_label, case when v_interest <> '' then ': ' || v_interest else '' end),
    p_message, coalesce(p_source_table, 'inquiries'), coalesce(p_source_id, v_inquiry_id));

  perform public.notify_staff(
    'new_inquiry', 'inquiry:' || v_inquiry_id,
    format('New %s inquiry: %s%s', lower(v_channel_label), v_client.company,
           case when v_client.country is not null then ' (' || v_client.country || ')' else '' end),
    concat_ws(E'\n',
      format('%s sent an inquiry via %s.', v_client.company, v_channel_label),
      case when v_interest <> '' then 'Interested in: ' || v_interest end,
      case when nullif(btrim(p_message), '') is not null then 'Message: ' || left(btrim(p_message), 1000) end,
      concat_ws(' · ', nullif(v_client.contact, ''), nullif(v_client.email, ''), nullif(v_client.phone, '')),
      format('Reply due by %s Karachi time.', to_char(v_due at time zone 'Asia/Karachi', 'Dy DD Mon, HH12:MI AM'))),
    jsonb_build_array(
      v_client.company,
      coalesce(v_client.country, 'country not given'),
      v_channel_label,
      coalesce(nullif(v_interest, ''), 'not specified'),
      to_char(v_due at time zone 'Asia/Karachi', 'Dy HH12:MI AM') || ' PKT'));

  return jsonb_build_object('client_id', v_client.id, 'inquiry_id', v_inquiry_id, 'task_id', v_task_id,
                            'created_client', v_created);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Access
-- ---------------------------------------------------------------------------
revoke execute on function
  public.sync_quote_followups(), public.stop_sequences_on_interaction(), public.mark_client_email_suppressed(),
  public.queue_shipment_update(), public.shipment_email_content(uuid)
from public, anon, authenticated;
grant execute on function public.shipment_email_content(uuid) to service_role;

revoke execute on function public.reengage_clients(text[]), public.log_client_followup(text, integer, text, text, boolean),
  public.primary_email(text), public.stop_client_sequences(text)
from public, anon;
grant execute on function public.reengage_clients(text[]), public.log_client_followup(text, integer, text, text, boolean),
  public.primary_email(text), public.stop_client_sequences(text)
to authenticated;

commit;
