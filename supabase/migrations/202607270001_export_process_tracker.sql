-- A-to-Z export process tracker based on the KTC operating workflow.
create extension if not exists pgcrypto;

create table if not exists public.order_process_steps (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  step_number integer not null check (step_number > 0),
  stage_key text not null,
  title text not null,
  description text,
  status text not null default 'Not Started'
    check (status in ('Not Started', 'In Progress', 'Blocked', 'Complete', 'Not Applicable')),
  owner_name text,
  due_date date,
  estimated_cost numeric(14,2) check (estimated_cost is null or estimated_cost >= 0),
  actual_cost numeric(14,2) check (actual_cost is null or actual_cost >= 0),
  currency text not null default 'USD',
  evidence text,
  notes text,
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, step_number)
);

create index if not exists order_process_steps_order_idx
  on public.order_process_steps(order_id, step_number);

alter table public.order_process_steps enable row level security;

drop policy if exists "authenticated manage order process steps" on public.order_process_steps;
create policy "authenticated manage order process steps"
on public.order_process_steps for all to authenticated
using (true) with check (true);

create or replace function public.seed_order_process_steps(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null and current_user not in ('postgres', 'service_role') then
    raise exception 'Authentication required';
  end if;

  insert into public.order_process_steps(order_id, step_number, stage_key, title, description)
  values
    (p_order_id, 1, 'order_terms', 'Order & commercial terms', 'Confirm buyer, product specification, quantity, packing, destination, Incoterm, payment terms and target shipment date.'),
    (p_order_id, 2, 'costing', 'Costing & price approval', 'Complete the cost sheet, choose ready rice or in-house milling, add logistics/finance costs and approve the selling price.'),
    (p_order_id, 3, 'supply_plan', 'Supply & production plan', 'Reserve ready-rice stock or plan paddy procurement, milling, recovery and production capacity.'),
    (p_order_id, 4, 'procurement', 'Procurement', 'Purchase rice/paddy, bags, labels, liners, thread, desiccant and other required materials.'),
    (p_order_id, 5, 'production', 'Milling & production', 'Track lot input, finished rice, broken rice, by-products, wastage, recovery and production progress.'),
    (p_order_id, 6, 'quality_packing', 'Quality control & packing', 'Verify specification, moisture, cleanliness, weights, bag artwork/marks and final packing count.'),
    (p_order_id, 7, 'logistics_booking', 'Container & logistics booking', 'Book container, trucking, clearing agent, vessel/freight and record cut-off dates.'),
    (p_order_id, 8, 'stuffing_treatment', 'Stuffing, fumigation & seal', 'Inspect and load the container, fumigate, add moisture protection, seal it and record evidence.'),
    (p_order_id, 9, 'customs_port', 'Customs clearance & port handover', 'Move the container to port, complete declaration/terminal formalities and obtain customs release.'),
    (p_order_id, 10, 'shipping', 'Shipment & bill of lading', 'Confirm departure and verify the draft/final bill of lading against the order.'),
    (p_order_id, 11, 'documents', 'Export document set', 'Complete invoice, packing list, B/L, phytosanitary, origin, fumigation and buyer/LC documents.'),
    (p_order_id, 12, 'bank_payment', 'Bank presentation & payment', 'Submit compliant documents, resolve discrepancies and reconcile foreign remittance.'),
    (p_order_id, 13, 'delivery', 'Transit & buyer delivery', 'Track vessel milestones, arrival, buyer receipt, acceptance and any claim.'),
    (p_order_id, 14, 'closure', 'Cost, inventory & profit closure', 'Reconcile all costs, stock movements, by-product sales, finance, incentive/drawback and final margin.')
  on conflict (order_id, step_number) do nothing;
end;
$$;

revoke all on function public.seed_order_process_steps(text) from public, anon;
grant execute on function public.seed_order_process_steps(text) to authenticated;

create or replace function public.seed_new_order_process_steps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_order_process_steps(new.id);
  return new;
end;
$$;

drop trigger if exists seed_order_process_steps_after_insert on public.orders;
create trigger seed_order_process_steps_after_insert
after insert on public.orders
for each row execute function public.seed_new_order_process_steps();

create or replace function public.audit_order_process_step()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status = 'Complete' and old.status is distinct from 'Complete' then
    new.completed_at := now();
  elsif new.status <> 'Complete' then
    new.completed_at := null;
  end if;

  if old.status is distinct from new.status then
    insert into public.order_activity(order_id, event_type, from_value, to_value, metadata)
    values (
      new.order_id,
      'process_step_changed',
      old.status,
      new.status,
      jsonb_build_object('step_number', new.step_number, 'title', new.title)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_order_process_step_update on public.order_process_steps;
create trigger audit_order_process_step_update
before update on public.order_process_steps
for each row execute function public.audit_order_process_step();

do $$
declare
  order_row record;
begin
  for order_row in select id from public.orders loop
    perform public.seed_order_process_steps(order_row.id);
  end loop;
end;
$$;
