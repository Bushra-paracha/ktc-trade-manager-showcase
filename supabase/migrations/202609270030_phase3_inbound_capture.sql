-- Phase 3: inbound capture, follow-up tasks, staff notifications (2026-09-27)
--
-- Every inbound inquiry becomes a client + inquiry + follow-up task:
--   * Website form  -> captured automatically (trigger on public_inquiry_submissions)
--   * Email         -> known buyers are linked automatically; unknown senders are
--                      held for review ("Messages to check" on Today) because KTC is
--                      a phishing target. Risky attachments and look-alike senders
--                      are flagged, never opened.
--   * WhatsApp      -> same as email, fed by the whatsapp-webhook Edge Function.
-- Captured buyers are created with status 'Hot', so they are NOT enrolled in the
-- cold "New Lead Follow-Up" email sequence (that only enrolls status 'New').
--
-- Every interaction (emails in/out, WhatsApp, website, follow-ups, order changes)
-- is logged in client_interactions for the buyer timeline.
--
-- Staff notifications (new inquiry, buyer message, overdue reply, daily digest)
-- are queued in staff_notifications and sent by the staff-notifier Edge Function
-- (email via Brevo; WhatsApp via Meta templates once approved). Each person sets
-- their channels, digest hour and time zone in Settings.
--
-- Apply with the SQL editor or `supabase db query --linked -f <this file>`.
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- Same rule as companyKey() in the app: case, spacing and punctuation don't matter.
create or replace function public.company_key(p_name text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g')), '')
$$;

create index if not exists clients_company_key_idx on public.clients (public.company_key(company));

-- E.164 where possible (same country list as src/lib/phone.js); otherwise the
-- trimmed original so nothing is lost.
create or replace function public.normalize_phone(p_raw text, p_country text default null)
returns text
language plpgsql
immutable
as $$
declare
  d text;
  code text;
  nat text;
begin
  if p_raw is null or btrim(p_raw) = '' then return null; end if;
  d := regexp_replace(p_raw, '[^0-9+]', '', 'g');
  if left(d, 2) = '00' then d := '+' || substr(d, 3); end if;

  if left(d, 1) <> '+' then
    code := case lower(btrim(coalesce(p_country, '')))
      when 'pakistan' then '92' when 'philippines' then '63' when 'bangladesh' then '880'
      when 'saudi arabia' then '966' when 'united arab emirates' then '971' when 'uae' then '971'
      when 'kuwait' then '965' when 'qatar' then '974' when 'bahrain' then '973' when 'oman' then '968'
      when 'iran' then '98' when 'iraq' then '964' when 'jordan' then '962' when 'egypt' then '20'
      when 'malaysia' then '60' when 'indonesia' then '62' when 'singapore' then '65'
      when 'vietnam' then '84' when 'thailand' then '66' when 'china' then '86' when 'hong kong' then '852'
      when 'sri lanka' then '94' when 'india' then '91' when 'afghanistan' then '93'
      when 'ethiopia' then '251' when 'ghana' then '233' when 'kenya' then '254' when 'nigeria' then '234'
      when 'tanzania' then '255' when 'south africa' then '27' when 'mozambique' then '258' when 'senegal' then '221'
      when 'united kingdom' then '44' when 'uk' then '44' when 'united states' then '1' when 'usa' then '1'
      when 'canada' then '1' when 'australia' then '61' when 'germany' then '49' when 'netherlands' then '31'
      when 'france' then '33' when 'italy' then '39' when 'spain' then '34' when 'belgium' then '32'
      when 'turkey' then '90'
      else null end;
    if code is null then return btrim(p_raw); end if;
    nat := regexp_replace(d, '^0+', '');
    if left(nat, length(code)) = code and length(nat) > length(code) + 6 then
      nat := substr(nat, length(code) + 1);
    end if;
    d := '+' || code || nat;
  end if;

  d := '+' || replace(substr(d, 2), '+', '');
  if d ~ '^\+[1-9][0-9]{6,14}$' then return d; end if;
  return btrim(p_raw);
end;
$$;

-- Next LEAD-YYYY-#### / INQ-YYYY-#### id (same scheme as the app), race-safe.
create or replace function public.next_client_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('ktc_next_client_id'));
  select coalesce(max((regexp_match(id, '^LEAD-\d{4}-(\d+)$'))[1]::integer), 0) + 1
    into n from public.clients where id ~ '^LEAD-\d{4}-\d+$';
  return format('LEAD-%s-%s', extract(year from now() at time zone 'Asia/Karachi')::integer, lpad(n::text, 4, '0'));
