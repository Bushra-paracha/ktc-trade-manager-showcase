import { jsPDF } from 'jspdf';

const COLORS = {
  darkGreen: [26, 77, 46],
  gold: [196, 154, 43],
  gray: [85, 85, 85],
  lightGray: [240, 240, 240],
  black: [17, 17, 17],
};

function fmt(num) {
  return Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generates a Proforma Invoice PDF for an inquiry and triggers a download.
 *
 * @param {object} inquiry - inquiry row with joined clients and inquiry_items
 */
export function generateProformaInvoice(inquiry) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 0;

  // ===== Header band =====
  doc.setFillColor(...COLORS.darkGreen);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('KASSAM TRADING COMPANY', margin, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Rice Millers, Processors & Exporters — Karachi, Pakistan', margin, 18);
  doc.text('exports@example.com  |  kassamtradingcompany.com', margin, 23);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('PROFORMA INVOICE', pageWidth - margin, 16, { align: 'right' });

  y = 38;

  // ===== Invoice meta =====
  doc.setTextColor(...COLORS.black);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Invoice Ref:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inquiry.id, margin + 28, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Date:', pageWidth - margin - 50, y);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date(inquiry.created_at || Date.now()).toLocaleDateString('en-GB'), pageWidth - margin - 30, y);

  y += 6;
  const validityDate = new Date(inquiry.created_at || Date.now());
  validityDate.setDate(validityDate.getDate() + (inquiry.quote_validity_days || 7));

  doc.setFont('helvetica', 'bold');
  doc.text('Valid Until:', pageWidth - margin - 50, y);
  doc.setFont('helvetica', 'normal');
  doc.text(validityDate.toLocaleDateString('en-GB'), pageWidth - margin - 30, y);

  y += 12;

  // ===== Buyer details =====
  const client = inquiry.clients || {};
  doc.setFillColor(...COLORS.lightGray);
  doc.rect(margin, y, pageWidth - margin * 2, 26, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('BUYER / CONSIGNEE', margin + 3, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(client.company || '—', margin + 3, y + 12);
  doc.setFontSize(9);
  doc.text(`Attn: ${client.contact || '—'}`, margin + 3, y + 17);
  doc.text(`${client.email || ''}`, margin + 3, y + 22);

  // Shipping terms box on right
  doc.setFont('helvetica', 'bold');
  doc.text('SHIPPING TERMS', pageWidth / 2 + 10, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.text(`Incoterm: ${inquiry.incoterm || '—'}`, pageWidth / 2 + 10, y + 12);
  doc.text(`Port of Discharge: ${inquiry.destination_port || '—'}`, pageWidth / 2 + 10, y + 17);
  doc.text(`Payment Terms: ${inquiry.payment_terms || '—'}`, pageWidth / 2 + 10, y + 22);

  y += 34;

  // ===== Line items table =====
  const items = inquiry.inquiry_items || [];

  const colX = {
    no: margin,
    desc: margin + 9,
    qty: margin + 102,
    unit: margin + 122,
    price: margin + 138,
    total: pageWidth - margin,
  };

  doc.setFillColor(...COLORS.darkGreen);
  doc.rect(margin, y, pageWidth - margin * 2, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('#', colX.no + 2, y + 5.5);
  doc.text('Description of Goods', colX.desc, y + 5.5);
  doc.text('Qty (MT)', colX.qty, y + 5.5, { align: 'right' });
  doc.text('Unit', colX.unit, y + 5.5, { align: 'center' });
  doc.text('Price/MT', colX.price, y + 5.5, { align: 'right' });
  doc.text('Amount (USD)', colX.total, y + 5.5, { align: 'right' });

  y += 8;
  doc.setTextColor(...COLORS.black);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  items.forEach((item, idx) => {
    const rowHeight = 9;
    if (idx % 2 === 1) {
      doc.setFillColor(...COLORS.lightGray);
      doc.rect(margin, y, pageWidth - margin * 2, rowHeight, 'F');
    }
    doc.text(String(idx + 1), colX.no + 2, y + 6);
    doc.text(item.product_name || '—', colX.desc, y + 6, { maxWidth: 88 });
    doc.text(String(item.quantity_mt), colX.qty, y + 6, { align: 'right' });
    doc.text('MT', colX.unit, y + 6, { align: 'center' });
    doc.text(fmt(item.unit_price), colX.price, y + 6, { align: 'right' });
    doc.text(fmt(item.line_total), colX.total, y + 6, { align: 'right' });
    y += rowHeight;
  });

  // If no items, show a placeholder row
  if (items.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...COLORS.gray);
    doc.text('No line items', colX.desc, y + 6);
    doc.setTextColor(...COLORS.black);
    doc.setFont('helvetica', 'normal');
    y += 9;
  }

  // Total row
  doc.setDrawColor(...COLORS.darkGreen);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL VALUE (USD)', margin, y);
  doc.text(`$ ${fmt(inquiry.total_value)}`, colX.total, y, { align: 'right' });

  y += 14;

  // ===== Certifications =====
  if (inquiry.required_certifications && inquiry.required_certifications.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Required Certifications:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(inquiry.required_certifications.join(', '), margin + 48, y);
    y += 8;
  }

  // ===== Terms & Conditions =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Terms & Conditions', margin, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const terms = [
    `1. This Proforma Invoice is valid for ${inquiry.quote_validity_days || 7} days from the date of issue.`,
    `2. Payment terms: ${inquiry.payment_terms || 'As agreed'}.`,
    `3. Shipment terms: ${inquiry.incoterm || 'As agreed'}, Port of Loading: Karachi (KICT/QICT), Pakistan.`,
    `4. Prices are subject to change after the validity period without prior notice.`,
    `5. Goods will be shipped subject to availability of vessel space and export documentation.`,
  ];
  terms.forEach((line) => {
    doc.text(line, margin, y, { maxWidth: pageWidth - margin * 2 });
    y += 5;
  });

  y += 10;

  // ===== Bank details =====
  doc.setFillColor(...COLORS.lightGray);
  doc.rect(margin, y, pageWidth - margin * 2, 24, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Bank Details for Payment', margin + 3, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Bank Name: [To be confirmed]', margin + 3, y + 12);
  doc.text('Account Title: Kassam Trading Company', margin + 3, y + 17);
  doc.text('SWIFT / IBAN: [To be confirmed]', margin + 3, y + 22);

  y += 32;

  // ===== Signature =====
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('For Kassam Trading Company', margin, y);
  y += 16;
  doc.line(margin, y, margin + 60, y);
  y += 5;
  doc.setFontSize(8.5);
  doc.text('Authorized Signature', margin, y);

  // ===== Footer =====
  const footerY = doc.internal.pageSize.getHeight() - 10;
  doc.setTextColor(...COLORS.gray);
  doc.setFontSize(8);
  doc.text('Kassam Trading Company — kassamtradingcompany.com', pageWidth / 2, footerY, { align: 'center' });

  doc.save(`Proforma_Invoice_${inquiry.id}.pdf`);
}
