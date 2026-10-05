import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { daysSince, daysUntil, localDateString } from '../lib/dates';
import { getStageIndex } from '../lib/orderWorkflow';

// An order with no stage change or check-in for this long needs an update.
export const STALE_ORDER_DAYS = 7;
// A buyer with an open inquiry and no contact for this long needs a follow-up.
export const FOLLOW_UP_AFTER_DAYS = 7;
// Shipments shown when due within this many days (or overdue).
export const SHIPMENT_WINDOW_DAYS = 14;

const CLOSED_INQUIRY = ['Accepted', 'Lost', 'Rejected', 'Closed', 'Cancelled', 'Converted'];
const CLIENT_FIELDS = 'id, company, country, contact, email, phone, whatsapp_number, last_contacted_at, next_followup_at';
const SHIPPED_INDEX = getStageIndex('Shipped');

const CHANNEL_LABELS = { website: 'Website form', email: 'Email', whatsapp: 'WhatsApp', manual: 'Added by staff' };

// Buyers who need a reply or a follow-up, one card per buyer, most urgent first:
//   * an open automatic task (they emailed / messaged us)
//   * their follow-up date has arrived
//   * an open inquiry with no contact for FOLLOW_UP_AFTER_DAYS
function buildFollowUps(autoTasks, dueClients, openInquiries, newInquiryClientIds) {
  const byClient = new Map();

  for (const task of autoTasks) {
    const client = task.clients;
    if (!client || byClient.has(client.id) || newInquiryClientIds.has(client.id)) continue;
    const dueIn = task.due_at ? (new Date(task.due_at) - Date.now()) / 3600000 : null;
    byClient.set(client.id, {
      client,
      reason: task.title,
      dueAt: task.due_at,
      urgency: dueIn === null ? 0 : 1000 - dueIn,
    });
  }

  for (const client of dueClients) {
    if (byClient.has(client.id)) continue;
    byClient.set(client.id, {
      client,
      reason: 'Follow-up date reached',
      urgency: Math.max(0, -daysUntil(client.next_followup_at)),
    });
  }

  for (const inquiry of openInquiries) {
    const client = inquiry.clients;
    if (!client || byClient.has(client.id)) continue;
    const quiet = daysSince(client.last_contacted_at || inquiry.created_at);
    if (quiet === null || quiet < FOLLOW_UP_AFTER_DAYS) continue;
    const products = (inquiry.inquiry_items || []).map((item) => item.product_name).filter(Boolean).join(', ')
      || inquiry.product_interest;
    byClient.set(client.id, {
      client,
      reason: `Inquiry ${String(inquiry.status || 'open').toLowerCase()}${products ? ` (${products})` : ''}, no contact for ${quiet} days`,
      urgency: quiet - FOLLOW_UP_AFTER_DAYS,
    });
  }

  return [...byClient.values()].sort((a, b) => b.urgency - a.urgency);
}

function buildShipments(orders) {
  const items = [];
  for (const order of orders) {
    const beforeShipping = getStageIndex(order.status) < SHIPPED_INDEX;
    if (beforeShipping && order.shipment_deadline) {
      items.push({ order, label: 'Shipment deadline', date: order.shipment_deadline });
    }
    for (const shipment of order.shipments || []) {
      if (beforeShipping && shipment.etd) items.push({ order, label: 'Vessel departs', date: shipment.etd });
      if (!beforeShipping && shipment.eta) items.push({ order, label: 'Arrives at port', date: shipment.eta });
    }
  }
  return items
    .map((item) => ({ ...item, days: daysUntil(item.date) }))
    .filter((item) => item.days !== null && item.days <= SHIPMENT_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);
}

