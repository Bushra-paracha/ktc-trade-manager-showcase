// Date-only columns (shipment_deadline, etd, eta, due_date, payment_date) come
// back as 'YYYY-MM-DD'. new Date('2026-09-30') is midnight UTC, which shows as
// 29 Sep anywhere west of UTC (e.g. Canada). Parse them as local calendar dates.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const match = DATE_ONLY.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, options, fallback = '—') {
  const date = parseDate(value);
  return date ? date.toLocaleDateString(undefined, options) : fallback;
}

// Whole calendar days from today to the given date (negative = past).
export function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfDate - startOfToday) / 86400000);
}

// Today's date on this device as 'YYYY-MM-DD' (for comparing with date-only columns).
export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Whole days since a timestamp or date (0 = today).
export function daysSince(value) {
  const days = daysUntil(value);
  return days === null ? null : -days;
}

export function timeAgo(value) {
  const days = daysSince(value);
  if (days === null) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}
