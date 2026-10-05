-- WhatsApp inquiries go straight into the CRM (2026-09-27)
--
-- A first message from a number that isn't in the CRM now creates, without
-- waiting for review:
--   * the buyer, named "WhatsApp +<number> (<profile name>)" until the company is
--     known (rename it on the buyer page), status 'Hot', country from the dialling code
--   * a New inquiry with the message, a 4-hour reply task and a staff alert
-- Later messages from the same number are linked to that buyer automatically.
--
-- Still held under Today → Messages to check: messages with links or
-- bank / payment / login wording, and numbers shared by several buyers. Held
-- messages don't ping anyone; they appear on Today and in the morning summary.
-- A known buyer's message alerts staff only when it opens a new reply task, so a
-- buyer sending several messages in a row produces one alert.
--
-- Apply with the SQL editor or `supabase db query --linked -f <this file>`. Safe to re-run.

begin;

-- Country from an international number (same markets as normalize_phone).
create or replace function public.country_from_phone(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when d like '880%' then 'Bangladesh'           when d like '966%' then 'Saudi Arabia'
    when d like '971%' then 'United Arab Emirates' when d like '965%' then 'Kuwait'
    when d like '974%' then 'Qatar'                when d like '973%' then 'Bahrain'
    when d like '968%' then 'Oman'                 when d like '964%' then 'Iraq'
    when d like '962%' then 'Jordan'               when d like '852%' then 'Hong Kong'
    when d like '251%' then 'Ethiopia'             when d like '233%' then 'Ghana'
    when d like '254%' then 'Kenya'                when d like '234%' then 'Nigeria'
    when d like '255%' then 'Tanzania'             when d like '258%' then 'Mozambique'
    when d like '221%' then 'Senegal'
    when d like '92%' then 'Pakistan'      when d like '63%' then 'Philippines'
    when d like '98%' then 'Iran'          when d like '20%' then 'Egypt'
    when d like '60%' then 'Malaysia'      when d like '62%' then 'Indonesia'
    when d like '65%' then 'Singapore'     when d like '84%' then 'Vietnam'
    when d like '66%' then 'Thailand'      when d like '86%' then 'China'
    when d like '94%' then 'Sri Lanka'     when d like '91%' then 'India'
    when d like '93%' then 'Afghanistan'   when d like '27%' then 'South Africa'
    when d like '44%' then 'United Kingdom' when d like '61%' then 'Australia'
    when d like '49%' then 'Germany'       when d like '31%' then 'Netherlands'
    when d like '33%' then 'France'        when d like '39%' then 'Italy'
    when d like '34%' then 'Spain'         when d like '32%' then 'Belgium'
    when d like '90%' then 'Turkey'
    else null end  -- +1 (US / Canada) is left blank on purpose
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x
$$;

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
  v_result jsonb;
  v_fresh boolean := coalesce(new.received_at, now()) > now() - interval '1 day';
  v_new_task boolean := false;
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

  -- New number, nothing suspicious: straight into the CRM as an inquiry.
  if v_client_id is null and not (v_flags && array['payment_or_link', 'shared_number']) then
    begin
      v_result := public.capture_inquiry(
        'whatsapp',
        format('WhatsApp %s%s', v_phone, case when nullif(btrim(new.from_name), '') is not null then ' (' || btrim(new.from_name) || ')' else '' end),
        new.from_name, null, v_phone, public.country_from_phone(v_phone), null, null,
        coalesce(new.body, '[' || coalesce(new.message_type, 'message') || ']'),
        'inbound_whatsapp', new.id::text);
      update public.inbound_whatsapp
        set review_status = 'captured', risk_flags = v_flags,
            client_id = v_result->>'client_id', inquiry_id = v_result->>'inquiry_id'
        where id = new.id;
      return new;
    exception when others then
      raise warning 'WhatsApp auto-capture for % failed, holding for review: %', v_phone, sqlerrm;
    end;
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
      'WhatsApp: ' || left(coalesce(new.body, '[' || coalesce(new.message_type, 'message') || ']'), 200),
      new.body, 'inbound_whatsapp', new.id::text, new.received_at);

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
      concat_ws(E'\n', format('From: %s (%s)%s', coalesce(new.from_name, 'unknown'), v_phone,
                              ' — ' || v_company),
                '', left(coalesce(new.body, '[' || coalesce(new.message_type, 'message') || ']'), 1500),
                case when cardinality(v_flags) > 0 then E'\nNote: ' || array_to_string(v_flags, ', ') || '. Check before opening anything.' end),
      jsonb_build_array(v_company, 'WhatsApp',
                        left(regexp_replace(coalesce(new.body, '[' || coalesce(new.message_type, 'message') || ']'), '\s+', ' ', 'g'), 150)));
  end if;

  return new;
end;
$$;

revoke execute on function public.process_inbound_whatsapp() from public, anon, authenticated;
revoke execute on function public.country_from_phone(text) from public, anon;
grant execute on function public.country_from_phone(text) to authenticated;

commit;
