-- Phase 5: client records, inventory and suppliers (2026-09-27)
--
--   * Buyers: trade preferences (Incoterm, destination ports, packing, payment
--     terms), extra contacts (client_contacts), and statuses standardised to the
--     pipeline New / Contacted / Engaged / Negotiating / Won / Lost / Dormant. The
--     old wording is kept in clients.status_detail; nothing is deleted.
--   * Products: the missing catalogue items, a low-stock level and an active flag.
--   * Inventory: every stock change is a row in inventory_movements; products.stock_mt
--     is kept equal to their sum. Shipping an order books the sale automatically
--     (and moving it back reverses it). product_stock shows on hand, reserved
--     (open orders not yet shipped) and available, and flags low stock, which
--     also appears on Today and in the morning summary.
--   * Suppliers linked to orders: order_suppliers gains product and quantity.
--
-- Apply with the SQL editor or `supabase db query --linked -f <this file>`. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. Buyer records
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists status_detail text,
  add column if not exists preferred_incoterm text,
  add column if not exists destination_ports text,
  add column if not exists packing_preference text,
  add column if not exists payment_terms text;

-- Standardise statuses; keep the old wording as detail.
update public.clients set status_detail = coalesce(status_detail, 'No email (WhatsApp/phone only)'), status = 'New'
  where status = 'New - No Email (WhatsApp/Phone Only)';
update public.clients set status_detail = coalesce(status_detail, 'Needs qualification'), status = 'New'
  where status = 'Prospect - Needs Qualification';
update public.clients set status_detail = coalesce(status_detail, 'Email research needed'), status = 'New'
  where status = 'New - Email Research Needed';
update public.clients c set status_detail = coalesce(status_detail, 'Hot lead'),
  status = case when exists (select 1 from public.inquiries i where i.client_id = c.id
                             and i.status in ('Negotiating', 'In Negotiation')) then 'Negotiating' else 'Engaged' end
  where status = 'Hot';
update public.clients c set status_detail = coalesce(status_detail, 'Was Customer'),
  status = case when exists (select 1 from public.orders o where o.client_id = c.id) then 'Won' else 'Engaged' end
  where status = 'Customer';
update public.clients set status_detail = coalesce(status_detail, 'Was Active'), status = 'Engaged'
  where status = 'Active';
update public.clients c set status_detail = coalesce(status_detail, 'Was Closed'),
  status = case when exists (select 1 from public.orders o where o.client_id = c.id) then 'Won' else 'Lost' end
  where status = 'Closed';
update public.clients set status = 'New' where status is null or btrim(status) = '';

alter table public.clients alter column status set default 'New';
alter table public.clients drop constraint if exists clients_status_check;
alter table public.clients add constraint clients_status_check
  check (status in ('New', 'Contacted', 'Engaged', 'Negotiating', 'Won', 'Lost', 'Dormant'));

-- Same idea for the handful of legacy inquiry statuses.
update public.inquiries set status = 'In Negotiation' where status in ('Negotiating', 'Active');

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  whatsapp text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_contacts_client_idx on public.client_contacts (client_id);

create or replace function public.normalize_client_contact()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_country text;
begin
  select country into v_country from public.clients where id = new.client_id;
  new.name := btrim(new.name);
  new.email := public.normalize_email(new.email);
  new.phone := public.normalize_phone(new.phone, v_country);
  new.whatsapp := public.normalize_phone(new.whatsapp, v_country);
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists normalize_client_contact on public.client_contacts;
create trigger normalize_client_contact
before insert or update on public.client_contacts
for each row execute function public.normalize_client_contact();

-- ---------------------------------------------------------------------------
-- 2. Products
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists low_stock_mt numeric(12,2) check (low_stock_mt is null or low_stock_mt >= 0),
  add column if not exists active boolean not null default true;

insert into public.products (id, name, category, unit, stock_mt)
select format('P-%s', lpad((m.max_n + row_number() over (order by v.sort))::text, 3, '0')), v.name, v.category, 'USD/MT', 0
from (values
  (1, '1121 Kainaat Basmati Rice', 'Rice'),
  (2, 'Super Kernel Basmati Rice', 'Rice'),
  (3, 'Super Fine Basmati Rice', 'Rice'),
  (4, 'PK-385 Basmati Rice', 'Rice'),
  (5, 'D-98 Basmati Rice', 'Rice'),
  (6, 'IRRI-9 Long Grain Rice', 'Rice'),
  (7, 'KS-282 Long Grain Rice', 'Rice'),
  (8, 'Yellow Corn / Maize', 'Grain'),
  (9, 'Wheat', 'Grain')
) as v(sort, name, category)
cross join (select coalesce(max((regexp_match(id, '^P-(\d+)$'))[1]::integer), 0) as max_n from public.products) m
where not exists (select 1 from public.products p where lower(p.name) = lower(v.name));

