-- WhatsApp enquiries without the Meta Cloud API (decided 2026-10-05).
--
-- The WhatsApp Business number stays on the WhatsApp Business app. Its built-in greeting message
-- links new contacts to the quote form with ?via=whatsapp; the enquiry waits in Approvals as before,
-- and staff send the approval hand-off themselves from the app (Approvals shows the message with an
-- "Open in WhatsApp" button). Switching enquiry_settings.whatsapp_mode to 'api' turns automatic
-- sending back on once a number is connected to the Cloud API.

alter table public.enquiry_settings
  add column if not exists whatsapp_mode text not null default 'manual'
  check (whatsapp_mode in ('manual', 'api'));

-- Where a quote form submission came from: the website, or the WhatsApp greeting link.
alter table public.public_inquiry_submissions
  add column if not exists via text check (via in ('website', 'whatsapp'));

-- In manual mode nothing is queued, so nothing goes out late if the API is connected later.
create or replace function public.queue_whatsapp(
  p_to text, p_kind text, p_body text,
  p_template text default null, p_params jsonb default '[]'::jsonb, p_enquiry uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce((select whatsapp_mode from public.enquiry_settings where id = 1), 'manual') <> 'api' then
    return null;
  end if;
  if nullif(regexp_replace(coalesce(p_to, ''), '\D', '', 'g'), '') is null or nullif(btrim(p_body), '') is null then
    return null;
  end if;
  insert into public.whatsapp_outbox (to_phone, kind, body, template_name, template_params, enquiry_id)
  values (p_to, p_kind, left(p_body, 4000), p_template, coalesce(p_params, '[]'::jsonb), p_enquiry)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.queue_whatsapp(text, text, text, text, jsonb, uuid) from public, anon, authenticated;

-- Same as 202610020001, plus the channel from the form's ?via= link.
create or replace function public.capture_website_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.enquiry_reviews;
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
    insert into public.enquiry_reviews
      (ref, channel, status, whatsapp_number, contact_name, company, country, email, product, quantity, message,
       form_token, form_submitted_at, source_table, source_id)
    values
      (public.next_enquiry_ref(), coalesce(new.via, 'website'), 'pending', public.normalize_phone(new.phone, new.country),
       nullif(btrim(new.full_name), ''), nullif(btrim(new.company_name), ''), nullif(btrim(new.country), ''),
       public.normalize_email(new.email), nullif(btrim(new.product_interest), ''), nullif(btrim(new.quantity_estimate), ''),
       left(nullif(btrim(new.message), ''), 5000), replace(gen_random_uuid()::text, '-', ''), now(),
       'public_inquiry_submissions', new.id::text)
    returning * into v_review;
    update public.public_inquiry_submissions set status = 'Awaiting Review' where id = new.id;
    perform public.alert_enquiry(v_review);
  exception when others then
    update public.public_inquiry_submissions set status = 'Needs Review' where id = new.id;
    raise warning 'capture_website_submission % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
