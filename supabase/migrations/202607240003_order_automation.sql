begin;

alter table public.clients
  add column if not exists whatsapp_number text;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  channel text not null check (channel in ('whatsapp')),
  event_type text not null,
  recipient text,
  template_name text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  last_error text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, channel, event_type, scheduled_for)
);

create index if not exists notification_outbox_dispatch_idx
  on public.notification_outbox(status, scheduled_for);

create table if not exists public.order_sla (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  milestone text not null,
  due_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'completed', 'overdue', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, milestone)
);

create index if not exists order_sla_due_idx on public.order_sla(status, due_at);

create table if not exists public.repeat_order_reminders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  client_id text not null references public.clients(id) on delete cascade,
  remind_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'queued', 'sent', 'cancelled')),
  notification_id uuid references public.notification_outbox(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (order_id)
);

alter table public.notification_outbox enable row level security;
alter table public.order_sla enable row level security;
alter table public.repeat_order_reminders enable row level security;

drop policy if exists "authenticated read notification outbox" on public.notification_outbox;
create policy "authenticated read notification outbox" on public.notification_outbox
  for select to authenticated using (true);
drop policy if exists "authenticated manage order sla" on public.order_sla;
create policy "authenticated manage order sla" on public.order_sla
  for all to authenticated using (true) with check (true);
drop policy if exists "authenticated read repeat reminders" on public.repeat_order_reminders;
create policy "authenticated read repeat reminders" on public.repeat_order_reminders
  for select to authenticated using (true);

create or replace function public.queue_order_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  buyer_phone text;
begin
  if old.status is not distinct from new.status then return new; end if;
  select nullif(btrim(c.whatsapp_number), '') into buyer_phone
  from public.clients c where c.id = new.client_id;

  if buyer_phone is not null then
    insert into public.notification_outbox(
      order_id, channel, event_type, recipient, template_name, payload
    ) values (
      new.id, 'whatsapp', 'order_status_changed', buyer_phone, 'order_status_update',
      jsonb_build_object('order_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists orders_queue_status_notification on public.orders;
create trigger orders_queue_status_notification
after update of status on public.orders
for each row execute function public.queue_order_status_notification();

create or replace function public.sync_order_automation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shipment_deadline is not null and new.status <> 'Delivered & Closed' then
    insert into public.order_sla(order_id, milestone, due_at)
    values (new.id, 'shipment_deadline', new.shipment_deadline::timestamptz)
    on conflict (order_id, milestone) do update
      set due_at = excluded.due_at, status = 'open', updated_at = now();
  end if;

  if new.status = 'Delivered & Closed' and old.status is distinct from new.status then
    update public.order_sla set status = 'completed', completed_at = now(), updated_at = now()
      where order_id = new.id and status in ('open', 'overdue');
    insert into public.repeat_order_reminders(order_id, client_id, remind_at)
    values (new.id, new.client_id, now() + interval '30 days')
    on conflict (order_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_sync_automation on public.orders;
create trigger orders_sync_automation
after insert or update of shipment_deadline, status on public.orders
for each row execute function public.sync_order_automation();

create or replace function public.process_order_automation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  overdue_count integer;
  reminder_count integer;
begin
  update public.order_sla
    set status = 'overdue', updated_at = now()
    where status = 'open' and due_at < now();
  get diagnostics overdue_count = row_count;

  with due as (
    select r.id, r.order_id, nullif(btrim(c.whatsapp_number), '') recipient
    from public.repeat_order_reminders r
    join public.clients c on c.id = r.client_id
    where r.status = 'scheduled' and r.remind_at <= now()
      and nullif(btrim(c.whatsapp_number), '') is not null
    for update of r skip locked
  ), queued as (
    insert into public.notification_outbox(
      order_id, channel, event_type, recipient, template_name, payload
    )
    select order_id, 'whatsapp', 'repeat_order_reminder', recipient,
      'repeat_order_reminder', jsonb_build_object('order_id', order_id)
    from due
    returning id, order_id
  )
  update public.repeat_order_reminders r
    set status = 'queued', notification_id = q.id
    from queued q where q.order_id = r.order_id;
  get diagnostics reminder_count = row_count;

  return jsonb_build_object('overdue_slas', overdue_count, 'queued_reminders', reminder_count);
end;
$$;

revoke all on function public.process_order_automation() from public, anon, authenticated;
grant execute on function public.process_order_automation() to service_role;

insert into public.order_sla(order_id, milestone, due_at)
select id, 'shipment_deadline', shipment_deadline::timestamptz
from public.orders
where shipment_deadline is not null and status <> 'Delivered & Closed'
on conflict (order_id, milestone) do nothing;

commit;
