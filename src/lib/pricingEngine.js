// ===== KTC Pricing Engine =====
// Calculates export price per MT from cost components + margin,
// matching the PRD's pricing engine spec (Phase 3.3.4).

export function calculateLineItem({
  baseCost = 0,
  packagingCost = 0,
  millingCost = 0,
  exportDuties = 0,
  freightCost = 0,
  inspectionCost = 0,
  marginPercent = 10,
  quantityMt = 0,
}) {
  const costSubtotal =
    Number(baseCost) +
    Number(packagingCost) +
    Number(millingCost) +
    Number(exportDuties) +
    Number(freightCost) +
    Number(inspectionCost);

  const unitPrice = costSubtotal * (1 + Number(marginPercent) / 100);
  const lineTotal = unitPrice * Number(quantityMt);

  return {
    costSubtotal: round2(costSubtotal),
    unitPrice: round2(unitPrice),
    lineTotal: round2(lineTotal),
  };
}

export function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100;
}

export function calculateInquiryTotal(items) {
  return round2(items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0));
}

// Generates the next INQ-YYYY-#### id based on existing rows
export function generateNextInquiryId(existing) {
  const year = new Date().getFullYear();
  const nums = existing
    .map((i) => i.id?.match(/^INQ-(\d{4})-(\d+)$/))
    .filter(Boolean)
    .map((m) => parseInt(m[2], 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `INQ-${year}-${String(next).padStart(4, '0')}`;
}

export const INCOTERMS = ['FOB', 'CIF', 'CFR', 'EXW'];
export const PAYMENT_TERMS = ['LC at Sight', '30% TT Advance + 70% LC', 'CAD', 'Open Account', 'TT Advance'];
export const CERTIFICATIONS = ['Halal', 'ISO 22000', 'HACCP', 'Phytosanitary', 'SGS Inspection'];
export const INQUIRY_STATUSES = ['Pending Response', 'Quote Sent', 'In Negotiation', 'Accepted', 'Rejected', 'Expired'];
export const ORDER_STATUSES = ['Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Delivered', 'Invoiced', 'Paid', 'Closed'];
