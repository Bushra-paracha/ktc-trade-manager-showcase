import { ArrowDownLeft, ArrowUpRight, FileText, Globe, Mail, MessageCircle, PackageCheck, Phone, Sparkles, StickyNote, Users } from 'lucide-react';
import { formatDate } from '../../lib/dates';

const CHANNEL_ICONS = {
  email: Mail,
  whatsapp: MessageCircle,
  website: Globe,
  call: Phone,
  meeting: Users,
  note: StickyNote,
  system: PackageCheck,
};

function when(value) {
  if (!value) return '';
  const date = new Date(value);
  return `${formatDate(value, { day: 'numeric', month: 'short', year: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// Everything logged in client_interactions (emails in/out, WhatsApp, website,
// follow-ups, order changes), newest first. Older records without a log fall
// back to inquiries, orders and outreach emails.
export default function BuyerProfileTimeline({ client, inquiries = [], orders = [], emails = [], interactions = [] }) {
  const logged = interactions.map((item) => ({
    icon: CHANNEL_ICONS[item.channel] || FileText,
    direction: item.direction,
    title: item.summary,
    note: item.detail ? item.detail.slice(0, 240) + (item.detail.length > 240 ? '…' : '') : null,
    time: when(item.occurred_at),
  }));

  const fallback = logged.length ? [] : [
    ...inquiries.slice(0, 3).map((inq) => ({
      icon: FileText,
      title: `Inquiry ${inq.id || ''}`,
      note: (inq.inquiry_items || []).map((item) => item.product_name).filter(Boolean).join(', ') || 'Product inquiry',
      time: inq.status || 'Open',
    })),
    ...orders.slice(0, 3).map((order) => ({
      icon: PackageCheck,
      title: `Order ${order.id}`,
      note: (order.order_items || []).map((item) => item.product_name).filter(Boolean).join(', ') || 'Order created',
      time: order.status || 'Order',
    })),
    ...emails.slice(0, 3).map((email) => ({
      icon: MessageCircle,
      title: email.subject || 'Email',
      note: email.replied_at ? 'Buyer replied' : email.status || 'Sent',
      time: formatDate(email.sent_at || email.created_at),
    })),
  ];

  const items = [
    ...logged,
    ...fallback,
    client?.created_at && {
      icon: Sparkles,
      title: 'Buyer added to CRM',
      note: client.source ? `Source: ${client.source}` : 'Imported into buyer database',
      time: formatDate(client.created_at),
    },
  ].filter(Boolean);

  return (
    <div className="buyer-profile-timeline">
      {items.length === 0 ? (
        <div className="empty-state"><h4>No timeline yet</h4><p>Activity will appear as the buyer moves through the pipeline.</p></div>
      ) : items.map((item, index) => {
        const Icon = item.icon;
        const Direction = item.direction === 'in' ? ArrowDownLeft : item.direction === 'out' ? ArrowUpRight : null;
        return (
          <div className="buyer-timeline-item" key={`${item.title}-${index}`}>
            <div className="buyer-timeline-icon"><Icon size={15} /></div>
            <div>
              <strong>
                {Direction && <Direction size={13} aria-label={item.direction === 'in' ? 'Received' : 'Sent'} style={{ marginRight: 4, verticalAlign: -1 }} />}
                {item.title}
              </strong>
              {item.note && <p>{item.note}</p>}
            </div>
            <span>{item.time}</span>
          </div>
        );
      })}
    </div>
  );
}
