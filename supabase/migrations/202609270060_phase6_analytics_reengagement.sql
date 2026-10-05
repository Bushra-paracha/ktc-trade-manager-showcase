-- Phase 6: analytics, dormant buyers, outreach replies into the pipeline (2026-09-27)
--
--   * analytics_summary(days): KPIs, inquiry funnel, revenue by country / product,
--     monthly trend, lead-source performance, reply times and outreach results,
--     computed in the database so every screen uses the same definitions.
--   * dormant_clients(days): buyers we've been in touch with but not for N days
--     (never-contacted leads aren't dormant, they're new), for the Re-engage page.
--   * create_client_inquiry(): a New inquiry + 4-hour reply task for an existing
--     buyer, e.g. from an outreach reply (source_ref 'email_replies:<id>') or the
--     client profile.
--
-- Apply with the SQL editor or `supabase db query --linked -f <this file>`. Safe to re-run.

begin;

create or replace function public.analytics_summary(p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  since timestamptz := case when coalesce(p_days, 0) > 0 then now() - make_interval(days => p_days) else '-infinity'::timestamptz end;
  r jsonb;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;

  with
  inq as (
    select i.*, c.country, c.source as client_source,
           exists (select 1 from public.orders o where o.inquiry_id = i.id) as has_order
    from public.inquiries i left join public.clients c on c.id = i.client_id
    where i.created_at >= since
  ),
  ord as (
    select o.*, c.country, c.source as client_source
    from public.orders o left join public.clients c on c.id = o.client_id
    where o.created_at >= since
  ),
  stage as (
    select
      count(*) as received,
      count(*) filter (where replied_at is not null or status <> 'New' or has_order) as replied,
      count(*) filter (where status in ('Quote Sent', 'In Negotiation', 'Accepted', 'Rejected', 'Expired') or has_order) as quoted,
      count(*) filter (where status in ('In Negotiation', 'Accepted') or has_order) as negotiating,
      count(*) filter (where status = 'Accepted' or has_order) as won
    from inq
  ),
  reply as (
    select extract(epoch from (replied_at - created_at)) / 3600.0 as hours
    from inq where replied_at is not null and replied_at >= created_at
  ),
  msgs as (
    select * from public.email_messages where coalesce(sent_at, created_at) >= since
  )
  select jsonb_build_object(
    'days', p_days,
    'kpis', jsonb_build_object(
      'open_inquiries', (select count(*) from public.inquiries where status not in ('Accepted', 'Rejected', 'Expired', 'Lost', 'Closed', 'Cancelled')),
      'open_inquiry_value', (select coalesce(sum(total_value), 0) from public.inquiries where status not in ('Accepted', 'Rejected', 'Expired', 'Lost', 'Closed', 'Cancelled')),
      'open_orders', (select count(*) from public.orders where status <> 'Delivered & Closed'),
      'open_order_value', (select coalesce(sum(total_value), 0) from public.orders where status <> 'Delivered & Closed'),
      'orders', (select count(*) from ord),
      'order_value', (select coalesce(sum(total_value), 0) from ord),
      'inquiries', (select received from stage),
      'conversion_pct', (select case when received > 0 then round(100.0 * won / received, 1) end from stage),
      'median_reply_hours', (select round((percentile_cont(0.5) within group (order by hours))::numeric, 1) from reply),
      'replied_within_4h_pct', (select case when count(*) > 0 then round(100.0 * count(*) filter (where hours <= 4) / count(*), 0) end from reply),
      'replied_count', (select count(*) from reply)
    ),
    'funnel', (select jsonb_build_array(
        jsonb_build_object('stage', 'Received', 'count', received),
        jsonb_build_object('stage', 'Replied', 'count', replied),
        jsonb_build_object('stage', 'Quoted', 'count', quoted),
        jsonb_build_object('stage', 'Negotiating', 'count', negotiating),
        jsonb_build_object('stage', 'Won', 'count', won)) from stage),
    'revenue_by_country', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value, 'orders', n) order by value desc), '[]')
      from (select coalesce(nullif(country, ''), 'Unknown') as label, sum(total_value) as value, count(*) as n
            from ord group by 1 order by 2 desc limit 10) x),
    'revenue_by_product', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value, 'mt', mt) order by value desc), '[]')
      from (select coalesce(nullif(oi.product_name, ''), 'Unnamed') as label,
                   sum(coalesce(oi.line_total, oi.quantity_mt * oi.unit_price, 0)) as value, sum(oi.quantity_mt) as mt
            from public.order_items oi join ord on ord.id = oi.order_id
            group by 1 order by 2 desc limit 10) x),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon YY'), 'inquiries', inquiries, 'order_value', order_value) order by m), '[]')
      from (select m,
                   (select count(*) from public.inquiries i where date_trunc('month', i.created_at) = m) as inquiries,
                   (select coalesce(sum(o.total_value), 0) from public.orders o where date_trunc('month', o.created_at) = m) as order_value
            from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m) x),
    'sources', (select coalesce(jsonb_agg(row_to_json(x) order by x.clients desc), '[]')
      from (select coalesce(nullif(c.source, ''), 'Unknown') as source,
                   count(*) as clients,
                   count(*) filter (where c.last_contacted_at is not null) as contacted,
                   count(*) filter (where exists (select 1 from inq where inq.client_id = c.id)) as with_inquiry,
                   count(*) filter (where exists (select 1 from ord where ord.client_id = c.id)) as with_order,
                   coalesce(sum((select sum(total_value) from ord where ord.client_id = c.id)), 0) as revenue
            from public.clients c group by 1) x),
    'outreach', jsonb_build_object(
      'sent', (select count(*) from msgs where status in ('Sent', 'Delivered', 'Opened', 'Clicked', 'Replied', 'Bounced')),
      'opened', (select count(*) from msgs where (opened_at is not null or status in ('Opened', 'Clicked', 'Replied')) and status <> 'Bounced'),
      'replied', (select count(*) from msgs where replied_at is not null or status = 'Replied'),
      'bounced', (select count(*) from msgs where status = 'Bounced'),
      'inquiries_from_replies', (select count(*) from inq where source_ref like 'email_replies:%' or source_ref like 'email_messages:%')
    )
  ) into r;
  return r;
