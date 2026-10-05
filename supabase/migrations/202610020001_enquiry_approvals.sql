-- Enquiry approvals (2026-10-02)
--
-- Every new buyer enquiry waits for a staff decision before it becomes a CRM buyer:
--   * WhatsApp Business number: a message from an unknown number opens an enquiry
--     ("awaiting_form"), gets one greeting with a link to a short form, and moves to
--     "pending" when the buyer submits the form (or is flagged for staff after 2 hours).
--   * Website form (/quote): goes straight to "pending".
-- Staff see the queue on /approvals:
--   * Approve -> buyer + inquiry + task are created (capture_inquiry) and the buyer is told
--     on WhatsApp to message the Director directly.
--   * Reject  -> nothing is sent; staff get a polite message to send themselves.
-- Existing buyers who message on WhatsApp are linked to their record as before.
--
-- Buyer messages go through public.whatsapp_outbox, sent every minute by the Edge
-- Function send-whatsapp-outbox (free text inside Meta's 24-hour window, otherwise an
-- approved template). The Director's name and WhatsApp number live in
-- public.enquiry_settings (Settings -> WhatsApp enquiries), never in this file.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.enquiry_settings (
  id integer primary key default 1 check (id = 1),
  director_name text not null default 'our Director',
  director_whatsapp text,
  form_base_url text not null default 'https://ktc-trade-manager.vercel.app',
  greeting_text text not null default
    'Hello {name}, thank you for contacting Kassam Trading Company, rice, salt and sesame exporters from Karachi, Pakistan. '
    'Please share your requirement through this short form so our team can review it: {link} '
    'Once it has been reviewed, we will connect you with the right person.',
  received_text text not null default
    'Hello {name}, thank you. We have received your enquiry {ref}. Our team will review it and get back to you shortly.',
  approved_text text not null default
    'Hello {name}, your enquiry {ref} has been reviewed. Please message our Director, {director_name}, directly on WhatsApp '
    'at {director_whatsapp} ({director_link}) to discuss pricing and shipment details. He is expecting your message.',
  rejected_text text not null default
    'Hello {name}, thank you for your interest in Kassam Trading Company. We have reviewed your enquiry {ref}, and we are '
    'not able to take this particular requirement forward at the moment. We value the contact and would be glad to work '
    'with you on future rice, salt or sesame requirements, so please keep us in mind and message us anytime.',
  greet_again_after interval not null default interval '7 days',
  updated_at timestamptz not null default now()
);
insert into public.enquiry_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.enquiry_reviews (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  channel text not null check (channel in ('whatsapp', 'website')),
  status text not null default 'awaiting_form'
    check (status in ('awaiting_form', 'pending', 'approved', 'rejected')),
  whatsapp_number text,
  contact_name text,
  company text,
  country text,
  email text,
  product text,
  quantity text,
  destination_port text,
  message text,
  risk_flags text[] not null default '{}',
  form_token text not null unique,
  form_submitted_at timestamptz,
  last_buyer_message_at timestamptz,
  alerted_at timestamptz,
  source_table text,
  source_id text,
  client_id text references public.clients(id) on delete set null,
  inquiry_id text references public.inquiries(id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_note text,
  reply_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists enquiry_reviews_status_idx on public.enquiry_reviews (status, created_at desc);
create index if not exists enquiry_reviews_number_idx
  on public.enquiry_reviews (regexp_replace(coalesce(whatsapp_number, ''), '\D', '', 'g'));

create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null,
  kind text not null check (kind in ('greeting', 'received', 'approved', 'custom')),
  body text not null,
  template_name text,
  template_params jsonb not null default '[]'::jsonb,
  enquiry_id uuid references public.enquiry_reviews(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'needs_template')),
  attempts integer not null default 0,
  last_error text,
  wa_message_id text,
  scheduled_for timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists whatsapp_outbox_due_idx on public.whatsapp_outbox (scheduled_for) where status in ('pending', 'failed');
create index if not exists whatsapp_outbox_number_idx
  on public.whatsapp_outbox (regexp_replace(to_phone, '\D', '', 'g'), kind, created_at desc);

alter table public.inbound_whatsapp
  add column if not exists enquiry_id uuid references public.enquiry_reviews(id) on delete set null;

-- Enquiry alerts get their own WhatsApp template (ktc_enquiry_review).
alter table public.staff_notifications drop constraint if exists staff_notifications_kind_check;
alter table public.staff_notifications add constraint staff_notifications_kind_check
  check (kind in ('new_inquiry', 'buyer_message', 'followup_overdue', 'daily_digest', 'enquiry_review'));

-- ---------------------------------------------------------------------------
-- 2. Row level security: read for staff; changes only through the functions below
-- ---------------------------------------------------------------------------
alter table public.enquiry_settings enable row level security;
alter table public.enquiry_reviews enable row level security;
alter table public.whatsapp_outbox enable row level security;

drop policy if exists "staff read" on public.enquiry_settings;
create policy "staff read" on public.enquiry_settings for select to authenticated using ((select public.is_staff()));
drop policy if exists "admin update" on public.enquiry_settings;
create policy "admin update" on public.enquiry_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "staff read" on public.enquiry_reviews;
create policy "staff read" on public.enquiry_reviews for select to authenticated using ((select public.is_staff()));

drop policy if exists "staff read" on public.whatsapp_outbox;
create policy "staff read" on public.whatsapp_outbox for select to authenticated using ((select public.is_staff()));

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.next_enquiry_ref()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer := extract(year from now() at time zone 'Asia/Karachi')::integer;
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('ktc_next_enquiry_ref'));
  select coalesce(max((regexp_match(ref, '^ENQ-\d{4}-(\d+)$'))[1]::integer), 0) + 1
    into n from public.enquiry_reviews where ref like format('ENQ-%s-%%', y);
  return format('ENQ-%s-%s', y, lpad(n::text, 4, '0'));
