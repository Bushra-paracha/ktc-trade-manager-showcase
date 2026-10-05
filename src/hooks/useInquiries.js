import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { calculateInquiryTotal, generateNextInquiryId } from '../lib/pricingEngine';

// ---------- List of inquiries (with client info and items joined) ----------
export function useInquiries() {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchInquiries = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('inquiries')
      .select('*, clients(company, country, contact, email), inquiry_items(*)')
      .order('created_at', { ascending: false });

    if (error) setError(error.message);
    else setInquiries(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  // Creates an inquiry + its line items in one go
  const createInquiry = useCallback(async (inquiryData, items) => {
    const id = generateNextInquiryId(inquiries);
    const total_value = calculateInquiryTotal(items);

    const { data: inquiry, error: inquiryError } = await supabase
      .from('inquiries')
      .insert([{ id, ...inquiryData, total_value }])
      .select()
      .single();

    if (inquiryError) {
      return { error: inquiryError.message };
    }

    const itemsToInsert = items.map((item) => ({ ...item, inquiry_id: id }));
    const { error: itemsError } = await supabase.from('inquiry_items').insert(itemsToInsert);

    if (itemsError) {
      console.error('inquiry_items insert error:', itemsError, 'payload:', itemsToInsert);
      return { error: `Inquiry saved, but line items failed: ${itemsError.message}` };
    }

    await fetchInquiries();
    return { data: inquiry };
  }, [inquiries, fetchInquiries]);

  const updateInquiryStatus = useCallback(async (id, status) => {
    const { error } = await supabase.from('inquiries').update({ status }).eq('id', id);
    if (error) return { error: error.message };
    await fetchInquiries();
    return { success: true };
  }, [fetchInquiries]);

  // Updates inquiry header + replaces all line items
  const updateInquiry = useCallback(async (id, updates, items) => {
    // 1. Update inquiry header fields
    const total_value = items ? calculateInquiryTotal(items) : undefined;
    const { error } = await supabase
      .from('inquiries')
      .update({ ...updates, ...(total_value !== undefined && { total_value }) })
      .eq('id', id);
    if (error) return { error: error.message };

    // 2. If items provided, delete old items and re-insert updated ones
    if (items && items.length > 0) {
      const { error: deleteError } = await supabase
        .from('inquiry_items')
        .delete()
        .eq('inquiry_id', id);
      if (deleteError) return { error: deleteError.message };

      const itemsToInsert = items.map((item) => ({ ...item, inquiry_id: id }));
      const { error: insertError } = await supabase
        .from('inquiry_items')
        .insert(itemsToInsert);
      if (insertError) return { error: insertError.message };
    }

    await fetchInquiries();
    return { success: true };
  }, [fetchInquiries]);

  const deleteInquiry = useCallback(async (id) => {
    const { error } = await supabase.from('inquiries').delete().eq('id', id);
    if (error) return { error: error.message };
    setInquiries((prev) => prev.filter((i) => i.id !== id));
    return { success: true };
  }, []);

  return { inquiries, loading, error, refetch: fetchInquiries, createInquiry, updateInquiry, updateInquiryStatus, deleteInquiry };
}

// ---------- Single inquiry by id ----------
export function useInquiry(id) {
  const [inquiry, setInquiry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    supabase
      .from('inquiries')
      .select('*, clients(*), inquiry_items(*)')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setInquiry(data);
        setLoading(false);
      });

    return () => { active = false; };
  }, [id]);

  return { inquiry, loading, error };
}
