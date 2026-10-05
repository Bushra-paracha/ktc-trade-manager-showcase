-- Make sequence emails read like one-to-one business emails so Gmail places
-- them in Primary rather than Promotions: plain paragraphs (no bullet lists or
-- bold), a personal sender name, and no marketing-style formatting.
-- Broadcasts (the monthly offer) are unchanged: they are genuine marketing mail.

update public.email_sequences
set sender_name = 'Sultan Ali Paracha'
where name in ('New Lead Follow-Up', 'Website Inquiry Auto-Reply');

update public.email_sequence_steps st
set subject = v.subject, body_html = v.body_html
from public.email_sequences s,
(values
  ('New Lead Follow-Up', 1, 'Rice supply for {{company}}',
   $html$<p>Dear {{contact}},</p>
<p>I am Sultan Ali Paracha, director of Kassam Trading Company in Karachi. We have milled and exported Pakistani rice since 1999 from our own mills at Port Qasim, and ship regularly to buyers in the Gulf, Africa and Asia.</p>
<p>We supply Basmati (1121, Super Kernel, PK-385), non-Basmati (IRRI-6, IRRI-9, PK-386, C-9 and 1121 Sella) and 100% broken rice, in 5 to 50 kg bags or under your own brand.</p>
<p>Is {{company}} buying rice at the moment? If you tell me the variety, quantity and destination port, I will send you current prices.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company, Karachi<br>WhatsApp +92 300 820 1074</p>$html$),
  ('New Lead Follow-Up', 2, 'Re: Rice supply for {{company}}',
   $html$<p>Dear {{contact}},</p>
<p>Following up on my note last week. Buyers usually ask us three things first, so briefly: every lot is Sortexed and fumigated, and can be inspected by SGS or an agency of your choice before loading. We are ISO 9001 and ISO 22000 certified. We ship FOB Port Qasim or CFR/CIF to your port in 20ft or 40ft containers.</p>
<p>If useful, I can send a sample or a specification sheet for the variety you use.</p>
<p>Best regards,<br>Sultan</p>$html$),
  ('New Lead Follow-Up', 3, 'Quick question',
   $html$<p>Dear {{contact}},</p>
<p>One quick question: which rice does {{company}} buy most often, and roughly how many containers a month?</p>
<p>With that I can prepare a CFR price to your port, which is usually more useful than a general price list.</p>
<p>Best regards,<br>Sultan</p>$html$),
  ('New Lead Follow-Up', 4, 'Closing the loop',
   $html$<p>Dear {{contact}},</p>
<p>I have not heard back, so I will assume the timing is not right for {{company}} and will not follow up again.</p>
<p>If a requirement comes up later, for rice, pink salt or sesame, just reply to this email and I will send prices the same day.</p>
<p>Best regards,<br>Sultan</p>$html$),
  ('Website Inquiry Auto-Reply', 1, 'Re: your inquiry about {{product}}',
   $html$<p>Dear {{contact}},</p>
<p>Thank you for your inquiry about {{product}}. I have received it and will reply with prices and availability within one working day.</p>
<p>To quote accurately, it helps to know the variety and broken percentage, the quantity per shipment, the packing you prefer (bag size, plain or private label), and your destination port with FOB, CFR or CIF terms. Please reply with whatever you have not already shared.</p>
<p>For anything urgent, you can reach me on WhatsApp at +92 300 820 1074.</p>
<p>Best regards,<br>Sultan Ali Paracha<br>Kassam Trading Company, Karachi</p>$html$),
  ('Website Inquiry Auto-Reply', 2, 'Re: your inquiry about {{product}}',
   $html$<p>Dear {{contact}},</p>
<p>Following up on your recent inquiry to make sure our quotation reached you and answered your questions.</p>
<p>If you would like a revised price for a different quantity, packing or port, or a sample before ordering, just let me know.</p>
<p>Best regards,<br>Sultan</p>$html$)
) as v(sequence_name, step_number, subject, body_html)
where s.name = v.sequence_name
  and st.sequence_id = s.id
  and st.step_number = v.step_number;

select name, sender_name, (select count(*) from public.email_sequence_steps x where x.sequence_id = s.id) as steps
from public.email_sequences s;
