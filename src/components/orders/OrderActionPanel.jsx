import { ClipboardCheck, FileText, Mail, MessageCircle, Ship } from 'lucide-react';

export default function OrderActionPanel({ order, onGeneratePI, onDocuments, onShipment }) {
  const buyer = order?.clients?.company || 'buyer';
  const orderId = order?.id || 'this order';
  const value = order?.total_value ? `USD ${Number(order.total_value).toLocaleString()}` : 'the agreed value';
  const productLine = (order?.order_items || []).map((item) => `${item.product_name} (${item.quantity_mt} MT)`).join(', ') || 'your shipment';

  const message = `Dear ${buyer} Team,\n\nFollowing up on ${orderId}. We are preparing ${productLine} with ${order?.incoterm || 'FOB'} terms and ${order?.payment_method || 'LC'} payment. Please confirm if you need any updated documents from Kassam Trading Company.\n\nBest regards,\nKassam Trading Company`;

  async function copyMessage() {
    await navigator.clipboard?.writeText(message);
    alert('Follow-up message copied.');
  }

  const actions = [
    { icon: FileText, label: 'Generate PI', helper: 'Prepare buyer-facing invoice', onClick: onGeneratePI },
    { icon: ClipboardCheck, label: 'Check documents', helper: 'Review required export docs', onClick: onDocuments },
    { icon: Ship, label: 'Book shipment', helper: 'Add container and vessel details', onClick: onShipment },
    { icon: Mail, label: 'Email update', helper: `Confirm ${value}` },
    { icon: MessageCircle, label: 'Copy follow-up', helper: 'WhatsApp/email text', onClick: copyMessage },
  ];

  return (
    <div className="card action-center-card">
      <div className="card-header">
        <div>
          <h3>Order Action Center</h3>
          <p>Next steps for export operations</p>
        </div>
      </div>
      <div className="action-grid">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button type="button" className="action-tile" key={action.label} onClick={action.onClick}>
              <Icon size={18} />
              <span>{action.label}</span>
              <small>{action.helper}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
