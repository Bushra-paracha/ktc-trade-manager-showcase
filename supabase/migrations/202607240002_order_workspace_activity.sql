-- Phase 2 order workspace activity coverage.
-- Additive only: records operational changes without altering existing business rows.

create or replace function public.audit_order_operational_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.production_progress is distinct from new.production_progress then
    insert into public.order_activity(order_id, event_type, from_value, to_value)
    values (new.id, 'production_progress_changed', old.production_progress::text, new.production_progress::text);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_operational_audit on public.orders;
create trigger orders_operational_audit
after update of production_progress on public.orders
for each row execute function public.audit_order_operational_change();

create or replace function public.audit_order_child_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order_id text;
  event_name text;
  old_value text;
  new_value text;
begin
  target_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  if tg_table_name = 'order_payments' then
    event_name := case tg_op when 'INSERT' then 'payment_recorded' when 'DELETE' then 'payment_removed' else 'payment_updated' end;
    old_value := case when tg_op <> 'INSERT' then concat(old.payment_type, ':', old.status, ':', old.amount) end;
    new_value := case when tg_op <> 'DELETE' then concat(new.payment_type, ':', new.status, ':', new.amount) end;
  elsif tg_table_name = 'shipments' then
    event_name := case tg_op when 'INSERT' then 'shipment_added' when 'DELETE' then 'shipment_removed' else 'shipment_updated' end;
    old_value := case when tg_op <> 'INSERT' then old.status end;
    new_value := case when tg_op <> 'DELETE' then new.status end;
  else
    event_name := case tg_op when 'INSERT' then 'document_added' when 'DELETE' then 'document_removed' else 'document_updated' end;
    old_value := case when tg_op <> 'INSERT' then old.status end;
    new_value := case when tg_op <> 'DELETE' then new.status end;
  end if;

  insert into public.order_activity(order_id, event_type, from_value, to_value)
  values (target_order_id, event_name, old_value, new_value);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists order_payments_activity_audit on public.order_payments;
create trigger order_payments_activity_audit
after insert or update or delete on public.order_payments
for each row execute function public.audit_order_child_change();

drop trigger if exists shipments_activity_audit on public.shipments;
create trigger shipments_activity_audit
after insert or update or delete on public.shipments
for each row execute function public.audit_order_child_change();

drop trigger if exists order_documents_activity_audit on public.order_documents;
create trigger order_documents_activity_audit
after insert or update or delete on public.order_documents
for each row execute function public.audit_order_child_change();

create or replace function public.touch_order_payment_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists order_payments_touch_updated_at on public.order_payments;
create trigger order_payments_touch_updated_at
before update on public.order_payments
for each row execute function public.touch_order_payment_updated_at();
