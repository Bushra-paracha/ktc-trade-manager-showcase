import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Reads submissions from the public "Request a Quote" form (/quote page),
// which insert into public_inquiry_submissions. This is a separate table
// from `inquiries` (which powers internal PI/quote records tied to a client).
export function usePublicInquiries() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('public_inquiry_submissions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setSubmissions(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Best-effort status update. The public_inquiry_submissions table may not
  // have a `status` column yet (it isn't written by the public form). If the
  // update fails because the column doesn't exist, surface a clear message
  // instead of crashing the page.
  const updateStatus = useCallback(async (id, status) => {
    const { error } = await supabase
      .from('public_inquiry_submissions')
      .update({ status })
      .eq('id', id);
    if (error) return { error: error.message };
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    return { success: true };
  }, []);

  const deleteSubmission = useCallback(async (id) => {
    const { error } = await supabase.from('public_inquiry_submissions').delete().eq('id', id);
    if (error) return { error: error.message };
    setSubmissions((prev) => prev.filter((s) => s.id !== id));
    return { success: true };
  }, []);

  // Converts a raw submission into a full client/buyer record.
  const convertToClient = useCallback(async (submission) => {
    const year = new Date().getFullYear();
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(200);

    const nums = (existing || [])
      .map((c) => c.id?.match(/^LEAD-(\d{4})-(\d+)$/))
      .filter(Boolean)
      .map((m) => parseInt(m[2], 10));
    const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
    const id = `LEAD-${year}-${String(nextNum).padStart(4, '0')}`;

    const payload = {
      id,
      company: submission.company_name || submission.full_name || 'Unnamed buyer',
      contact: submission.full_name || null,
      country: submission.country || null,
      email: submission.email || null,
      phone: submission.phone || null,
      source: 'Inbound Inquiry',
      products_interest: submission.product_interest ? [submission.product_interest] : [],
      est_volume: submission.quantity_estimate || null,
      // 'Engaged', not 'New': status 'New' enrolls the buyer in the cold "New Lead
      // Follow-Up" email sequence, which is wrong for someone who asked us.
      status: 'Engaged',
      score: 70,
      notes: submission.message || null,
    };

    const { data, error } = await supabase.from('clients').insert([payload]).select();
    if (error) return { error: error.message };

    // Best-effort: mark the submission as converted so it's easy to spot later.
    await supabase
      .from('public_inquiry_submissions')
      .update({ status: 'Converted' })
      .eq('id', submission.id);
    setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, status: 'Converted' } : s)));

    return { data: data[0] };
  }, []);

  return {
    submissions,
    loading,
    error,
    refetch: fetchSubmissions,
    updateStatus,
    deleteSubmission,
    convertToClient,
  };
}
