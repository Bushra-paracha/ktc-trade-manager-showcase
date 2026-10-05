-- Put the email automation tables (202609270001_email_automation.sql) behind the
-- same staff check as the rest of the CRM (202609270010_phase1_security_hardening.sql).
-- They were created with "using (true)", which let any login, including new
-- 'Pending' accounts, read and edit sequences, broadcasts and suppressions.
-- Edge functions and cron use the service role and are unaffected. Safe to re-run.

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'email_suppressions', 'email_sequences', 'email_sequence_steps',
    'email_sequence_enrollments', 'email_broadcasts', 'email_automation_queue'
  ] loop
    execute format('drop policy if exists "Staff manage %1$s" on public.%1$I', t);
    execute format('drop policy if exists "staff full access" on public.%I', t);
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated
         using ((select public.is_staff())) with check ((select public.is_staff()))', t);
  end loop;
end;
$$;

-- Trigger functions are never called directly.
revoke execute on function
  public.enroll_new_client_in_sequences(),
  public.enroll_inquiry_in_sequences()
from public, anon, authenticated;

commit;