end;
$$;

-- Fills {name} {ref} {link} {director_name} {director_whatsapp} {director_link}.
create or replace function public.enquiry_text(p_template text, p_review public.enquiry_reviews)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select replace(replace(replace(replace(replace(replace(coalesce(p_template, ''),
           '{name}', coalesce(nullif(split_part(btrim(coalesce(p_review.contact_name, '')), ' ', 1), ''), 'there')),
           '{ref}', p_review.ref),
           '{link}', rtrim(s.form_base_url, '/') || '/enquiry/' || p_review.form_token),
           '{director_name}', s.director_name),
           '{director_whatsapp}', coalesce(s.director_whatsapp, '')),
           '{director_link}', 'https://wa.me/' || regexp_replace(coalesce(s.director_whatsapp, ''), '\D', '', 'g'))
  from public.enquiry_settings s where s.id = 1;
$$;

create or replace function public.queue_whatsapp(
  p_to text, p_kind text, p_body text,
  p_template text default null, p_params jsonb default '[]'::jsonb, p_enquiry uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if nullif(regexp_replace(coalesce(p_to, ''), '\D', '', 'g'), '') is null or nullif(btrim(p_body), '') is null then
    return null;
  end if;
  insert into public.whatsapp_outbox (to_phone, kind, body, template_name, template_params, enquiry_id)
  values (p_to, p_kind, left(p_body, 4000), p_template, coalesce(p_params, '[]'::jsonb), p_enquiry)
  returning id into v_id;
  return v_id;
end;
$$;

-- One staff alert per enquiry (email + WhatsApp, per each person's settings).
create or replace function public.alert_enquiry(p_review public.enquiry_reviews, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := coalesce(nullif(btrim(p_review.company), ''), nullif(btrim(p_review.contact_name), ''),
                           p_review.whatsapp_number, p_review.email, p_review.ref);
  v_channel text := case p_review.channel when 'website' then 'Website' else 'WhatsApp' end;
  v_interest text := concat_ws(' · ', nullif(btrim(p_review.product), ''), nullif(btrim(p_review.quantity), ''));
begin
  if p_review.alerted_at is not null then return; end if;
  perform public.notify_staff(
    'enquiry_review', 'enquiry:' || p_review.id,
    format('Enquiry to approve: %s%s', v_label, case when p_review.country is not null then ' (' || p_review.country || ')' else '' end),
    concat_ws(E'\n',
      format('%s enquiry %s from %s is waiting for approval.', v_channel, p_review.ref, v_label),
      p_note,
      case when v_interest <> '' then 'Interested in: ' || v_interest end,
      case when nullif(btrim(p_review.destination_port), '') is not null then 'Destination port: ' || p_review.destination_port end,
      case when nullif(btrim(p_review.message), '') is not null then 'Message: ' || left(btrim(p_review.message), 1000) end,
      concat_ws(' · ', nullif(p_review.contact_name, ''), nullif(p_review.email, ''), nullif(p_review.whatsapp_number, '')),
      case when cardinality(p_review.risk_flags) > 0
           then 'Note: ' || array_to_string(p_review.risk_flags, ', ') || '. Check before opening any link or file.' end,
      'Open KTC Trade Manager -> Approvals to approve or reject.'),
    jsonb_build_array(v_label, coalesce(p_review.country, 'country not given'), v_channel,
                      coalesce(nullif(v_interest, ''), 'not given yet')));
  update public.enquiry_reviews set alerted_at = now() where id = p_review.id;
end;
$$;

-- Buyers who never filled the form still reach staff, 2 hours after their first message.
create or replace function public.queue_stale_enquiry_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.enquiry_reviews;
  n integer := 0;
begin
  for r in select * from public.enquiry_reviews
           where status = 'awaiting_form' and alerted_at is null and created_at < now() - interval '2 hours'
  loop
    perform public.alert_enquiry(r, 'The buyer has not filled in the form yet; their WhatsApp messages are on the enquiry.');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. WhatsApp: unknown numbers open an enquiry instead of a CRM buyer
-- ---------------------------------------------------------------------------
create or replace function public.process_inbound_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := public.normalize_phone(new.from_phone);
  v_digits text := regexp_replace(coalesce(new.from_phone, ''), '\D', '', 'g');
  v_body text := coalesce(new.body, '[' || coalesce(new.message_type, 'message') || ']');
  v_ids text[];
  v_client_id text;
  v_company text;
  v_flags text[] := '{}';
  v_fresh boolean := coalesce(new.received_at, now()) > now() - interval '1 day';
  v_new_task boolean := false;
  v_review public.enquiry_reviews;
  v_settings public.enquiry_settings;
  v_risky boolean;
begin
  if new.review_status <> 'new' then return new; end if;

  select array_agg(c.id) into v_ids from public.clients c
  where regexp_replace(coalesce(c.whatsapp_number, ''), '\D', '', 'g') = v_digits
     or regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits;
  if coalesce(array_length(v_ids, 1), 0) = 0 and length(v_digits) >= 9 then
    -- Stored as a local number (e.g. 0300-...): match on the last 9 digits.
    select array_agg(c.id) into v_ids from public.clients c
    where right(regexp_replace(coalesce(c.whatsapp_number, c.phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9)
      and length(regexp_replace(coalesce(c.whatsapp_number, c.phone, ''), '\D', '', 'g')) >= 9;
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    v_client_id := v_ids[1];
  elsif coalesce(array_length(v_ids, 1), 0) > 1 then
    v_flags := array_append(v_flags, 'shared_number');
  end if;

  if new.message_type is not null and new.message_type not in ('text', 'button', 'interactive', 'reaction') then
    v_flags := array_append(v_flags, 'attachment');
  end if;
  if coalesce(new.body, '') ~* '(bank (details|account)|account (number|details)|swift|iban|password|verify your|https?://)' then
    v_flags := array_append(v_flags, 'payment_or_link');
  end if;
  v_risky := v_flags && array['payment_or_link'];

  -- New number: hold as an enquiry for approval, greet once and send the form link.
  if v_client_id is null and not (v_flags && array['shared_number']) then
    select * into v_settings from public.enquiry_settings where id = 1;

    select * into v_review from public.enquiry_reviews r
    where regexp_replace(coalesce(r.whatsapp_number, ''), '\D', '', 'g') = v_digits
      and r.status in ('awaiting_form', 'pending') and r.created_at > now() - interval '30 days'
    order by r.created_at desc limit 1;

    if not found then
      insert into public.enquiry_reviews
        (ref, channel, status, whatsapp_number, contact_name, country, message, risk_flags, form_token,
         last_buyer_message_at, source_table, source_id)
      values
        (public.next_enquiry_ref(), 'whatsapp', case when v_risky then 'pending' else 'awaiting_form' end,
         v_phone, nullif(btrim(new.from_name), ''), public.country_from_phone(v_phone), left(v_body, 5000), v_flags,
         replace(gen_random_uuid()::text, '-', ''), coalesce(new.received_at, now()), 'inbound_whatsapp', new.id::text)
      returning * into v_review;
    else
      update public.enquiry_reviews set
        last_buyer_message_at = greatest(coalesce(last_buyer_message_at, new.received_at), coalesce(new.received_at, now())),
        risk_flags = array(select distinct unnest(risk_flags || v_flags)),
        contact_name = coalesce(contact_name, nullif(btrim(new.from_name), '')),
        message = case when form_submitted_at is null then left(concat_ws(E'\n', message, v_body), 5000) else message end,
        updated_at = now()
      where id = v_review.id
      returning * into v_review;
    end if;

    update public.inbound_whatsapp
      set enquiry_id = v_review.id, risk_flags = v_flags,
          review_status = case when v_risky then 'needs_review' else 'linked' end
      where id = new.id;

    if v_fresh and not v_risky and not exists (
         select 1 from public.whatsapp_outbox o
         where regexp_replace(o.to_phone, '\D', '', 'g') = v_digits and o.kind = 'greeting'
           and o.created_at > now() - v_settings.greet_again_after) then
      perform public.queue_whatsapp(v_phone, 'greeting', public.enquiry_text(v_settings.greeting_text, v_review),
                                    null, '[]'::jsonb, v_review.id);
    end if;

    if v_risky and v_fresh then
      perform public.alert_enquiry(v_review, 'No greeting was sent because the message contains a link or payment wording.');
    end if;
    return new;
  end if;

  update public.inbound_whatsapp
    set client_id = v_client_id,
        review_status = case when v_client_id is null or v_flags && array['payment_or_link', 'shared_number']
                             then 'needs_review' else 'linked' end,
        risk_flags = v_flags
    where id = new.id;

  if v_client_id is not null then
    select company into v_company from public.clients where id = v_client_id;
    update public.clients
      set whatsapp_number = coalesce(nullif(whatsapp_number, ''), v_phone), last_activity = now()
      where id = v_client_id;
    perform public.log_interaction(v_client_id, null, 'whatsapp', 'in',
      'WhatsApp: ' || left(v_body, 200), new.body, 'inbound_whatsapp', new.id::text, new.received_at);

    if not exists (select 1 from public.tasks t
                   where t.client_id = v_client_id and t.source = 'auto' and t.status <> 'Done') then
      insert into public.tasks (title, description, category, priority, status, due_date, due_at, client_id, source)
      values (format('Reply to WhatsApp from %s', v_company), left(new.body, 2000), 'Follow-up', 'High', 'Todo',
              ((now() + interval '4 hours') at time zone 'Asia/Karachi')::date, now() + interval '4 hours',
              v_client_id, 'auto');
      v_new_task := true;
    end if;
  end if;

  if v_fresh and v_new_task then
    perform public.notify_staff('buyer_message',
      'wa:' || new.id,
      format('WhatsApp from %s', v_company),
      concat_ws(E'\n', format('From: %s (%s)%s', coalesce(new.from_name, 'unknown'), v_phone, ' — ' || v_company),
                '', left(v_body, 1500),
                case when cardinality(v_flags) > 0 then E'\nNote: ' || array_to_string(v_flags, ', ') || '. Check before opening anything.' end),
      jsonb_build_array(v_company, 'WhatsApp', left(regexp_replace(v_body, '\s+', ' ', 'g'), 150)));
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Website form: every submission waits for approval
-- ---------------------------------------------------------------------------
create or replace function public.capture_website_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.enquiry_reviews;
  url_count integer := coalesce(array_length(regexp_split_to_array(coalesce(new.message, ''), 'https?://'), 1), 1) - 1;
begin
  if nullif(btrim(coalesce(new.email, '')), '') is null and nullif(btrim(coalesce(new.phone, '')), '') is null then
    update public.public_inquiry_submissions set status = 'Needs Review' where id = new.id;
    return new;
  end if;
  if url_count > 2 then
    update public.public_inquiry_submissions set status = 'Spam?' where id = new.id;
    return new;
  end if;

  begin
    insert into public.enquiry_reviews
      (ref, channel, status, whatsapp_number, contact_name, company, country, email, product, quantity, message,
       form_token, form_submitted_at, source_table, source_id)
    values
      (public.next_enquiry_ref(), 'website', 'pending', public.normalize_phone(new.phone, new.country),
       nullif(btrim(new.full_name), ''), nullif(btrim(new.company_name), ''), nullif(btrim(new.country), ''),
       public.normalize_email(new.email), nullif(btrim(new.product_interest), ''), nullif(btrim(new.quantity_estimate), ''),
       left(nullif(btrim(new.message), ''), 5000), replace(gen_random_uuid()::text, '-', ''), now(),
       'public_inquiry_submissions', new.id::text)
    returning * into v_review;
    update public.public_inquiry_submissions set status = 'Awaiting Review' where id = new.id;
    perform public.alert_enquiry(v_review);
  exception when others then
    update public.public_inquiry_submissions set status = 'Needs Review' where id = new.id;
    raise warning 'capture_website_submission % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Public form for WhatsApp enquiries (/enquiry/:token), no login
-- ---------------------------------------------------------------------------
create or replace function public.get_enquiry_form(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.enquiry_reviews;
begin
  select * into r from public.enquiry_reviews
  where form_token = p_token and created_at > now() - interval '30 days';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'ref', r.ref,
    'open', r.status in ('awaiting_form', 'pending'),
    'submitted', r.form_submitted_at is not null,
    'contact_name', r.contact_name, 'company', r.company, 'country', r.country, 'email', r.email,
    'product', r.product, 'quantity', r.quantity, 'destination_port', r.destination_port,
    'products', coalesce((select jsonb_agg(p.name order by p.category, p.name) from public.public_product_catalog() p), '[]'::jsonb));
end;
$$;

create or replace function public.submit_enquiry_form(p_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.enquiry_reviews;
  v_first boolean;
  v_name text := left(nullif(btrim(p_data->>'contact_name'), ''), 120);
  v_company text := left(nullif(btrim(p_data->>'company'), ''), 200);
  v_country text := left(nullif(btrim(p_data->>'country'), ''), 80);
  v_product text := left(nullif(btrim(p_data->>'product'), ''), 120);
  v_quantity text := left(nullif(btrim(p_data->>'quantity'), ''), 120);
  v_port text := left(nullif(btrim(p_data->>'destination_port'), ''), 120);
  v_email text := public.normalize_email(p_data->>'email');
  v_message text := left(nullif(btrim(p_data->>'message'), ''), 3000);
begin
  select * into r from public.enquiry_reviews
  where form_token = p_token and created_at > now() - interval '30 days'
  for update;
  if not found then raise exception 'This link has expired. Please message us on WhatsApp again.'; end if;
  if r.status not in ('awaiting_form', 'pending') then
    raise exception 'This enquiry has already been reviewed. Please message us on WhatsApp for anything new.';
  end if;
  if v_name is null or v_country is null or v_product is null or v_quantity is null then
    raise exception 'Please fill in your name, country, product and quantity.';
  end if;

  v_first := r.form_submitted_at is null;
  update public.enquiry_reviews set
    contact_name = v_name, company = coalesce(v_company, company), country = v_country,
    email = coalesce(v_email, email), product = v_product, quantity = v_quantity,
    destination_port = coalesce(v_port, destination_port),
    message = case when v_message is null then message
                   when message is null then v_message
                   else left(v_message || E'\n\nEarlier WhatsApp messages:\n' || message, 5000) end,
    status = 'pending', form_submitted_at = coalesce(form_submitted_at, now()), updated_at = now()
  where id = r.id
  returning * into r;

  if v_first then
    perform public.queue_whatsapp(r.whatsapp_number, 'received',
      public.enquiry_text((select received_text from public.enquiry_settings where id = 1), r), null, '[]'::jsonb, r.id);
    perform public.alert_enquiry(r);
  end if;
  return jsonb_build_object('ref', r.ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Staff actions
-- ---------------------------------------------------------------------------
-- Correct details before deciding (e.g. from the WhatsApp chat when no form was filled).
create or replace function public.update_enquiry(p_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_edit() then raise exception 'Not authorised'; end if;
  update public.enquiry_reviews set
    contact_name = case when p_data ? 'contact_name' then left(nullif(btrim(p_data->>'contact_name'), ''), 120) else contact_name end,
    company = case when p_data ? 'company' then left(nullif(btrim(p_data->>'company'), ''), 200) else company end,
    country = case when p_data ? 'country' then left(nullif(btrim(p_data->>'country'), ''), 80) else country end,
    email = case when p_data ? 'email' then public.normalize_email(p_data->>'email') else email end,
    product = case when p_data ? 'product' then left(nullif(btrim(p_data->>'product'), ''), 120) else product end,
    quantity = case when p_data ? 'quantity' then left(nullif(btrim(p_data->>'quantity'), ''), 120) else quantity end,
    destination_port = case when p_data ? 'destination_port' then left(nullif(btrim(p_data->>'destination_port'), ''), 120) else destination_port end,
    updated_at = now()
  where id = p_id and status in ('awaiting_form', 'pending');
  if not found then raise exception 'Only enquiries that are still waiting can be edited.'; end if;
end;
$$;

create or replace function public.approve_enquiry(p_id uuid, p_note text default null, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.enquiry_reviews;
  s public.enquiry_settings;
  v_result jsonb;
  v_client text;
  v_inquiry text;
  v_message text;
  v_queued uuid;
  m record;
begin
  if not public.can_edit() then raise exception 'Not authorised'; end if;
  select * into s from public.enquiry_settings where id = 1;
  select * into r from public.enquiry_reviews where id = p_id for update;
  if not found then raise exception 'Enquiry not found'; end if;
  if r.status not in ('awaiting_form', 'pending') then raise exception 'This enquiry was already %', r.status; end if;
  if r.whatsapp_number is not null and nullif(btrim(coalesce(s.director_whatsapp, '')), '') is null then
    raise exception 'Add the Director''s WhatsApp number in Settings -> WhatsApp enquiries first.';
  end if;

  v_result := public.capture_inquiry(
    r.channel,
    coalesce(nullif(btrim(r.company), ''), nullif(btrim(r.contact_name), ''), 'WhatsApp ' || r.whatsapp_number),
    r.contact_name, r.email, r.whatsapp_number, r.country, r.product, r.quantity,
    concat_ws(E'\n', r.message,
              case when r.destination_port is not null then 'Destination port: ' || r.destination_port end,
              case when nullif(btrim(p_note), '') is not null then 'Approval note: ' || btrim(p_note) end),
    'enquiry_reviews', r.id::text);
  v_client := v_result->>'client_id';
  v_inquiry := v_result->>'inquiry_id';

  update public.clients set
    whatsapp_number = coalesce(nullif(whatsapp_number, ''), r.whatsapp_number),
    destination_ports = coalesce(nullif(destination_ports, ''), r.destination_port)
  where id = v_client;

  -- Earlier WhatsApp messages from this buyer go onto their timeline.
  for m in select * from public.inbound_whatsapp where enquiry_id = r.id order by received_at loop
    update public.inbound_whatsapp set client_id = v_client, inquiry_id = v_inquiry where id = m.id;
    perform public.log_interaction(v_client, v_inquiry, 'whatsapp', 'in',
      'WhatsApp: ' || left(coalesce(m.body, '[message]'), 200), m.body, 'inbound_whatsapp', m.id::text, m.received_at);
  end loop;

  v_message := coalesce(nullif(btrim(p_message), ''), public.enquiry_text(s.approved_text, r));
  if r.whatsapp_number is not null then
    v_queued := public.queue_whatsapp(r.whatsapp_number, 'approved', v_message, 'ktc_enquiry_approved',
      jsonb_build_array(coalesce(nullif(split_part(btrim(coalesce(r.contact_name, '')), ' ', 1), ''), 'there'),
                        r.ref, s.director_name, s.director_whatsapp),
      r.id);
  end if;

  update public.enquiry_reviews set
    status = 'approved', decided_at = now(), decided_by = auth.uid(), decision_note = nullif(btrim(p_note), ''),
    client_id = v_client, inquiry_id = v_inquiry, reply_text = v_message, updated_at = now()
  where id = r.id;

  if r.source_table = 'public_inquiry_submissions' then
    update public.public_inquiry_submissions
      set status = 'Converted', linked_client_id = v_client, reviewed_at = now()
      where id::text = r.source_id;
  end if;

  perform public.log_interaction(v_client, v_inquiry, 'note', 'internal',
    format('Enquiry %s approved%s', r.ref,
           case when v_queued is not null then '; buyer asked on WhatsApp to message the Director' else '' end),
    nullif(btrim(p_note), ''), 'enquiry_reviews', r.id::text || ':approved');

  return jsonb_build_object('client_id', v_client, 'inquiry_id', v_inquiry, 'message', v_message,
                            'whatsapp_queued', v_queued is not null, 'email', r.email);
end;
$$;

create or replace function public.reject_enquiry(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.enquiry_reviews;
  v_message text;
begin
  if not public.can_edit() then raise exception 'Not authorised'; end if;
  select * into r from public.enquiry_reviews where id = p_id for update;
  if not found then raise exception 'Enquiry not found'; end if;
  if r.status not in ('awaiting_form', 'pending') then raise exception 'This enquiry was already %', r.status; end if;

  v_message := public.enquiry_text((select rejected_text from public.enquiry_settings where id = 1), r);
  update public.enquiry_reviews set
    status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = nullif(btrim(p_reason), ''),
    reply_text = v_message, updated_at = now()
  where id = r.id;

  if r.source_table = 'public_inquiry_submissions' then
    update public.public_inquiry_submissions set status = 'Rejected', reviewed_at = now() where id::text = r.source_id;
  end if;

  -- Nothing is sent automatically: staff send this message themselves.
  return jsonb_build_object('message', v_message, 'whatsapp_number', r.whatsapp_number, 'email', r.email);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. notify_staff knows the new alert kind (same preference as new inquiries)
-- ---------------------------------------------------------------------------
create or replace function public.notify_staff(
  p_kind text, p_key text, p_subject text, p_body text, p_params jsonb default '[]'::jsonb,
  p_only_profile uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued integer;
begin
  insert into public.staff_notifications (profile_id, channel, kind, recipient, subject, body, template_params, dedupe_key)
  select p.id, ch.channel, p_kind,
         case ch.channel when 'email' then p.notify_email else p.notify_whatsapp end,
         left(p_subject, 200), left(p_body, 8000), coalesce(p_params, '[]'::jsonb),
         p_key || ':' || p.id || ':' || ch.channel
  from public.profiles p
  cross join (values ('email'), ('whatsapp')) as ch(channel)
  where p.role in ('Admin / Owner', 'Director', 'Sales Executive', 'Export Manager')
    and (p_only_profile is null or p.id = p_only_profile)
    and case p_kind
          when 'new_inquiry' then p.notify_new_inquiry
          when 'enquiry_review' then p.notify_new_inquiry
          when 'buyer_message' then p.notify_new_inquiry
          when 'followup_overdue' then p.notify_overdue
          else true end
    and nullif(case ch.channel when 'email' then p.notify_email else p.notify_whatsapp end, '') is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.next_enquiry_ref() from public, anon, authenticated;
revoke all on function public.enquiry_text(text, public.enquiry_reviews) from public, anon, authenticated;
revoke all on function public.queue_whatsapp(text, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.alert_enquiry(public.enquiry_reviews, text) from public, anon, authenticated;
revoke all on function public.queue_stale_enquiry_alerts() from public, anon, authenticated;
grant execute on function public.get_enquiry_form(text) to anon, authenticated;
grant execute on function public.submit_enquiry_form(text, jsonb) to anon, authenticated;
revoke all on function public.update_enquiry(uuid, jsonb) from public, anon;
revoke all on function public.approve_enquiry(uuid, text, text) from public, anon;
revoke all on function public.reject_enquiry(uuid, text) from public, anon;
grant execute on function public.update_enquiry(uuid, jsonb) to authenticated;
grant execute on function public.approve_enquiry(uuid, text, text) to authenticated;
grant execute on function public.reject_enquiry(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Sender: every minute (no-op until the Meta secrets are set)
-- ---------------------------------------------------------------------------
select cron.unschedule('ktc-whatsapp-outbox') where exists (select 1 from cron.job where jobname = 'ktc-whatsapp-outbox');
select cron.schedule('ktc-whatsapp-outbox', '* * * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ktc_project_url')
           || '/functions/v1/send-whatsapp-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ktc_automation_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);

commit;