-- ---------------------------------------------------------------------------
-- 3. Inventory
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete restrict,
  kind text not null check (kind in ('opening', 'production', 'purchase', 'sale', 'return', 'adjustment')),
  quantity_mt numeric(12,3) not null check (quantity_mt <> 0),
  movement_date date not null default ((now() at time zone 'Asia/Karachi')::date),
  order_id text references public.orders(id) on delete set null,
  order_item_id uuid references public.order_items(id) on delete set null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  -- Stock coming in is positive, going out negative.
  constraint inventory_movements_sign_check check (
    (kind in ('opening', 'production', 'purchase', 'return') and quantity_mt > 0)
    or (kind = 'sale' and quantity_mt < 0)
    or kind = 'adjustment')
);
create index if not exists inventory_movements_product_idx on public.inventory_movements (product_id, movement_date desc);
create index if not exists inventory_movements_item_idx on public.inventory_movements (order_item_id) where order_item_id is not null;

create or replace function public.sync_product_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid text := coalesce(new.product_id, old.product_id);
begin
  update public.products
    set stock_mt = coalesce((select sum(quantity_mt) from public.inventory_movements where product_id = pid), 0)
    where id = pid;
  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    update public.products
      set stock_mt = coalesce((select sum(quantity_mt) from public.inventory_movements where product_id = old.product_id), 0)
      where id = old.product_id;
  end if;
  return null;
end;
$$;
drop trigger if exists sync_product_stock on public.inventory_movements;
create trigger sync_product_stock
after insert or update or delete on public.inventory_movements
for each row execute function public.sync_product_stock();

-- Any stock already recorded on products becomes its opening balance.
insert into public.inventory_movements (product_id, kind, quantity_mt, note, created_by)
select p.id, 'opening', p.stock_mt, 'Opening balance from product record', null
from public.products p
where coalesce(p.stock_mt, 0) > 0
  and not exists (select 1 from public.inventory_movements m where m.product_id = p.id);

-- Shipping books the sale; moving an order back before Shipped reverses it.
create or replace function public.book_order_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shipped_statuses constant text[] := array['Shipped', 'Balance Payment Received', 'Delivered & Closed'];
  was_shipped boolean := old.status = any(shipped_statuses);
  now_shipped boolean := new.status = any(shipped_statuses);
  item record;
  net numeric;
begin
  if was_shipped = now_shipped then return new; end if;

  for item in
    select oi.id, oi.product_id, oi.quantity_mt from public.order_items oi
    where oi.order_id = new.id and oi.product_id is not null and coalesce(oi.quantity_mt, 0) > 0
      and exists (select 1 from public.products p where p.id = oi.product_id)
  loop
    select coalesce(sum(quantity_mt), 0) into net from public.inventory_movements where order_item_id = item.id;
    if now_shipped and net = 0 then
      insert into public.inventory_movements (product_id, kind, quantity_mt, order_id, order_item_id, note)
      values (item.product_id, 'sale', -item.quantity_mt, new.id, item.id, format('Shipped on order %s', new.id));
    elsif not now_shipped and net < 0 then
      insert into public.inventory_movements (product_id, kind, quantity_mt, order_id, order_item_id, note)
      values (item.product_id, 'return', -net, new.id, item.id, format('Order %s moved back to %s', new.id, new.status));
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists book_order_stock on public.orders;
create trigger book_order_stock
after update of status on public.orders
for each row execute function public.book_order_stock();

-- On hand, reserved for open orders, available, and the low-stock flag.
create or replace view public.product_stock
with (security_invoker = true) as
select
  p.id as product_id,
  p.name,
  p.category,
  p.unit,
  p.active,
  p.low_stock_mt,
  coalesce(p.stock_mt, 0) as on_hand_mt,
  coalesce(r.reserved_mt, 0) as reserved_mt,
  coalesce(p.stock_mt, 0) - coalesce(r.reserved_mt, 0) as available_mt,
  (p.low_stock_mt is not null and coalesce(p.stock_mt, 0) - coalesce(r.reserved_mt, 0) < p.low_stock_mt) as is_low
