-- Outreach: track bounced emails and find alternatives (2026-10-01)
--
--   * bounced_buyers(): every buyer whose current email has bounced (or is flagged
--     bounced / complained / unsubscribed), with the latest reason classified as
--     permanent, blocked or temporary, plus any alternatives found so far.
--   * email_alternatives: candidate addresses found by the find-alternative-emails
--     Edge Function (the buyer's own website, or their saved extra contacts).
--   * replace_client_email(): switch a buyer to a new address (a found alternative
--     or one typed in). The bounced address is kept as a contact, stays on the
--     do-not-email list, and the change goes on the buyer timeline.
--
-- Apply with the SQL editor or `supabase db query --linked -f <this file>`. Safe to re-run.

begin;

create table if not exists public.email_alternatives (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  bounced_email text,
  candidate_email text not null,
  source text not null check (source in ('website', 'contact')),
  source_url text,
  mx_ok boolean not null default false,
  status text not null default 'suggested' check (status in ('suggested', 'applied', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (client_id, candidate_email)
);
create index if not exists email_alternatives_client_idx on public.email_alternatives (client_id, status);

alter table public.email_alternatives enable row level security;
drop policy if exists "staff read" on public.email_alternatives;
create policy "staff read" on public.email_alternatives for select to authenticated using ((select public.is_staff()));

-- When the last search ran for a buyer (so the screen can say "nothing found").
alter table public.clients add column if not exists alternatives_checked_at timestamptz;

create or replace function public.bounce_kind(p_reason text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_reason, '') ~* '(insufficient credits|quota|mailbox full|out of storage|storage space|temporar|try again|greylist|4\.[0-9]\.[0-9])' then 'temporary'
    when coalesce(p_reason, '') ~* '(blacklist|blocked|spam|policy|access denied|rbl|5\.7\.[0-9])' then 'blocked'
    else 'permanent'
  end
$$;

create or replace function public.bounced_buyers()
returns table (
  client_id text, company text, country text, contact text, email text, email_status text,
  reason text, kind text, bounced_at timestamptz, website text, checked_at timestamptz,
  alternatives jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with current_email as (
    select c.*, public.primary_email(c.email) as pe from public.clients c
  ),
  last_bounce as (
    select distinct on (lower(m.to_email)) lower(m.to_email) as to_email, m.bounce_reason, coalesce(m.bounced_at, m.created_at) as at
    from public.email_messages m
    where m.status = 'Bounced'
    order by lower(m.to_email), coalesce(m.bounced_at, m.created_at) desc
  )
  select c.id, c.company, c.country, c.contact, c.pe, c.email_status,
         coalesce(b.bounce_reason, 'Address marked ' || c.email_status),
         case when b.to_email is null then case c.email_status when 'bounced' then 'permanent' else 'blocked' end
              else public.bounce_kind(b.bounce_reason) end,
         b.at,
         substring(coalesce(c.notes, '') from '(?i)website:\s*(\S+)'),
         c.alternatives_checked_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', a.id, 'email', a.candidate_email, 'source', a.source, 'source_url', a.source_url, 'mx_ok', a.mx_ok)
                   order by a.mx_ok desc, a.created_at)
                   from public.email_alternatives a where a.client_id = c.id and a.status = 'suggested'), '[]'::jsonb)
  from current_email c
  left join last_bounce b on b.to_email = c.pe
  where public.is_staff()
    and c.pe is not null
    and (b.to_email is not null or c.email_status <> 'ok')
  order by b.at desc nulls last, c.company
$$;

create or replace function public.replace_client_email(
  p_client_id text,
  p_new_email text,
  p_alternative_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.clients;
  v_new text := public.normalize_email(p_new_email);
  v_old text;
begin
  if not public.can_edit() then raise exception 'Not authorised'; end if;
  if v_new is null or v_new !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' then raise exception 'Enter a valid email address'; end if;
  if exists (select 1 from public.email_suppressions where email = v_new) then
    raise exception '% is on the do-not-email list (it bounced or unsubscribed before)', v_new;
  end if;
  select * into c from public.clients where id = p_client_id for update;
  if not found then raise exception 'Buyer not found'; end if;
  v_old := public.primary_email(c.email);
  if v_old = v_new then raise exception 'That is already the buyer''s email'; end if;

  if v_old is not null and not exists (select 1 from public.client_contacts where client_id = c.id and email = v_old) then
    insert into public.client_contacts (client_id, name, email, notes)
    values (c.id, coalesce(nullif(c.contact, ''), 'Previous address'), v_old, 'Bounced; replaced ' || to_char(now() at time zone 'Asia/Karachi', 'DD Mon YYYY'));
  end if;

  update public.clients set email = v_new, email_status = 'ok' where id = c.id;

  update public.email_alternatives set status = 'applied'
    where client_id = c.id and (id = p_alternative_id or candidate_email = v_new);

  perform public.log_interaction(c.id, null, 'system', 'internal',
    format('Email changed from %s (bounced) to %s', coalesce(v_old, 'none'), v_new), null);

  return jsonb_build_object('client_id', c.id, 'old_email', v_old, 'new_email', v_new);
end;
$$;

create or replace function public.dismiss_email_alternative(p_alternative_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_edit() then raise exception 'Not authorised'; end if;
  update public.email_alternatives set status = 'dismissed' where id = p_alternative_id;
  if not found then raise exception 'Suggestion not found'; end if;
end;
$$;

revoke execute on function public.bounced_buyers(), public.replace_client_email(text, text, uuid),
  public.dismiss_email_alternative(uuid), public.bounce_kind(text) from public, anon;
grant execute on function public.bounced_buyers(), public.replace_client_email(text, text, uuid),
  public.dismiss_email_alternative(uuid), public.bounce_kind(text) to authenticated;

commit;
