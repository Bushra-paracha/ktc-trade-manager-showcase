-- Seed the approved KTC/NBMT buyer outreach templates.
-- Idempotent by template name so re-running the migration does not create duplicates.

insert into public.email_templates (name, subject, body_html, category)
select template.name, template.subject, template.body_html, 'Buyer Outreach'
from (
  values
    (
      'Buyer Introduction - Combined Portfolio',
      'Agricultural commodity supply for {{company}}',
      $html$<p>Dear {{contact}},</p>
<p>I hope you are well. I am reaching out from Kassam Trading Company and our UAE sister company, NBMT Trading Co.</p>
<p>Together, we source, mill, grade and export agricultural commodities and packaged food products to buyers worldwide on FOB and CIF terms. Our portfolio includes basmati and non-basmati rice, salt, wheat, maize, sesame, pulses, sugar, edible oils, flour and selected grocery products.</p>
<p>We support flexible packing, private label, export documentation and third-party inspection where required. I have attached our 2026 product brochure for reference.</p>
<p>Please let me know which products, specifications, quantities and destination ports are currently relevant to {{company}}. We would be pleased to prepare a quotation.</p>
<p>Kind regards,<br>[SENDER NAME]<br>[KASSAM TRADING COMPANY / NBMT TRADING CO.]<br>[EMAIL] | [WHATSAPP] | [WEBSITE]</p>$html$
    ),
    (
      'Product-Specific Outreach',
      '[PRODUCT] supply for {{company}} - specifications and packing available',
      $html$<p>Dear {{contact}},</p>
<p>I am contacting you regarding your potential requirement for [PRODUCT].</p>
<p>We can offer [ORIGIN] supply with indicative specifications including [SPECIFICATION]. Packing options include [PACKING], with private label available where applicable. Shipment can be arranged on [FOB/CIF] terms to [DESTINATION PORT].</p>
<p>To prepare the correct quotation, could you please confirm:</p>
<ul><li>Required quantity</li><li>Preferred specification or grade</li><li>Packing and branding requirements</li><li>Destination port</li><li>Target shipment window</li></ul>
<p>Once confirmed, we will share availability, analysis details and commercial terms.</p>
<p>Kind regards,<br>[SENDER NAME]<br>[COMPANY]</p>$html$
    ),
    (
      'Quotation Follow-Up',
      'Follow-up: [PRODUCT] quotation for {{company}}',
      $html$<p>Dear {{contact}},</p>
<p>I am following up on our quotation for [PRODUCT], sent on [DATE].</p>
<p>Please let me know whether the specification, packing, origin and [FOB/CIF] terms match your requirement. If you would like us to revise the quantity, destination port, packing or shipment window, we can update the offer accordingly.</p>
<p>The current quotation is valid until [VALIDITY DATE], subject to final availability at confirmation.</p>
<p>I would appreciate your feedback and remain available for any questions.</p>
<p>Kind regards,<br>[SENDER NAME]<br>[COMPANY]</p>$html$
    ),
    (
      'Sample or Document Follow-Up',
      'Documents for [PRODUCT] - {{company}}',
      $html$<p>Dear {{contact}},</p>
<p>As discussed, please find the requested [SAMPLE / SPECIFICATION / ANALYSIS / CERTIFICATE / PACKING DETAILS] for [PRODUCT].</p>
<p>The information is provided for your review and remains subject to the final confirmed lot, contract terms and any agreed third-party inspection.</p>
<p>Please share your feedback and advise whether you would like us to proceed with a firm quotation or proforma invoice for [QUANTITY] to [DESTINATION PORT].</p>
<p>Kind regards,<br>[SENDER NAME]<br>[COMPANY]</p>$html$
    ),
    (
      'Order Confirmation and Next Steps',
      'Order confirmation - [PRODUCT] for {{company}}',
      $html$<p>Dear {{contact}},</p>
<p>Thank you for confirming your requirement. We have recorded the following:</p>
<p><strong>Product:</strong> [PRODUCT]<br>
<strong>Specification:</strong> [SPECIFICATION]<br>
<strong>Quantity:</strong> [QUANTITY]<br>
<strong>Packing:</strong> [PACKING]<br>
<strong>Incoterm:</strong> [FOB/CIF]<br>
<strong>Destination:</strong> [DESTINATION PORT]<br>
<strong>Target shipment:</strong> [SHIPMENT WINDOW]</p>
<p>Our team will now prepare the [PROFORMA INVOICE / SALES CONTRACT] and confirm the documentation and payment requirements. Please review the summary above and notify us immediately if any detail needs correction.</p>
<p>Kind regards,<br>[SENDER NAME]<br>[COMPANY]</p>$html$
    ),
    (
      'Dormant Lead Re-Engagement',
      'Checking current [PRODUCT] requirements at {{company}}',
      $html$<p>Dear {{contact}},</p>
<p>I hope you are well. I wanted to reconnect regarding {{company}}'s earlier interest in [PRODUCT].</p>
<p>Our group continues to supply agricultural commodities and packaged food products on FOB and CIF terms, with flexible packing, private label options and export documentation support. If you have a current or upcoming requirement, please share the product, specification, quantity and destination port.</p>
<p>If [PRODUCT] is no longer relevant, I would be glad to update our records and share information on another product category.</p>
<p>Kind regards,<br>[SENDER NAME]<br>[COMPANY]</p>$html$
    )
) as template(name, subject, body_html)
where not exists (
  select 1
  from public.email_templates existing
  where lower(existing.name) = lower(template.name)
);