from public.products p
left join (
  select oi.product_id, sum(oi.quantity_mt) as reserved_mt
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status in ('Order Confirmed', 'Advance Payment Received', 'In Production', 'Ready to Ship')
  group by oi.product_id
) r on r.product_id = p.id;

-- ---------------------------------------------------------------------------
-- 4. Suppliers on orders
-- ---------------------------------------------------------------------------
alter table public.order_suppliers
  add column if not exists product text,
  add column if not exists quantity_mt numeric(12,3);

-- ---------------------------------------------------------------------------
-- 5. Low stock on Today and in the morning summary
-- ---------------------------------------------------------------------------
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
    where i.status not in ('New', 'Accepted', 'Lost', 'Rejected', 'Closed', 'Cancelled', 'Converted', 'Expired')
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
  ),
  low as (
    select name, available_mt from public.product_stock where active and is_low
  )
  select jsonb_build_object(
    'date', v_today,
    'new_inquiries', (select count(*) from new_inq),
    'overdue_replies', (select count(*) from overdue),
    'followups', (select count(*) from follow),
    'stale_orders', (select count(*) from stale),
    'shipments', (select count(*) from ships),
    'messages_to_check', (select count(*) from review),
    'low_stock', (select count(*) from low),
    'lists', jsonb_build_object(
      'new_inquiries', (select coalesce(jsonb_agg(name order by reply_due_at), '[]') from (select * from new_inq order by reply_due_at limit 8) x),
      'followups', (select coalesce(jsonb_agg(name), '[]') from (select name from follow order by name limit 8) x),
      'stale_orders', (select coalesce(jsonb_agg(id || ' ' || coalesce(name, '') || ' (' || status || ')'), '[]') from (select * from stale order by last_update limit 8) x),
      'shipments', (select coalesce(jsonb_agg(id || ' ' || coalesce(name, '') || ' ' || to_char(d, 'DD Mon')), '[]') from (select * from ships order by d limit 8) x),
      'messages_to_check', (select coalesce(jsonb_agg(name), '[]') from (select name from review limit 8) x),
      'low_stock', (select coalesce(jsonb_agg(name || ' (' || round(available_mt, 1) || ' MT available)'), '[]') from (select * from low order by available_mt limit 8) x)
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
      case when (s->>'low_stock')::int > 0 then format('Stock running low: %s — %s', s->>'low_stock',
             (select string_agg(v, ', ') from jsonb_array_elements_text(s->'lists'->'low_stock') v)) end,
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
-- 6. Access
-- ---------------------------------------------------------------------------
alter table public.client_contacts enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "staff read" on public.client_contacts;
drop policy if exists "editor insert" on public.client_contacts;
drop policy if exists "editor update" on public.client_contacts;
drop policy if exists "editor delete" on public.client_contacts;
create policy "staff read" on public.client_contacts for select to authenticated using ((select public.is_staff()));
create policy "editor insert" on public.client_contacts for insert to authenticated with check ((select public.can_edit()));
create policy "editor update" on public.client_contacts for update to authenticated
  using ((select public.can_edit())) with check ((select public.can_edit()));
create policy "editor delete" on public.client_contacts for delete to authenticated using ((select public.can_edit()));

-- Stock history is append-only for editors; corrections are adjustment rows.
drop policy if exists "staff read" on public.inventory_movements;
drop policy if exists "editor insert" on public.inventory_movements;
drop policy if exists "admin delete" on public.inventory_movements;
create policy "staff read" on public.inventory_movements for select to authenticated using ((select public.is_staff()));
create policy "editor insert" on public.inventory_movements for insert to authenticated
  with check ((select public.can_edit()) and kind in ('opening', 'production', 'purchase', 'adjustment', 'return'));
create policy "admin delete" on public.inventory_movements for delete to authenticated using ((select public.is_admin()));

grant select on public.product_stock to authenticated;

revoke execute on function
  public.normalize_client_contact(), public.sync_product_stock(), public.book_order_stock(),
  public.today_summary(text), public.queue_daily_digests()
from public, anon, authenticated;
grant execute on function public.today_summary(text), public.queue_daily_digests() to service_role;

commit;
