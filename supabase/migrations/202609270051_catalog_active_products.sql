-- The public quote form lists only active products (Inventory → Edit product → Active).
-- Safe to re-run.
create or replace function public.public_product_catalog()
returns table (id text, name text, category text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.category from public.products p where p.active order by p.category, p.name
$$;
grant execute on function public.public_product_catalog() to anon, authenticated;
