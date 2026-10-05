import { daysUntil } from './dates';

export const ORDER_STAGES = [
  { label: 'Order Confirmed', aliases: ['Order Confirmed', 'Confirmed'], buyerStatus: 'Confirmed', helper: 'Order accepted' },
  { label: 'Advance Payment Received', aliases: ['Advance Payment Received'], buyerStatus: 'Confirmed', helper: 'Advance payment recorded' },
  { label: 'In Production', aliases: ['In Production', 'Production'], buyerStatus: 'In Production', helper: 'Milling and packing' },
  { label: 'Ready to Ship', aliases: ['Ready to Ship', 'Ready'], buyerStatus: 'Ready to Ship', helper: 'Documents and cargo ready' },
  { label: 'Shipped', aliases: ['Shipped', 'Departed', 'In Transit'], buyerStatus: 'Shipped', helper: 'Cargo on the way' },
  { label: 'Balance Payment Received', aliases: ['Balance Payment Received'], buyerStatus: 'Shipped', helper: 'Final payment recorded' },
  { label: 'Delivered & Closed', aliases: ['Delivered & Closed', 'Delivered', 'Completed', 'Closed'], buyerStatus: 'Delivered', helper: 'Buyer received goods' },
];

export const ORDER_STATUS_OPTIONS = ORDER_STAGES.map((stage) => stage.label);

// The stage after the order's current one, or null when it's already closed.
export function getNextStage(status) {
  return ORDER_STAGES[getStageIndex(status) + 1] || null;
}

export function normalizeStatus(status = '') {
  const match = ORDER_STAGES.find((stage) =>
    stage.aliases.some((alias) => alias.toLowerCase() === String(status).toLowerCase())
  );
  return match?.label || status || 'Order Confirmed';
}

export function getStageIndex(status) {
  const normalized = normalizeStatus(status);
  const index = ORDER_STAGES.findIndex((stage) => stage.label === normalized);
  return index === -1 ? 0 : index;
}

export function getBuyerStatus(status) {
  const stage = ORDER_STAGES[getStageIndex(status)];
  return stage?.buyerStatus || 'Confirmed';
}

export function getStageProgress(status) {
  const index = getStageIndex(status);
  return Math.round(((index + 1) / ORDER_STAGES.length) * 100);
}

export function getOrderUrgency(order) {
  const diffDays = daysUntil(order?.shipment_deadline);
  if (diffDays === null) return { label: 'No deadline', tone: 'neutral' };
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, tone: 'danger' };
  if (diffDays <= 7) return { label: `${diffDays}d left`, tone: 'warning' };
  return { label: `${diffDays}d left`, tone: 'success' };
}

export function getDocsProgress(docs = []) {
  const total = docs.length;
  const complete = docs.filter((doc) => ['Verified', 'Sent to Buyer', 'Uploaded'].includes(doc.status)).length;
  return {
    total,
    complete,
    percent: total ? Math.round((complete / total) * 100) : 0,
  };
}

export function summarizeOrderValue(orders = []) {
  return orders.reduce((sum, order) => sum + Number(order.total_value || 0), 0);
}