end;
$$;

create or replace function public.next_inquiry_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('ktc_next_inquiry_id'));
  select coalesce(max((regexp_match(id, '^INQ-\d{4}-(\d+)$'))[1]::integer), 0) + 1
    into n from public.inquiries where id ~ '^INQ-\d{4}-\d+$';
  return format('INQ-%s-%s', extract(year from now() at time zone 'Asia/Karachi')::integer, lpad(n::text, 4, '0'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Schema
-- ---------------------------------------------------------------------------
alter table public.inquiries
  add column if not exists source_channel text,
  add column if not exists source_ref text,
  add column if not exists product_interest text,
  add column if not exists quantity_estimate text,
  add column if not exists reply_due_at timestamptz,
  add column if not exists replied_at timestamptz;
create unique index if not exists inquiries_source_ref_idx on public.inquiries (source_ref) where source_ref is not null;

alter table public.tasks
  add column if not exists client_id text references public.clients(id) on delete set null,
  add column if not exists inquiry_id text references public.inquiries(id) on delete set null,
  add column if not exists due_at timestamptz,
  add column if not exists source text not null default 'manual',
  add column if not exists overdue_notified_at timestamptz;
create index if not exists tasks_open_auto_idx on public.tasks (client_id) where status <> 'Done' and source = 'auto';

alter table public.inbound_emails
  add column if not exists attachment_names text[] not null default '{}',
  add column if not exists review_status text not null default 'new',
  add column if not exists risk_flags text[] not null default '{}',
  add column if not exists inquiry_id text references public.inquiries(id) on delete set null;
alter table public.inbound_emails drop constraint if exists inbound_emails_review_status_check;
alter table public.inbound_emails add constraint inbound_emails_review_status_check
  check (review_status in ('new', 'linked', 'reply', 'needs_review', 'captured', 'dismissed', 'archived'));
-- Everything already stored is from before 3 July (capture was stuck); keep it out of Today.
update public.inbound_emails set review_status = 'archived' where review_status = 'new';

create table if not exists public.inbound_whatsapp (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text not null unique,
  from_phone text not null,
  from_name text,
  message_type text,
  body text,
  received_at timestamptz not null default now(),
  client_id text references public.clients(id) on delete set null,
  inquiry_id text references public.inquiries(id) on delete set null,
  review_status text not null default 'new'
    check (review_status in ('new', 'linked', 'needs_review', 'captured', 'dismissed')),
  risk_flags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists inbound_whatsapp_review_idx on public.inbound_whatsapp (review_status, received_at desc);

create table if not exists public.client_interactions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  inquiry_id text references public.inquiries(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp', 'website', 'call', 'meeting', 'note', 'system')),
  direction text not null check (direction in ('in', 'out', 'internal')),
  summary text not null,
  detail text,
  occurred_at timestamptz not null default now(),
  source_table text,
  source_id text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists client_interactions_client_idx on public.client_interactions (client_id, occurred_at desc);
create unique index if not exists client_interactions_source_idx
  on public.client_interactions (source_table, source_id) where source_table is not null;

alter table public.profiles
  add column if not exists notify_email text,
  add column if not exists notify_whatsapp text,
  add column if not exists notify_new_inquiry boolean not null default true,
  add column if not exists notify_overdue boolean not null default true,
  add column if not exists daily_digest boolean not null default true,
  add column if not exists digest_hour integer not null default 8,
  add column if not exists time_zone text not null default 'Asia/Karachi',
  add column if not exists last_digest_on date;
alter table public.profiles drop constraint if exists profiles_digest_hour_check;
alter table public.profiles add constraint profiles_digest_hour_check check (digest_hour between 0 and 23);

create or replace function public.validate_profile_time_zone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.time_zone) then
    raise exception 'Unknown time zone: %', new.time_zone;
  end if;
  new.notify_whatsapp := public.normalize_phone(new.notify_whatsapp);
  new.notify_email := public.normalize_email(new.notify_email);
  return new;
end;
$$;
drop trigger if exists profiles_validate_time_zone on public.profiles;
create trigger profiles_validate_time_zone
before insert or update of time_zone, notify_whatsapp, notify_email on public.profiles
for each row execute function public.validate_profile_time_zone();

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  kind text not null check (kind in ('new_inquiry', 'buyer_message', 'followup_overdue', 'daily_digest')),
  recipient text not null,
  subject text not null,
  body text not null,
  template_params jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists staff_notifications_pending_idx on public.staff_notifications (created_at) where status in ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- 3. Interaction log and staff notification queue (internal)
-- ---------------------------------------------------------------------------
create or replace function public.log_interaction(
  p_client_id text, p_inquiry_id text, p_channel text, p_direction text,
  p_summary text, p_detail text default null,
  p_source_table text default null, p_source_id text default null,
  p_occurred_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_client_id is null then return; end if;
  insert into public.client_interactions
    (client_id, inquiry_id, channel, direction, summary, detail, source_table, source_id, occurred_at)
  values
    (p_client_id, p_inquiry_id, p_channel, p_direction, left(p_summary, 300), left(p_detail, 5000),
     p_source_table, p_source_id, coalesce(p_occurred_at, now()))
  on conflict (source_table, source_id) where source_table is not null do nothing;
end;
$$;

-- Queue one notification per staff member and channel they've set up.
-- p_params are the WhatsApp template values (single line each).
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
-- 4. Capture: one inbound inquiry -> client (dedupe by company) + inquiry + task
-- ---------------------------------------------------------------------------
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
       'Hot', 70, now(), case when p_channel = 'whatsapp' then 'WhatsApp' else 'Email' end)
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

-- Website form -> capture. Never blocks the visitor's submission: problems are
-- recorded on the row for review instead.
create or replace function public.capture_website_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
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
    result := public.capture_inquiry('website', new.company_name, new.full_name, new.email, new.phone,
      new.country, new.product_interest, new.quantity_estimate, new.message,
      'public_inquiry_submissions', new.id::text);
    update public.public_inquiry_submissions
      set status = 'Converted', linked_client_id = result->>'client_id', reviewed_at = now()
      where id = new.id;
  exception when others then
    update public.public_inquiry_submissions set status = 'Needs Review' where id = new.id;
    raise warning 'capture_website_submission % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists capture_website_submission on public.public_inquiry_submissions;
create trigger capture_website_submission
after insert on public.public_inquiry_submissions
for each row execute function public.capture_website_submission();

-- ---------------------------------------------------------------------------
-- 5. Inbound email: link known buyers, flag risks, hold unknown senders
-- ---------------------------------------------------------------------------
create or replace function public.email_risk_flags(
  p_from text, p_from_name text, p_subject text, p_body text, p_attachments text[]
)
returns text[]
language plpgsql
immutable
as $$
declare
  flags text[] := '{}';
  domain text := lower(split_part(coalesce(p_from, ''), '@', 2));
  heading text := lower(coalesce(p_from_name, '') || ' ' || coalesce(p_subject, ''));
begin
  if exists (select 1 from unnest(coalesce(p_attachments, '{}')) a
             where a ~* '\.(rar|zip|7z|gz|tar|iso|img|exe|scr|bat|cmd|com|js|jse|vbs|wsf|html?|shtml|svg|xls|xlsm|xlsb|xlam|docm|dotm|pptm|lnk|hta|msi|jar|one)$') then
    flags := array_append(flags, 'risky_attachment');
  end if;
  -- Known impersonators of KTC's contacts and freight partners.
  if domain in ('saganvege.com') then flags := array_append(flags, 'known_impersonator'); end if;
  if heading ~ '(sinotrans|maersk|cosco|msc |msc$|hapag|evergreen|dhl|fedex|cma cgm)'
     and domain !~ '(sinotrans\.com|maersk\.com|cosco\.com|coscoshipping\.com|msc\.com|hapag-lloyd\.com|evergreen-line\.com|dhl\.com|fedex\.com|cma-cgm\.com)$' then
    flags := array_append(flags, 'brand_impersonation');
  end if;
  if (coalesce(p_subject, '') || ' ' || coalesce(left(p_body, 3000), ''))
     ~* '(bank (details|account)|account (number|details)|swift|iban|remittance|payment (advice|confirmation|slip)|wire transfer|password|verify your|confirm your (account|email)|invoice (attached|due))' then
    flags := array_append(flags, 'payment_or_login');
  end if;
  return flags;
end;
$$;

create or replace function public.process_inbound_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text := public.normalize_email(new.from_email);
  v_domain text := split_part(v_from, '@', 2);
  v_ids text[];
  v_client_id text;
  v_flags text[];
  v_status text;
  v_is_reply boolean;
  v_company text;
  v_free constant text[] := array['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
    'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
    'mail.com', 'gmx.com', 'yandex.com', 'qq.com', '163.com', '126.com', 'rediffmail.com', 'zoho.com'];
begin
  if new.review_status <> 'new' then return new; end if;

  -- Bounces, auto-replies, newsletters and our own addresses never need a person.
  if v_from ~ '^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|notifications?|bounces?|newsletter)'
     or v_domain in ('kassamtradingcompany.com', 'nbmttrading.com')
     or coalesce(new.subject, '') ~* '^(undeliver|delivery status notification|mail delivery (failed|subsystem)|out of office|automatic reply|auto(matic)?[- ]?reply)' then
    update public.inbound_emails set review_status = 'dismissed', risk_flags = array['automated'] where id = new.id;
    return new;
  end if;

  v_flags := public.email_risk_flags(v_from, new.from_name, new.subject, new.body_text, new.attachment_names);

  -- Exact address match first; a shared broker address (several buyers) needs a person.
  select array_agg(c.id) into v_ids from public.clients c
  where v_from = any(regexp_split_to_array(lower(coalesce(c.email, '')), '[\s,;]+'));
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    v_client_id := v_ids[1];
  elsif coalesce(array_length(v_ids, 1), 0) > 1 then
    v_flags := array_append(v_flags, 'shared_email');
  elsif v_domain <> '' and not (v_domain = any(v_free)) then
    select array_agg(c.id) into v_ids from public.clients c
    where exists (select 1 from unnest(regexp_split_to_array(lower(coalesce(c.email, '')), '[\s,;]+')) e
                  where split_part(e, '@', 2) = v_domain);
    if coalesce(array_length(v_ids, 1), 0) = 1 then v_client_id := v_ids[1]; end if;
  end if;

  v_is_reply := exists (select 1 from public.email_replies r
                        where r.imap_uid = new.imap_uid and public.normalize_email(r.from_email) = v_from);

  v_status := case
    when v_client_id is null or cardinality(v_flags) > 0 then 'needs_review'
    when v_is_reply then 'reply'
    else 'linked' end;

  update public.inbound_emails
    set review_status = v_status, risk_flags = v_flags, client_id = v_client_id
    where id = new.id;

  if v_client_id is not null then
    select company into v_company from public.clients where id = v_client_id;
    perform public.log_interaction(v_client_id, null, 'email', 'in',
      'Email: ' || coalesce(new.subject, '(no subject)'), new.body_text,
      'inbound_emails', new.id::text, new.received_at);
    update public.clients set last_activity = now() where id = v_client_id;

    if cardinality(v_flags) = 0 and not exists (
      select 1 from public.tasks t where t.client_id = v_client_id and t.source = 'auto' and t.status <> 'Done'
    ) then
      insert into public.tasks (title, description, category, priority, status, due_date, due_at, client_id, source)
      values (format('Reply to %s: %s', v_company, left(coalesce(new.subject, 'email'), 120)),
              left(new.body_text, 2000), 'Follow-up', 'High', 'Todo',
              ((now() + interval '4 hours') at time zone 'Asia/Karachi')::date, now() + interval '4 hours',
              v_client_id, 'auto');
    end if;

    -- Instant alerts only for fresh mail; older mail caught up after an outage
    -- still gets its task and shows in the morning summary.
    if coalesce(new.received_at, now()) > now() - interval '1 day' then
    perform public.notify_staff('buyer_message', 'email:' || new.id,
      format('%s emailed %s: %s', v_company, new.mailbox, left(coalesce(new.subject, '(no subject)'), 120)),
      concat_ws(E'\n', format('From: %s <%s>', coalesce(new.from_name, ''), v_from),
                'Subject: ' || coalesce(new.subject, ''), '', left(coalesce(new.body_text, ''), 1500),
                case when cardinality(v_flags) > 0 then E'\nWarning: ' || array_to_string(v_flags, ', ') || '. Check carefully before replying or opening attachments.' end),
      jsonb_build_array(v_company, 'email', left(regexp_replace(coalesce(new.subject, ''), '\s+', ' ', 'g'), 150)));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists process_inbound_email on public.inbound_emails;
create trigger process_inbound_email
after insert on public.inbound_emails
for each row execute function public.process_inbound_email();

-- ---------------------------------------------------------------------------
-- 6. Inbound WhatsApp (rows written by the whatsapp-webhook Edge Function)
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
  v_ids text[];
  v_client_id text;
  v_company text;
  v_flags text[] := '{}';
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

  update public.inbound_whatsapp
    set client_id = v_client_id,
        review_status = case when v_client_id is null or cardinality(v_flags) > 0 then 'needs_review' else 'linked' end,
        risk_flags = v_flags
    where id = new.id;

  if v_client_id is not null then
    select company into v_company from public.clients where id = v_client_id;
    update public.clients
      set whatsapp_number = coalesce(nullif(whatsapp_number, ''), v_phone), last_activity = now()
      where id = v_client_id;
    perform public.log_interaction(v_client_id, null, 'whatsapp', 'in',
      'WhatsApp: ' || left(coalesce(new.body, '[' || coalesce(new.message_type, 'message') || ']'), 200),
      new.body, 'inbound_whatsapp', new.id::text, new.received_at);

    if not exists (select 1 from public.tasks t
                   where t.client_id = v_client_id and t.source = 'auto' and t.status <> 'Done') then
      insert into public.tasks (title, description, category, priority, status, due_date, due_at, client_id, source)
      values (format('Reply to WhatsApp from %s', v_company), left(new.body, 2000), 'Follow-up', 'High', 'Todo',
              ((now() + interval '4 hours') at time zone 'Asia/Karachi')::date, now() + interval '4 hours',
              v_client_id, 'auto');
    end if;
  end if;

  -- One alert per sender per day, known or not (fresh messages only).
  if coalesce(new.received_at, now()) > now() - interval '1 day' then
  perform public.notify_staff('buyer_message',
    'wa:' || v_digits || ':' || to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM-DD'),
    format('WhatsApp from %s', coalesce(v_company, new.from_name, v_phone)),
    concat_ws(E'\n', format('From: %s (%s)%s', coalesce(new.from_name, 'unknown'), v_phone,
                            case when v_company is null then ' — not in the CRM yet' else ' — ' || v_company end),
              '', left(coalesce(new.body, '[' || coalesce(new.message_type, 'message') || ']'), 1500)),
    jsonb_build_array(coalesce(v_company, coalesce(new.from_name, 'Unknown') || ' ' || v_phone), 'WhatsApp',
                      left(regexp_replace(coalesce(new.body, '[' || coalesce(new.message_type, 'message') || ']'), '\s+', ' ', 'g'), 150)));
  end if;

  return new;
end;
$$;

drop trigger if exists process_inbound_whatsapp on public.inbound_whatsapp;
create trigger process_inbound_whatsapp
after insert on public.inbound_whatsapp
for each row execute function public.process_inbound_whatsapp();

-- ---------------------------------------------------------------------------
-- 7. Outgoing email and order changes on the timeline
-- ---------------------------------------------------------------------------
create or replace function public.log_email_message_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_interaction(new.client_id, null, 'email', 'out',
    'Email sent: ' || coalesce(new.subject, '(no subject)'), null,
    'email_messages', new.id::text, coalesce(new.sent_at, new.created_at));
  return new;
end;
$$;

drop trigger if exists log_email_message_interaction on public.email_messages;
create trigger log_email_message_interaction
after insert on public.email_messages
for each row when (new.client_id is not null)
execute function public.log_email_message_interaction();

-- History for existing timelines (safe to re-run: one row per source message).
insert into public.client_interactions (client_id, channel, direction, summary, source_table, source_id, occurred_at, created_by)
select m.client_id, 'email', 'out', left('Email sent: ' || coalesce(m.subject, '(no subject)'), 300),
       'email_messages', m.id::text, coalesce(m.sent_at, m.created_at, now()), null
from public.email_messages m
join public.clients c on c.id = m.client_id
on conflict (source_table, source_id) where source_table is not null do nothing;

-- ---------------------------------------------------------------------------
-- 8. Staff actions (Today screen)
-- ---------------------------------------------------------------------------

-- Replaces the Phase 2 version: records the channel, logs the interaction,
-- closes the buyer's open auto follow-up tasks and marks new inquiries replied.
drop function if exists public.log_client_followup(text, integer, text);
create or replace function public.log_client_followup(
  p_client_id text,
  p_next_in_days integer default 7,
  p_note text default null,
  p_channel text default 'whatsapp'
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
  set last_contacted_at = now(), last_activity = now(), next_followup_at = next_date
  where id = p_client_id;
  if not found then raise exception 'Buyer not found'; end if;

  perform public.log_interaction(p_client_id, null, p_channel, 'out',
    format('%s by %s', case p_channel when 'whatsapp' then 'WhatsApp follow-up' when 'call' then 'Call'
                                      when 'email' then 'Email follow-up' when 'meeting' then 'Meeting'
                                      else 'Note' end, coalesce(author, 'staff')),
    clean_note);

  update public.tasks set status = 'Done', updated_at = now()
  where client_id = p_client_id and source = 'auto' and status <> 'Done';

  update public.inquiries set status = 'Pending Response', replied_at = coalesce(replied_at, now())
  where client_id = p_client_id and status = 'New';

  return jsonb_build_object('id', p_client_id, 'next_followup_at', next_date);
end;
$$;

-- "It's an inquiry": turn a held email / WhatsApp into client + inquiry + task.
create or replace function public.capture_message_as_inquiry(
  p_source text, p_message_id uuid,
  p_company text, p_contact text default null, p_country text default null,
  p_product text default null, p_quantity text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  m_email record;
  m_wa record;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if nullif(btrim(coalesce(p_company, '')), '') is null then raise exception 'Enter the company name'; end if;

  if p_source = 'email' then
    select * into m_email from public.inbound_emails where id = p_message_id;
    if not found then raise exception 'Message not found'; end if;
    result := public.capture_inquiry('email', p_company, coalesce(nullif(btrim(p_contact), ''), m_email.from_name),
      m_email.from_email, null, p_country, p_product, p_quantity,
      concat_ws(E'\n\n', m_email.subject, m_email.body_text), 'inbound_emails', p_message_id::text);
    update public.inbound_emails
      set review_status = 'captured', client_id = result->>'client_id', inquiry_id = result->>'inquiry_id'
      where id = p_message_id;
  elsif p_source = 'whatsapp' then
    select * into m_wa from public.inbound_whatsapp where id = p_message_id;
    if not found then raise exception 'Message not found'; end if;
    result := public.capture_inquiry('whatsapp', p_company, coalesce(nullif(btrim(p_contact), ''), m_wa.from_name),
      null, m_wa.from_phone, p_country, p_product, p_quantity, m_wa.body, 'inbound_whatsapp', p_message_id::text);
    -- Later messages from the same number are part of the same conversation.
    update public.inbound_whatsapp
      set review_status = 'captured', client_id = result->>'client_id',
          inquiry_id = case when id = p_message_id then result->>'inquiry_id' else inquiry_id end
      where from_phone = m_wa.from_phone and review_status in ('new', 'needs_review');
  else
    raise exception 'Unknown message source';
  end if;
  return result;
end;
$$;

create or replace function public.dismiss_message(p_source text, p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if p_source = 'email' then
    update public.inbound_emails set review_status = 'dismissed' where id = p_message_id;
  elsif p_source = 'whatsapp' then
    update public.inbound_whatsapp set review_status = 'dismissed' where id = p_message_id;
  else
    raise exception 'Unknown message source';
  end if;
  if not found then raise exception 'Message not found'; end if;
end;
$$;

-- Order stage changes on the buyer timeline (Phase 2 function + one log line).
create or replace function public.set_order_status(
  p_order_id text,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  v_client_id text;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if p_status not in (
    'Order Confirmed', 'Advance Payment Received', 'In Production',
    'Ready to Ship', 'Shipped', 'Balance Payment Received', 'Delivered & Closed'
  ) then raise exception 'Invalid order status'; end if;
  if clean_note is not null and char_length(clean_note) > 2000 then
    raise exception 'Note is too long';
  end if;

  select status, client_id into current_status, v_client_id from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  if current_status is distinct from p_status then
    update public.orders set status = p_status where id = p_order_id; -- trigger logs status_changed
    perform public.log_interaction(v_client_id, null, 'system', 'internal',
      format('Order %s: %s → %s', p_order_id, current_status, p_status), clean_note);
  else
    insert into public.order_activity(order_id, event_type, from_value, to_value)
    values (p_order_id, 'status_confirmed', current_status, p_status);
  end if;

  if clean_note is not null then
    insert into public.order_activity(order_id, event_type, to_value, metadata)
    values (p_order_id, 'note_added', p_status, jsonb_build_object('note', clean_note));
  end if;

  return jsonb_build_object('id', p_order_id, 'previous_status', current_status, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Scheduled work (called by staff-notifier as service role)
-- ---------------------------------------------------------------------------
create or replace function public.queue_overdue_followups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  n integer := 0;
begin
  for t in
    select tk.id, tk.title, tk.due_at, c.company, c.country
    from public.tasks tk left join public.clients c on c.id = tk.client_id
    where tk.source = 'auto' and tk.status <> 'Done' and tk.due_at < now() and tk.overdue_notified_at is null
    order by tk.due_at
    for update of tk skip locked
  loop
    update public.tasks set overdue_notified_at = now() where id = t.id;
    perform public.notify_staff('followup_overdue', 'overdue:' || t.id,
      'Overdue: ' || t.title,
      format(E'%s\nWas due %s Karachi time and is still open. Open Today in KTC Trade Manager to follow up.',
             t.title, to_char(t.due_at at time zone 'Asia/Karachi', 'Dy DD Mon, HH12:MI AM')),
      jsonb_build_array(coalesce(t.company, t.title), coalesce(t.country, '-'),
                        to_char(t.due_at at time zone 'Asia/Karachi', 'Dy HH12:MI AM') || ' PKT'));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- What needs attention, as of a calendar day in the given time zone.
create or replace function public.today_summary(p_time_zone text default 'Asia/Karachi')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone p_time_zone)::date;
  r jsonb;
begin
  with
  new_inq as (
    select i.id, coalesce(c.company, i.id) as name, i.reply_due_at
    from public.inquiries i left join public.clients c on c.id = i.client_id
    where i.status = 'New'
  ),
  overdue as (
    select id from public.tasks where source = 'auto' and status <> 'Done' and due_at < now()
  ),
  follow as (
    select c.id, c.company as name from public.clients c where c.next_followup_at <= v_today
    union
    select c.id, c.company from public.inquiries i join public.clients c on c.id = i.client_id
    where i.status not in ('New', 'Accepted', 'Lost', 'Rejected', 'Closed', 'Cancelled', 'Converted')
      and coalesce(c.last_contacted_at, i.created_at) < now() - interval '7 days'
  ),
  open_orders as (
    select o.id, o.status, o.shipment_deadline, c.company as name,
           coalesce((select max(a.created_at) from public.order_activity a where a.order_id = o.id), o.created_at) as last_update
    from public.orders o left join public.clients c on c.id = o.client_id
    where o.status <> 'Delivered & Closed'
  ),
  stale as (select * from open_orders where last_update < now() - interval '7 days'),
  ships as (
    select o.id, o.name, o.shipment_deadline as d from open_orders o
    where o.status in ('Order Confirmed', 'Advance Payment Received', 'In Production', 'Ready to Ship')
      and o.shipment_deadline is not null and o.shipment_deadline <= v_today + 14
    union all
    select o.id, o.name, s.etd from open_orders o join public.shipments s on s.order_id = o.id
    where o.status in ('Order Confirmed', 'Advance Payment Received', 'In Production', 'Ready to Ship')
      and s.etd is not null and s.etd <= v_today + 14
    union all
    select o.id, o.name, s.eta from open_orders o join public.shipments s on s.order_id = o.id
    where o.status in ('Shipped', 'Balance Payment Received')
      and s.eta is not null and s.eta <= v_today + 14
  ),
  review as (
    select 'email' as src, coalesce(from_name, from_email) as name from public.inbound_emails where review_status = 'needs_review'
    union all
    select 'whatsapp', coalesce(from_name, from_phone) from public.inbound_whatsapp where review_status = 'needs_review'
  )
  select jsonb_build_object(
    'date', v_today,
    'new_inquiries', (select count(*) from new_inq),
    'overdue_replies', (select count(*) from overdue),
    'followups', (select count(*) from follow),
    'stale_orders', (select count(*) from stale),
    'shipments', (select count(*) from ships),
    'messages_to_check', (select count(*) from review),
    'lists', jsonb_build_object(
      'new_inquiries', (select coalesce(jsonb_agg(name order by reply_due_at), '[]') from (select * from new_inq order by reply_due_at limit 8) x),
      'followups', (select coalesce(jsonb_agg(name), '[]') from (select name from follow order by name limit 8) x),
      'stale_orders', (select coalesce(jsonb_agg(id || ' ' || coalesce(name, '') || ' (' || status || ')'), '[]') from (select * from stale order by last_update limit 8) x),
      'shipments', (select coalesce(jsonb_agg(id || ' ' || coalesce(name, '') || ' ' || to_char(d, 'DD Mon')), '[]') from (select * from ships order by d limit 8) x),
      'messages_to_check', (select coalesce(jsonb_agg(name), '[]') from (select name from review limit 8) x)
    )
  ) into r;
  return r;
end;
$$;

create or replace function public.queue_daily_digests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  s jsonb;
  local_now timestamp;
  n integer := 0;
  lines text;
begin
  for p in
    select * from public.profiles
    where role in ('Admin / Owner', 'Director', 'Sales Executive', 'Export Manager')
      and daily_digest
      and (nullif(notify_email, '') is not null or nullif(notify_whatsapp, '') is not null)
    for update skip locked
  loop
    local_now := now() at time zone p.time_zone;
    continue when extract(hour from local_now) < p.digest_hour;
    continue when p.last_digest_on is not null and p.last_digest_on >= local_now::date;

    s := public.today_summary(p.time_zone);
    lines := concat_ws(E'\n',
      format('New inquiries: %s%s', s->>'new_inquiries',
             case when (s->>'new_inquiries')::int > 0 then ' — ' || (select string_agg(v, ', ') from jsonb_array_elements_text(s->'lists'->'new_inquiries') v) end),
      format('Replies overdue: %s', s->>'overdue_replies'),
      format('Buyers to follow up: %s%s', s->>'followups',
             case when (s->>'followups')::int > 0 then ' — ' || (select string_agg(v, ', ') from jsonb_array_elements_text(s->'lists'->'followups') v) end),
      format('Orders to update: %s%s', s->>'stale_orders',
             case when (s->>'stale_orders')::int > 0 then ' — ' || (select string_agg(v, ', ') from jsonb_array_elements_text(s->'lists'->'stale_orders') v) end),
      format('Shipments in the next 14 days: %s%s', s->>'shipments',
             case when (s->>'shipments')::int > 0 then ' — ' || (select string_agg(v, ', ') from jsonb_array_elements_text(s->'lists'->'shipments') v) end),
      format('Messages to check: %s%s', s->>'messages_to_check',
             case when (s->>'messages_to_check')::int > 0 then ' — ' || (select string_agg(v, ', ') from jsonb_array_elements_text(s->'lists'->'messages_to_check') v) end),
      '', 'Open Today: https://app.kassamtradingcompany.com/today');

    perform public.notify_staff('daily_digest', 'digest:' || local_now::date,
      format('KTC today, %s', to_char(local_now, 'Dy DD Mon')), lines,
      jsonb_build_array(s->>'new_inquiries', s->>'overdue_replies', s->>'followups',
                        s->>'stale_orders', s->>'shipments', s->>'messages_to_check'),
      p.id);
    update public.profiles set last_digest_on = local_now::date where id = p.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Access
-- ---------------------------------------------------------------------------
alter table public.client_interactions enable row level security;
alter table public.inbound_whatsapp enable row level security;
alter table public.staff_notifications enable row level security;

drop policy if exists "staff read" on public.client_interactions;
drop policy if exists "editor insert" on public.client_interactions;
create policy "staff read" on public.client_interactions
  for select to authenticated using ((select public.is_staff()));
create policy "editor insert" on public.client_interactions
  for insert to authenticated with check ((select public.can_edit()));

drop policy if exists "staff read" on public.inbound_whatsapp;
create policy "staff read" on public.inbound_whatsapp
  for select to authenticated using ((select public.is_staff()));

drop policy if exists "own or admin read" on public.staff_notifications;
create policy "own or admin read" on public.staff_notifications
  for select to authenticated using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- Internal helpers: service role / triggers only.
revoke execute on function
  public.next_client_id(), public.next_inquiry_id(),
  public.log_interaction(text, text, text, text, text, text, text, text, timestamptz),
  public.notify_staff(text, text, text, text, jsonb, uuid),
  public.capture_inquiry(text, text, text, text, text, text, text, text, text, text, text),
  public.capture_website_submission(), public.process_inbound_email(), public.process_inbound_whatsapp(),
  public.log_email_message_interaction(), public.validate_profile_time_zone(),
  public.queue_overdue_followups(), public.today_summary(text), public.queue_daily_digests()
from public, anon, authenticated;
grant execute on function
  public.queue_overdue_followups(), public.queue_daily_digests(), public.today_summary(text)
to service_role;

revoke execute on function
  public.log_client_followup(text, integer, text, text),
  public.capture_message_as_inquiry(text, uuid, text, text, text, text, text),
  public.dismiss_message(text, uuid),
  public.set_order_status(text, text, text),
  public.company_key(text), public.normalize_phone(text, text), public.email_risk_flags(text, text, text, text, text[])
from public, anon;
grant execute on function
  public.log_client_followup(text, integer, text, text),
  public.capture_message_as_inquiry(text, uuid, text, text, text, text, text),
  public.dismiss_message(text, uuid),
  public.set_order_status(text, text, text),
  public.company_key(text), public.normalize_phone(text, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Schedule: staff-notifier every 10 minutes (same Vault secrets as the
--     email automation jobs)
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('ktc-staff-notifier')
  where exists (select 1 from cron.job where jobname = 'ktc-staff-notifier');
end $$;

select cron.schedule(
  'ktc-staff-notifier',
  '2,12,22,32,42,52 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ktc_project_url')
           || '/functions/v1/staff-notifier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ktc_automation_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

commit;
