-- Phase 2: Director mode (2026-09-27)
--
-- Director = sees everything, changes only what the Today screen needs:
--   * order stage and production %          -> set_order_status / set_order_progress
--   * "I followed up with this buyer"        -> log_client_followup
--   * finishing or moving a task             -> complete_task / reschedule_task
-- Everything else (editing clients, orders, payments, documents, email) needs an
-- editing role: Admin / Owner, Sales Executive or Export Manager.
-- Deleting is now Admin / Owner only (Director could delete before).
--
-- All status changes, from any screen, go through set_order_status so every change
-- is validated and logged in order_activity with who made it.
--
-- Apply with the SQL editor or `supabase db query --linked -f <this file>`.
-- Safe to re-run. No business rows are changed.

begin;

-- ---------------------------------------------------------------------------
-- 1. Editing role helper
-- ---------------------------------------------------------------------------
create or replace function public.can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select role in ('Admin / Owner', 'Sales Executive', 'Export Manager')
    from public.profiles where id = auth.uid()
  ), false)
$$;

revoke execute on function public.can_edit() from public, anon;
grant execute on function public.can_edit() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Policies: staff read, editors write, admin deletes
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  -- Tables that had "staff full access" (read + write + delete by any staff)
  foreach t in array array[
    'amazon_listings', 'amazon_sales', 'company_policies', 'document_checklist_templates',
    'email_campaigns', 'email_messages', 'email_replies', 'email_templates',
    'imap_sync_state', 'inquiry_items', 'order_documents', 'order_items',
    'order_payments', 'order_process_steps', 'order_sla', 'order_suppliers',
    'reexport_traders', 'shipments', 'suppliers',
    'email_suppressions', 'email_sequences', 'email_sequence_steps',
    'email_sequence_enrollments', 'email_broadcasts', 'email_automation_queue'
  ] loop
    execute format('drop policy if exists "staff full access" on public.%I', t);
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('drop policy if exists "editor insert" on public.%I', t);
    execute format('drop policy if exists "editor update" on public.%I', t);
    execute format('drop policy if exists "editor delete" on public.%I', t);
    execute format(
      'create policy "staff read" on public.%I for select to authenticated
         using ((select public.is_staff()))', t);
    execute format(
      'create policy "editor insert" on public.%I for insert to authenticated
         with check ((select public.can_edit()))', t);
    execute format(
      'create policy "editor update" on public.%I for update to authenticated
         using ((select public.can_edit())) with check ((select public.can_edit()))', t);
    execute format(
      'create policy "editor delete" on public.%I for delete to authenticated
         using ((select public.can_edit()))', t);
  end loop;

  -- Core records: editors add/edit, only Admin / Owner deletes
  foreach t in array array[
    'clients', 'inquiries', 'orders', 'products', 'tasks', 'public_inquiry_submissions'
  ] loop
    execute format('drop policy if exists "staff insert" on public.%I', t);
    execute format('drop policy if exists "staff update" on public.%I', t);
    execute format('drop policy if exists "admin or director delete" on public.%I', t);
    execute format('drop policy if exists "editor insert" on public.%I', t);
    execute format('drop policy if exists "editor update" on public.%I', t);
    execute format('drop policy if exists "admin delete" on public.%I', t);
    execute format(
      'create policy "editor insert" on public.%I for insert to authenticated
         with check ((select public.can_edit()))', t);
    execute format(
      'create policy "editor update" on public.%I for update to authenticated
         using ((select public.can_edit())) with check ((select public.can_edit()))', t);
    execute format(
      'create policy "admin delete" on public.%I for delete to authenticated
         using ((select public.is_admin()))', t);
  end loop;
end;
$$;

drop policy if exists "staff update" on public.inbound_emails;
drop policy if exists "editor update" on public.inbound_emails;
create policy "editor update" on public.inbound_emails
  for update to authenticated
  using ((select public.can_edit())) with check ((select public.can_edit()));

-- Storage: staff read, editors upload/replace/remove
drop policy if exists "staff upload crm files" on storage.objects;
drop policy if exists "staff update order documents" on storage.objects;
drop policy if exists "staff delete crm files" on storage.objects;
drop policy if exists "editor upload crm files" on storage.objects;
drop policy if exists "editor update order documents" on storage.objects;
drop policy if exists "editor delete crm files" on storage.objects;
create policy "editor upload crm files" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('order-documents', 'email-attachments') and (select public.can_edit()));
create policy "editor update order documents" on storage.objects
  for update to authenticated
  using (bucket_id = 'order-documents' and (select public.can_edit()))
  with check (bucket_id = 'order-documents' and (select public.can_edit()));
create policy "editor delete crm files" on storage.objects
  for delete to authenticated
  using (bucket_id in ('order-documents', 'email-attachments') and (select public.can_edit()));

-- ---------------------------------------------------------------------------
-- 3. Actions any staff member (including Director) can take
-- ---------------------------------------------------------------------------

-- Move an order to a stage. Choosing the current stage records "checked, no
-- change" so the order drops off the Today list. An optional note is logged.
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

  select status into current_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  if current_status is distinct from p_status then
    update public.orders set status = p_status where id = p_order_id; -- trigger logs status_changed
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

create or replace function public.set_order_progress(p_order_id text, p_progress integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then
    raise exception 'Progress must be between 0 and 100';
  end if;
  update public.orders set production_progress = p_progress where id = p_order_id; -- trigger logs change
  if not found then raise exception 'Order not found'; end if;
  return jsonb_build_object('id', p_order_id, 'production_progress', p_progress);
end;
$$;

-- "I've followed up with this buyer": stamps last contact, sets the next
-- follow-up date (Karachi calendar) and appends an optional dated note.
create or replace function public.log_client_followup(
  p_client_id text,
  p_next_in_days integer default 7,
  p_note text default null
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
  if clean_note is not null and char_length(clean_note) > 2000 then
    raise exception 'Note is too long';
  end if;

  next_date := (now() at time zone 'Asia/Karachi')::date + p_next_in_days;
  select coalesce(nullif(full_name, ''), email) into author from public.profiles where id = auth.uid();

  update public.clients
  set last_contacted_at = now(),
      last_activity = now(),
      next_followup_at = next_date,
      notes = case
        when clean_note is null then notes
        else concat_ws(E'\n', nullif(notes, ''),
          format('[%s %s] %s', to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM-DD'), author, clean_note))
      end
  where id = p_client_id;
  if not found then raise exception 'Buyer not found'; end if;

  return jsonb_build_object('id', p_client_id, 'next_followup_at', next_date);
end;
$$;

create or replace function public.complete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  update public.tasks set status = 'Done', updated_at = now() where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
end;
$$;

create or replace function public.reschedule_task(p_task_id uuid, p_due_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if p_due_date is null then raise exception 'Choose a date'; end if;
  update public.tasks set due_date = p_due_date, updated_at = now() where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
end;
$$;

revoke execute on function
  public.set_order_status(text, text, text),
  public.set_order_progress(text, integer),
  public.log_client_followup(text, integer, text),
  public.complete_task(uuid),
  public.reschedule_task(uuid, date)
from public, anon;

grant execute on function
  public.set_order_status(text, text, text),
  public.set_order_progress(text, integer),
  public.log_client_followup(text, integer, text),
  public.complete_task(uuid),
  public.reschedule_task(uuid, date)
to authenticated;

commit;
