-- Phase 1 security hardening (2026-09-27)
--
-- HOW TO APPLY: paste into Supabase → SQL Editor and run once. The earlier repo
-- migrations were applied by hand, so `supabase db push` would try to re-run all
-- of them; do not use it until the migration history is repaired.
--
-- Safe to re-run. No business rows are changed or deleted. What it does:
--   1. Role helpers. Only users with an approved role (is_staff) can see or change
--      CRM data. New sign-ups get role 'Pending' and see nothing until an Admin /
--      Owner assigns a role in Settings.
--   2. Users can no longer promote themselves (profiles.role was self-editable).
--   3. Closes the public leak through view inquiry_items_restricted (anon could
--      read and edit quoted prices).
--   4. Removes all anon access except submitting the public quote form, buyer
--      order tracking and the public product list.
--   5. Rebuilds every CRM table policy on is_staff(); deletes on clients,
--      inquiries, orders, products, tasks and website submissions stay limited to
--      Admin / Owner and Director (duplicate policies had silently reopened them).
--   6. Locks trigger/internal functions so they cannot be called over the API.
--
-- NOT covered here (dashboard settings): Auth → Password security → enable
-- leaked password protection.

begin;

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------
alter table public.profiles alter column role set default 'Pending';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('Admin / Owner', 'Director', 'Sales Executive', 'Export Manager', 'Pending'));

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select role in ('Admin / Owner', 'Director', 'Sales Executive', 'Export Manager')
    from public.profiles where id = auth.uid()
  ), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'Admin / Owner' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin_or_director()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select role in ('Admin / Owner', 'Director') from public.profiles where id = auth.uid()
  ), false)
$$;

-- Only an Admin / Owner may change anyone's role. auth.uid() is null in the SQL
-- editor and for the service role, so manual fixes still work.
create or replace function public.guard_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only an Admin / Owner can change user roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_change on public.profiles;
create trigger profiles_guard_role_change
before update of role on public.profiles
for each row execute function public.guard_profile_role_change();