end;
$$;

-- Buyers we've contacted before but not for p_days (any pipeline stage except Lost).
create or replace function public.dormant_clients(p_days integer default 90)
returns table (
  id text, company text, country text, contact text, email text, status text, email_status text,
  last_contacted_at timestamptz, days_quiet integer, orders integer, in_sequence boolean, products text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.company, c.country, c.contact, public.primary_email(c.email), c.status, c.email_status,
         c.last_contacted_at, (current_date - c.last_contacted_at::date)::integer,
         (select count(*) from public.orders o where o.client_id = c.id)::integer,
         exists (select 1 from public.email_sequence_enrollments e
                 where e.status = 'Active' and public.normalize_email(e.to_email) = public.primary_email(c.email)),
         nullif(regexp_replace(coalesce(c.products_interest::text, ''), '[\[\]{}"]', '', 'g'), '')
  from public.clients c
  where public.is_staff()
    and c.last_contacted_at is not null
    and c.last_contacted_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
    and c.status <> 'Lost'
  order by c.last_contacted_at asc
$$;

-- A New inquiry (+ reply task + alert) for an existing buyer.
create or replace function public.create_client_inquiry(
  p_client_id text,
  p_product text default null,
  p_quantity text default null,
  p_note text default null,
  p_source_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.clients;
  v_table text;
  v_id text;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  select * into c from public.clients where id = p_client_id;
  if not found then raise exception 'Buyer not found'; end if;
  if p_source_ref is not null then
    v_table := split_part(p_source_ref, ':', 1);
    v_id := substr(p_source_ref, length(v_table) + 2);
    if v_table not in ('email_replies', 'email_messages') or v_id = '' then raise exception 'Unknown source'; end if;
  end if;
  update public.clients set status = 'Engaged'
    where id = c.id and status in ('New', 'Contacted', 'Dormant');
  return public.capture_inquiry(
    case when p_source_ref is not null then 'email' else 'manual' end,
    c.company, c.contact, c.email, coalesce(c.whatsapp_number, c.phone), c.country,
    p_product, p_quantity, p_note, v_table, v_id);
end;
$$;

revoke execute on function public.analytics_summary(integer), public.dormant_clients(integer),
  public.create_client_inquiry(text, text, text, text, text) from public, anon;
grant execute on function public.analytics_summary(integer), public.dormant_clients(integer),
  public.create_client_inquiry(text, text, text, text, text) to authenticated;

commit;