export function useToday() {
  const [data, setData] = useState({
    newInquiries: [],
    messages: [],
    followUps: [],
    staleOrders: [],
    otherOrders: [],
    shipments: [],
    dueTasks: [],
    lowStock: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const today = localDateString();

    const results = await Promise.all([
      supabase
        .from('public_inquiry_submissions')
        .select('*')
        .in('status', ['New', 'Needs Review'])
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('inquiries')
        .select(`id, status, created_at, notes, source_channel, product_interest, quantity_estimate, reply_due_at,
          clients(${CLIENT_FIELDS}), inquiry_items(product_name, quantity_mt)`)
        .eq('status', 'New')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('inquiries')
        .select(`id, status, created_at, product_interest, clients(${CLIENT_FIELDS}), inquiry_items(product_name)`)
        .not('status', 'in', `(${['New', ...CLOSED_INQUIRY].map((s) => `"${s}"`).join(',')})`)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('clients')
        .select(CLIENT_FIELDS)
        .lte('next_followup_at', today)
        .order('next_followup_at', { ascending: true })
        .limit(50),
      supabase
        .from('orders')
        .select(`id, status, production_progress, shipment_deadline, total_value, pod_port, created_at,
          clients(${CLIENT_FIELDS}), order_items(product_name, quantity_mt), shipments(etd, eta, status)`)
        .neq('status', 'Delivered & Closed')
        .order('created_at', { ascending: false }),
      supabase
        .from('tasks')
        .select(`id, title, priority, category, status, due_date, due_at, source, client_id, inquiry_id, clients(${CLIENT_FIELDS})`)
        .neq('status', 'Done')
        .or(`due_date.lte.${today},source.eq.auto`)
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(60),
      supabase
        .from('inbound_emails')
        .select('id, mailbox, from_email, from_name, subject, body_text, received_at, risk_flags, attachment_names')
        .eq('review_status', 'needs_review')
        .order('received_at', { ascending: false })
        .limit(15),
      supabase
        .from('product_stock')
        .select('product_id, name, available_mt, low_stock_mt, reserved_mt')
        .eq('active', true)
        .eq('is_low', true)
        .order('available_mt', { ascending: true }),
      supabase
        .from('inbound_whatsapp')
        .select('id, from_phone, from_name, message_type, body, received_at, risk_flags')
        .eq('review_status', 'needs_review')
        .order('received_at', { ascending: false })
        .limit(15),
    ]);

    const firstError = results.find((res) => res.error)?.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    const [submissionsRes, newInquiriesRes, openInquiriesRes, dueClientsRes, ordersRes, tasksRes, emailsRes, stockRes, waRes] = results;

    const orders = ordersRes.data || [];
    const lastActivity = new Map();
    if (orders.length) {
      const { data: activity, error: activityError } = await supabase
        .from('order_activity')
        .select('order_id, created_at')
        .in('order_id', orders.map((order) => order.id))
        .order('created_at', { ascending: false });
      if (activityError) {
        setError(activityError.message);
        setLoading(false);
        return;
      }
      for (const row of activity || []) {
        if (!lastActivity.has(row.order_id)) lastActivity.set(row.order_id, row.created_at);
      }
    }

    const withAge = orders.map((order) => {
      const lastUpdate = lastActivity.get(order.id) || order.created_at;
      return { ...order, lastUpdate, daysSinceUpdate: daysSince(lastUpdate) };
    });

    const inquiryRows = newInquiriesRes.data || [];
    const newInquiryClientIds = new Set(inquiryRows.map((row) => row.clients?.id).filter(Boolean));

    const newInquiries = [
      ...(submissionsRes.data || []).map((row) => ({
        key: `web-${row.id}`,
        source: row.status === 'Needs Review' ? 'Website form · needs checking' : 'Website form',
        name: row.company_name || row.full_name || 'Website visitor',
        person: row.company_name ? row.full_name : null,
        country: row.country,
        products: row.product_interest,
        quantity: row.quantity_estimate,
        message: row.message,
        email: row.email,
        phone: row.phone,
        receivedAt: row.submitted_at || row.created_at,
        link: '/inquiries',
        client: null,
      })),
      ...inquiryRows.map((row) => ({
        key: `inq-${row.id}`,
        source: CHANNEL_LABELS[row.source_channel] || 'Inquiry',
        name: row.clients?.company || row.id,
        person: row.clients?.contact,
        country: row.clients?.country,
        products: (row.inquiry_items || []).map((item) => item.product_name).filter(Boolean).join(', ') || row.product_interest,
        quantity: (row.inquiry_items || []).reduce((sum, item) => sum + Number(item.quantity_mt || 0), 0) || row.quantity_estimate,
        message: row.notes,
        email: row.clients?.email,
        phone: row.clients?.whatsapp_number || row.clients?.phone,
        receivedAt: row.created_at,
        replyDueAt: row.reply_due_at,
        link: row.clients?.id ? `/clients/${row.clients.id}` : '/inquiries',
        client: row.clients,
      })),
    ].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

    const tasks = tasksRes.data || [];
    const autoTasks = tasks.filter((task) => task.source === 'auto' && task.client_id);
    // Manual tasks due today or earlier; automatic ones appear as buyer cards instead.
    const dueTasks = tasks.filter((task) => task.source !== 'auto' && task.due_date && task.due_date <= today);

    const messages = [
      ...(emailsRes.data || []).map((row) => ({
        key: `email-${row.id}`,
        source: 'email',
        id: row.id,
        from: row.from_name ? `${row.from_name} <${row.from_email}>` : row.from_email,
        fromName: row.from_name,
        to: row.mailbox,
        title: row.subject || '(no subject)',
        body: row.body_text,
        attachments: row.attachment_names || [],
        flags: row.risk_flags || [],
        receivedAt: row.received_at,
      })),
      ...(waRes.data || []).map((row) => ({
        key: `wa-${row.id}`,
        source: 'whatsapp',
        id: row.id,
        from: row.from_name ? `${row.from_name} (${row.from_phone})` : row.from_phone,
        fromName: row.from_name,
        to: 'WhatsApp',
        title: null,
        body: row.body,
        attachments: [],
        flags: row.risk_flags || [],
        receivedAt: row.received_at,
      })),
    ].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

    setData({
      newInquiries,
      messages,
      followUps: buildFollowUps(autoTasks, dueClientsRes.data || [], openInquiriesRes.data || [], newInquiryClientIds),
      staleOrders: withAge
        .filter((order) => order.daysSinceUpdate >= STALE_ORDER_DAYS)
        .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate),
      otherOrders: withAge.filter((order) => order.daysSinceUpdate < STALE_ORDER_DAYS),
      shipments: buildShipments(orders),
      dueTasks,
      lowStock: stockRes.data || [],
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...data, loading, error, refresh: load };
}
