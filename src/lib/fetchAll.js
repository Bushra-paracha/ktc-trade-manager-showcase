// Supabase returns at most 1000 rows per request. fetchAll pages through a query
// until every row is loaded. Pass a function that builds a fresh query with a
// stable order (e.g. created_at + id) so pages don't overlap.
const PAGE_SIZE = 1000;

export async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