alter function public.handle_new_user() set search_path = public;
alter function public.update_client_last_contacted() set search_path = public;
alter function public.rescore_clients() set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Order RPCs: require an approved staff role, not just any login
-- ---------------------------------------------------------------------------
create or replace function public.create_order(
  p_client_id text,
  p_status text default 'Order Confirmed',
  p_incoterm text default 'FOB',
  p_payment_method text default 'LC'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order public.orders;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if p_status not in (
    'Order Confirmed', 'Advance Payment Received', 'In Production',
    'Ready to Ship', 'Shipped', 'Balance Payment Received', 'Delivered & Closed'
  ) then raise exception 'Invalid order status'; end if;

  insert into public.orders(id, client_id, status, incoterm, payment_method, total_value, production_progress)
  values (public.next_order_number(), p_client_id, p_status, p_incoterm, p_payment_method, 0, 0)
  returning * into new_order;

  insert into public.order_activity(order_id, event_type, to_value)
  values (new_order.id, 'order_created', new_order.status);
  return to_jsonb(new_order);
end;
$$;

create or replace function public.convert_inquiry_to_order(p_inquiry_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_inquiry public.inquiries;
  new_order public.orders;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  select * into source_inquiry from public.inquiries where id = p_inquiry_id for update;
  if not found then raise exception 'Inquiry not found'; end if;

  insert into public.orders(
    id, inquiry_id, client_id, incoterm, payment_method, pod_port,
    total_value, status, production_progress
  ) values (
    public.next_order_number(), source_inquiry.id, source_inquiry.client_id,
    source_inquiry.incoterm, source_inquiry.payment_terms, source_inquiry.destination_port,
    source_inquiry.total_value, 'Order Confirmed', 0
  ) returning * into new_order;

  insert into public.order_items(order_id, product_id, product_name, quantity_mt, unit_price, line_total)
  select new_order.id, product_id, product_name, quantity_mt, unit_price, line_total
  from public.inquiry_items where inquiry_id = source_inquiry.id;

  insert into public.order_documents(order_id, document_type, responsible_party, status)
  select new_order.id, document_type, responsible_party, 'Pending'
  from public.document_checklist_templates;

  update public.inquiries set status = 'Accepted' where id = source_inquiry.id;
  insert into public.order_activity(order_id, event_type, to_value, metadata)
  values (new_order.id, 'inquiry_converted', new_order.status, jsonb_build_object('inquiry_id', source_inquiry.id));
  return to_jsonb(new_order);
end;
$$;

create or replace function public.rotate_buyer_tracking_token(p_order_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  update public.orders
  set tracking_token_hash = extensions.digest(raw_token, 'sha256'),
      tracking_token_created_at = now()
  where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  insert into public.order_activity(order_id, event_type) values (p_order_id, 'tracking_link_rotated');
  return raw_token;
end;
$$;

-- Product names for the public quote form (no costs, stock or HS codes).
create or replace function public.public_product_catalog()
returns table (id text, name text, category text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.category from public.products p order by p.name
$$;

-- ---------------------------------------------------------------------------
-- 3. Leaky view: run with the caller's permissions, no anon access
-- ---------------------------------------------------------------------------
alter view public.inquiry_items_restricted set (security_invoker = true);
revoke all on public.inquiry_items_restricted from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.inquiry_items_restricted from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Anon: nothing except the public quote form, tracking and product list
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant insert on public.public_inquiry_submissions to anon;

-- Stop new tables/functions from being exposed to anon by default.
-- If a future feature needs public access, grant it explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

revoke execute on all functions in schema public from public, anon;

-- Trigger / internal functions are never called directly.
revoke execute on function
  public.audit_order_child_change(),
  public.audit_order_operational_change(),
  public.audit_order_process_step(),
  public.audit_order_status_change(),
  public.queue_order_status_notification(),
  public.sync_order_automation(),
  public.seed_new_order_process_steps(),
  public.update_client_last_contacted(),
  public.handle_new_user(),
  public.touch_order_payment_updated_at(),
  public.guard_profile_role_change(),
  public.rls_auto_enable(),
  public.process_order_automation()
from authenticated;

grant execute on function
  public.is_staff(),
  public.is_admin(),
  public.is_admin_or_director(),
  public.rescore_clients(),
  public.next_order_number(),
  public.create_order(text, text, text, text),
  public.convert_inquiry_to_order(text),
  public.rotate_buyer_tracking_token(text),
  public.seed_order_process_steps(text)
to authenticated;

grant execute on function public.get_buyer_order_tracking(text) to anon, authenticated;
grant execute on function public.public_product_catalog() to anon, authenticated;
grant execute on function public.process_order_automation() to service_role;

-- ---------------------------------------------------------------------------
-- 5. Table policies (drop every existing CRM policy, then rebuild)
-- ---------------------------------------------------------------------------
do $$
declare
  pol record;
  t text;
  crm_tables text[] := array[
    'amazon_listings', 'amazon_sales', 'clients', 'company_policies',
    'document_checklist_templates', 'email_campaigns', 'email_messages',
    'email_replies', 'email_templates', 'imap_sync_state', 'inbound_emails',
    'inquiries', 'inquiry_items', 'notification_outbox', 'order_activity',
    'order_documents', 'order_items', 'order_payments', 'order_process_steps',
    'order_sla', 'order_suppliers', 'orders', 'products', 'profiles',
    'public_inquiry_submissions', 'reexport_traders', 'repeat_order_reminders',
    'shipments', 'suppliers', 'tasks'
  ];
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename = any(crm_tables)
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;

  foreach t in array crm_tables loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Staff: full access
  foreach t in array array[
    'amazon_listings', 'amazon_sales', 'company_policies', 'document_checklist_templates',
    'email_campaigns', 'email_messages', 'email_replies', 'email_templates',
    'imap_sync_state', 'inquiry_items', 'order_documents', 'order_items',
    'order_payments', 'order_process_steps', 'order_sla', 'order_suppliers',
    'reexport_traders', 'shipments', 'suppliers'
  ] loop
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated
         using ((select public.is_staff())) with check ((select public.is_staff()))', t);
  end loop;

  -- Staff: read / add / edit. Admin / Owner or Director: delete.
  foreach t in array array[
    'clients', 'inquiries', 'orders', 'products', 'tasks', 'public_inquiry_submissions'
  ] loop
    execute format(
      'create policy "staff read" on public.%I for select to authenticated
         using ((select public.is_staff()))', t);
    execute format(
      'create policy "staff insert" on public.%I for insert to authenticated
         with check ((select public.is_staff()))', t);
    execute format(
      'create policy "staff update" on public.%I for update to authenticated
         using ((select public.is_staff())) with check ((select public.is_staff()))', t);
    execute format(
      'create policy "admin or director delete" on public.%I for delete to authenticated
         using ((select public.is_admin_or_director()))', t);
  end loop;

  -- Staff: read only (written by triggers, cron or edge functions)
  foreach t in array array['notification_outbox', 'order_activity', 'repeat_order_reminders'] loop
    execute format(
      'create policy "staff read" on public.%I for select to authenticated
         using ((select public.is_staff()))', t);
  end loop;
end;
$$;

-- Inbound email: edge functions insert with the service role; staff read and update.
create policy "staff read" on public.inbound_emails
  for select to authenticated using ((select public.is_staff()));
create policy "staff update" on public.inbound_emails
  for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Website quote form: anyone may submit, only as a new submission and within sane sizes.
create policy "public submit inquiry" on public.public_inquiry_submissions
  for insert to anon, authenticated
  with check (
    coalesce(status, 'New') = 'New'
    and char_length(coalesce(full_name, '')) <= 200
    and char_length(coalesce(company_name, '')) <= 200
    and char_length(coalesce(email, '')) <= 320
    and char_length(coalesce(phone, '')) <= 40
    and char_length(coalesce(country, '')) <= 100
    and char_length(coalesce(product_interest, '')) <= 200
    and char_length(coalesce(quantity_estimate, '')) <= 200
    and char_length(coalesce(message, '')) <= 5000
  );

-- Profiles: staff see the team; everyone sees their own row (so a Pending user
-- can be told they are waiting for approval). Own name is editable; roles are
-- guarded by the trigger above. Admin / Owner can edit anyone (Settings → Users).
create policy "read profiles" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "admin update profiles" on public.profiles
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 6. Storage (removes the duplicated policies, requires staff)
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated read order documents" on storage.objects;
drop policy if exists "Authenticated users can view order documents" on storage.objects;
drop policy if exists "authenticated upload order documents" on storage.objects;
drop policy if exists "Authenticated users can upload order documents" on storage.objects;
drop policy if exists "authenticated update order documents" on storage.objects;
drop policy if exists "Authenticated users can update order documents" on storage.objects;
drop policy if exists "authenticated delete order documents" on storage.objects;
drop policy if exists "Authenticated users can delete order documents" on storage.objects;
drop policy if exists "Authenticated users can read email attachments" on storage.objects;
drop policy if exists "Authenticated users can upload email attachments" on storage.objects;
drop policy if exists "Authenticated users can delete email attachments" on storage.objects;
drop policy if exists "staff read crm files" on storage.objects;
drop policy if exists "staff upload crm files" on storage.objects;
drop policy if exists "staff update order documents" on storage.objects;
drop policy if exists "staff delete crm files" on storage.objects;

create policy "staff read crm files" on storage.objects
  for select to authenticated
  using (bucket_id in ('order-documents', 'email-attachments') and (select public.is_staff()));
create policy "staff upload crm files" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('order-documents', 'email-attachments') and (select public.is_staff()));
create policy "staff update order documents" on storage.objects
  for update to authenticated
  using (bucket_id = 'order-documents' and (select public.is_staff()))
  with check (bucket_id = 'order-documents' and (select public.is_staff()));
create policy "staff delete crm files" on storage.objects
  for delete to authenticated
  using (bucket_id in ('order-documents', 'email-attachments') and (select public.is_staff()));

commit;

-- ---------------------------------------------------------------------------
-- After running, these should all return zero rows:
--
-- select table_name, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and grantee = 'anon'
--   and not (table_name = 'public_inquiry_submissions' and privilege_type = 'INSERT');
--
-- select tablename, policyname from pg_policies
--   where schemaname = 'public' and (qual = 'true' or with_check = 'true')
--   and tablename not like 'ktc_money%';
-- ---------------------------------------------------------------------------
