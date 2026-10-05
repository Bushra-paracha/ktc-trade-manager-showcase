create table if not exists public.public_inquiry_submissions (
  id uuid primary key default gen_random_uuid()
);

alter table public.public_inquiry_submissions add column if not exists full_name text;
alter table public.public_inquiry_submissions add column if not exists company_name text;
alter table public.public_inquiry_submissions add column if not exists email text;
alter table public.public_inquiry_submissions add column if not exists phone text;
alter table public.public_inquiry_submissions add column if not exists country text;
alter table public.public_inquiry_submissions add column if not exists product_interest text;
alter table public.public_inquiry_submissions add column if not exists quantity_estimate text;
alter table public.public_inquiry_submissions add column if not exists message text;
alter table public.public_inquiry_submissions add column if not exists status text default 'New';
alter table public.public_inquiry_submissions add column if not exists created_at timestamptz default now();

alter table public.public_inquiry_submissions enable row level security;

drop policy if exists "Public can submit inquiries" on public.public_inquiry_submissions;
create policy "Public can submit inquiries"
  on public.public_inquiry_submissions
  for insert
  to anon
  with check (true);

drop policy if exists "Staff can view inquiries" on public.public_inquiry_submissions;
create policy "Staff can view inquiries"
  on public.public_inquiry_submissions
  for select
  to authenticated
  using (true);

drop policy if exists "Staff can update inquiries" on public.public_inquiry_submissions;
create policy "Staff can update inquiries"
  on public.public_inquiry_submissions
  for update
  to authenticated
  using (true);

drop policy if exists "Staff can delete inquiries" on public.public_inquiry_submissions;
create policy "Staff can delete inquiries"
  on public.public_inquiry_submissions
  for delete
  to authenticated
  using (true);
