import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

function generateNextProductId(existing) {
  const nums = existing
    .map((p) => p.id?.match(/^P-(\d+)$/))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `P-${String(next).padStart(3, '0')}`;
}

export function useProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name', { ascending: true });

    if (error) setError(error.message);
    else setProducts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const addProduct = useCallback(async (productData) => {
    const id = generateNextProductId(products);
    const { data, error } = await supabase
      .from('products')
      .insert([{ id, ...productData }])
      .select()
      .single();

    if (error) return { error: error.message };
    await fetchProducts();
    return { data };
  }, [products, fetchProducts]);

  const updateProduct = useCallback(async (id, updates) => {
    const { error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id);

    if (error) return { error: error.message };
    await fetchProducts();
    return { success: true };
  }, [fetchProducts]);

  const deleteProduct = useCallback(async (id) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) return { error: error.message };
    setProducts((prev) => prev.filter((p) => p.id !== id));
    return { success: true };
  }, []);

  return { products, loading, error, refetch: fetchProducts, addProduct, updateProduct, deleteProduct };
}
