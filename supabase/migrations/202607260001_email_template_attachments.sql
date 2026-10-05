-- Allow reusable email templates and sent-message records to carry one PDF.
alter table public.email_templates
  add column if not exists attachment_path text,
  add column if not exists attachment_name text;

alter table public.email_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists delivery_provider text,
  add column if not exists provider_message_id text;

drop policy if exists "Authenticated users can delete email templates" on public.email_templates;
create policy "Authenticated users can delete email templates"
on public.email_templates for delete to authenticated
using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-attachments', 'email-attachments', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can read email attachments" on storage.objects;
create policy "Authenticated users can read email attachments"
on storage.objects for select to authenticated
using (bucket_id = 'email-attachments');

drop policy if exists "Authenticated users can upload email attachments" on storage.objects;
create policy "Authenticated users can upload email attachments"
on storage.objects for insert to authenticated
with check (bucket_id = 'email-attachments');

drop policy if exists "Authenticated users can delete email attachments" on storage.objects;
create policy "Authenticated users can delete email attachments"
on storage.objects for delete to authenticated
using (bucket_id = 'email-attachments');
