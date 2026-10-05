-- Send the one-to-one follow-up sequences from the company's own mailbox
-- (exports@ on the cPanel mail server) instead of Brevo, so Gmail files them in
-- Primary and follow-ups thread under the first email. The monthly broadcast
-- stays on Brevo. Needs the Edge Function secrets SMTP_HOST, SMTP_USER and
-- SMTP_PASSWORD (see supabase/EMAIL_AUTOMATION_SETUP.md). Safe to re-run.

alter table public.email_sequences
  add column if not exists send_via text not null default 'brevo';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_sequences_send_via_check'
  ) then
    alter table public.email_sequences
      add constraint email_sequences_send_via_check check (send_via in ('brevo', 'smtp'));
  end if;
end $$;

update public.email_sequences
set send_via = 'smtp'
where name in ('New Lead Follow-Up', 'Website Inquiry Auto-Reply')
  and sender_email = 'exports@example.com';

-- Gmail only threads messages whose subjects match, so every follow-up
-- replies to the first email's subject.
update public.email_sequence_steps st
set subject = 'Re: Rice supply for {{company}}'
from public.email_sequences s
where st.sequence_id = s.id
  and s.name = 'New Lead Follow-Up'
  and st.step_number > 1;

select name, send_via, sender_email, active from public.email_sequences order by name;
