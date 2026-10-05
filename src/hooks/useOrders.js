import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// ---------- List of orders ----------
export function useOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('orders')
      .select('*, clients(company, country), order_items(*), shipments(*)')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setOrders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const convertInquiryToOrder = useCallback(async (inquiry) => {
    const { data: order, error: orderError } = await supabase.rpc('convert_inquiry_to_order', {
      p_inquiry_id: inquiry.id,
    });
    if (orderError) return { error: orderError.message };
    await fetchOrders();
    return { data: order };
  }, [fetchOrders]);

  // Goes through set_order_status so every change is validated and logged.
  const updateOrderStatus = useCallback(async (id, status, note = null) => {
    const { error } = await supabase.rpc('set_order_status', { p_order_id: id, p_status: status, p_note: note });
    if (error) return { error: error.message };
    await fetchOrders();
    return { success: true };
  }, [fetchOrders]);

  const updateOrderProgress = useCallback(async (id, production_progress) => {
    const { error } = await supabase.rpc('set_order_progress', { p_order_id: id, p_progress: Number(production_progress) });
    if (error) return { error: error.message };
    await fetchOrders();
    return { success: true };
  }, [fetchOrders]);

  // ← NEW: update any order fields
  const updateOrder = useCallback(async (id, updates) => {
    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) return { error: error.message };
    await fetchOrders();
    return { data };
  }, [fetchOrders]);

  const deleteOrder = useCallback(async (id) => {
    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) return { error: error.message };
    setOrders((prev) => prev.filter((o) => o.id !== id));
    return { success: true };
  }, []);

  const createOrder = useCallback(async ({ client_id, status = 'Order Confirmed', incoterm = 'FOB', payment_method = 'LC' }) => {
    const { data, error } = await supabase.rpc('create_order', {
      p_client_id: client_id,
      p_status: status,
      p_incoterm: incoterm,
      p_payment_method: payment_method,
    });
    if (error) return { error: error.message };
    await fetchOrders();
    return { data };
  }, [fetchOrders]);

  return {
    orders,
    loading,
    error,
    refetch: fetchOrders,
    convertInquiryToOrder,
    createOrder,
    updateOrder,
    updateOrderStatus,
    updateOrderProgress,
    deleteOrder,
  };
}

// ---------- Single order with full detail ----------
export function useOrder(id) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('orders')
      .select('*, clients(*), order_items(*), shipments(*), order_documents(*)')
      .eq('id', id)
      .single();
    if (error) setError(error.message);
    else setOrder(data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  return { order, loading, error, refetch: fetchOrder };
}

// ---------- Shipment CRUD ----------
export function useShipmentActions() {
  const createShipment = useCallback(async (orderId, shipmentData) => {
    const { data, error } = await supabase
      .from('shipments')
      .insert([{ order_id: orderId, ...shipmentData }])
      .select()
      .single();
    return { data, error: error?.message };
  }, []);

  const updateShipment = useCallback(async (shipmentId, updates) => {
    const { data, error } = await supabase
      .from('shipments')
      .update(updates)
      .eq('id', shipmentId)
      .select()
      .single();
    return { data, error: error?.message };
  }, []);

  return { createShipment, updateShipment };
}

// ---------- Order item CRUD ----------
export function useOrderItemActions() {
  const syncOrderItems = useCallback(async (orderId, items) => {
    const { data: existing, error: fetchError } = await supabase
      .from('order_items')
      .select('id')
      .eq('order_id', orderId);
    if (fetchError) return { error: fetchError.message };

    const keptIds = new Set(items.filter((item) => item.id).map((item) => item.id));
    const removedIds = (existing || []).map((item) => item.id).filter((id) => !keptIds.has(id));
    if (removedIds.length) {
      const { error } = await supabase.from('order_items').delete().in('id', removedIds);
      if (error) return { error: error.message };
    }

    for (const item of items) {
      const quantity = Number(item.quantity_mt || 0);
      const unitPrice = Number(item.unit_price || 0);
      const payload = {
        order_id: orderId,
        product_id: item.product_id || null,
        product_name: item.product_name?.trim() || 'Product',
        quantity_mt: quantity,
        unit_price: unitPrice,
        line_total: quantity * unitPrice,
      };
      const query = item.id
        ? supabase.from('order_items').update(payload).eq('id', item.id)
        : supabase.from('order_items').insert([payload]);
      const { error } = await query;
      if (error) return { error: error.message };
    }
    return { success: true };
  }, []);

  return { syncOrderItems };
}

// ---------- Document checklist actions ----------
export function useDocumentActions() {
  const updateDocumentStatus = useCallback(async (docId, status) => {
    const { error } = await supabase
      .from('order_documents')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', docId);
    return { error: error?.message };
  }, []);

  return { updateDocumentStatus };
}
