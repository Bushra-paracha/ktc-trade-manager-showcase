import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckSquare,
  ClipboardList,
  FileText,
  Mail,
  Package,
  Search,
  Ship,
  ShoppingCart,
  Sparkles,
  Users,
  Target,
  X,
} from 'lucide-react';
import { useClients } from '../hooks/useClients';
import { useOrders } from '../hooks/useOrders';
import { useProducts } from '../hooks/useProducts';
import { supabase } from '../lib/supabaseClient';

const QUICK_ACTIONS = [
  { label: 'Add buyer', description: 'Create or import a new international buyer', to: '/clients', icon: Users },
  { label: 'Create quote / PI', description: 'Generate export quotation and WhatsApp text', to: '/quotes', icon: FileText },
  { label: 'Create order', description: 'Start an export order workflow', to: '/orders', icon: ClipboardList },
  { label: 'Lead scoring', description: 'Prioritize hot buyers by market and intent', to: '/lead-scoring', icon: Target },
  { label: 'Follow-up tasks', description: 'Open today’s buyer action queue', to: '/tasks', icon: CheckSquare },
  { label: 'Amazon salt setup', description: 'Launch 1 lb, 2 lb and 5 lb retail packs', to: '/amazon-setup', icon: ShoppingCart },
];

function normalize(value) {
  if (Array.isArray(value)) return value.join(' ');
  return String(value || '');
}

function containsQuery(item, query) {
  if (!query) return true;
  return item.searchText.includes(query.toLowerCase());
}

function ResultIcon({ type }) {
  const icons = {
    buyer: Users,
    order: ClipboardList,
    product: Package,
    task: CheckSquare,
    shipment: Ship,
    document: FileText,
  };
  const Icon = icons[type] || Search;
  return <Icon size={17} />;
}

function ResultRow({ item, onClose }) {
  return (
    <Link to={item.to} className="global-search-result" onClick={onClose}>
      <div className={`global-search-result-icon ${item.type}`}>
        <ResultIcon type={item.type} />
      </div>
      <div className="global-search-result-body">
        <div className="global-search-result-title-row">
          <strong>{item.title}</strong>
          <span>{item.typeLabel}</span>
        </div>
        <p>{item.description}</p>
      </div>
      <ArrowRight size={16} className="global-search-result-arrow" />
    </Link>
  );
}

export default function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const { clients } = useClients();
  const { orders } = useOrders();
  const { products } = useProducts();

  useEffect(() => {
    if (!open) return;

    let active = true;

    async function loadSecondaryResults() {
      const [taskResult, shipmentResult, documentResult] = await Promise.all([
        supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('order_documents').select('*').order('created_at', { ascending: false }).limit(20),
      ]);

      if (!active) return;
      if (!taskResult.error) setTasks(taskResult.data || []);
      if (!shipmentResult.error) setShipments(shipmentResult.data || []);
      if (!documentResult.error) setDocuments(documentResult.data || []);
    }

    loadSecondaryResults();
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const results = useMemo(() => {
    const buyerResults = clients.map((client) => ({
      type: 'buyer',
      typeLabel: 'Buyer',
      title: client.company || client.contact || client.id,
      description: [client.country, client.status, normalize(client.products_interest)].filter(Boolean).join(' • ') || 'Buyer profile',
      to: `/clients/${client.id}`,
      searchText: [client.id, client.company, client.contact, client.country, client.email, client.status, normalize(client.products_interest)].join(' ').toLowerCase(),
      score: Number(client.score || 0),
    }));

    const orderResults = orders.map((order) => ({
      type: 'order',
      typeLabel: 'Order',
      title: order.id,
      description: [order.clients?.company, order.status, order.pod_port, order.total_value ? `$${Number(order.total_value).toLocaleString()}` : ''].filter(Boolean).join(' • ') || 'Export order',
      to: `/orders/${order.id}`,
      searchText: [order.id, order.status, order.pod_port, order.clients?.company, order.clients?.country, order.incoterm, order.payment_method].join(' ').toLowerCase(),
      score: Number(order.total_value || 0),
    }));

    const productResults = products.map((product) => ({
      type: 'product',
      typeLabel: 'Product',
      title: product.name || product.id,
      description: [product.category, product.grade, product.fob_price ? `$${product.fob_price}/MT FOB` : '', product.status].filter(Boolean).join(' • ') || 'Product catalog item',
      to: '/products',
      searchText: [product.id, product.name, product.category, product.grade, product.description, product.status].join(' ').toLowerCase(),
      score: Number(product.fob_price || 0),
    }));

    const taskResults = tasks.map((task) => ({
      type: 'task',
      typeLabel: 'Task',
      title: task.title || 'Untitled task',
      description: [task.priority, task.status, task.category, task.due_date].filter(Boolean).join(' • ') || 'Follow-up task',
      to: '/tasks',
      searchText: [task.title, task.description, task.priority, task.status, task.category, task.due_date].join(' ').toLowerCase(),
      score: task.priority === 'High' ? 100 : task.priority === 'Medium' ? 50 : 10,
    }));

    const shipmentResults = shipments.map((shipment) => ({
      type: 'shipment',
      typeLabel: 'Shipment',
      title: shipment.booking_no || shipment.container_no || shipment.order_id || 'Shipment',
      description: [shipment.status, shipment.vessel_name, shipment.eta, shipment.destination_port].filter(Boolean).join(' • ') || 'Shipment tracking',
      to: shipment.order_id ? `/orders/${shipment.order_id}` : '/shipments',
      searchText: [shipment.id, shipment.order_id, shipment.booking_no, shipment.container_no, shipment.status, shipment.vessel_name, shipment.destination_port].join(' ').toLowerCase(),
      score: 30,
    }));

    const documentResults = documents.map((doc) => ({
      type: 'document',
      typeLabel: 'Document',
      title: doc.document_type || 'Export document',
      description: [doc.status, doc.responsible_party, doc.order_id].filter(Boolean).join(' • ') || 'Order document',
      to: doc.order_id ? `/orders/${doc.order_id}` : '/documents',
      searchText: [doc.document_type, doc.status, doc.responsible_party, doc.order_id, doc.notes].join(' ').toLowerCase(),
      score: doc.status === 'Pending' ? 60 : 20,
    }));

    return [...buyerResults, ...orderResults, ...productResults, ...taskResults, ...shipmentResults, ...documentResults]
      .filter((item) => containsQuery(item, query.trim()))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [clients, orders, products, tasks, shipments, documents, query]);

  const grouped = useMemo(() => {
    return results.reduce((acc, item) => {
      acc[item.typeLabel] = acc[item.typeLabel] || [];
      acc[item.typeLabel].push(item);
      return acc;
    }, {});
  }, [results]);

  if (!open) return null;

  return (
    <div className="global-search-overlay" role="dialog" aria-modal="true" aria-label="Global search">
      <div className="global-search-backdrop" onClick={onClose} />
      <section className="global-search-panel">
        <div className="global-search-input-row">
          <Search size={20} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search buyers, orders, products, tasks, shipments…"
          />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>

        {!query.trim() && (
          <div className="global-search-quick-actions">
            <div className="global-search-section-title">
              <Sparkles size={16} />
              Quick actions
            </div>
            <div className="global-search-quick-grid">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Link key={action.label} to={action.to} className="global-search-quick-card" onClick={onClose}>
                    <Icon size={18} />
                    <div>
                      <strong>{action.label}</strong>
                      <span>{action.description}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className="global-search-results">
          {results.length === 0 ? (
            <div className="global-search-empty">
              <Mail size={24} />
              <strong>No results found</strong>
              <span>Try searching by buyer name, country, order ID, product, container, or task.</span>
            </div>
          ) : (
            Object.entries(grouped).map(([label, items]) => (
              <div key={label} className="global-search-group">
                <div className="global-search-section-title">{label}</div>
                {items.map((item) => (
                  <ResultRow key={`${item.type}-${item.title}-${item.to}`} item={item} onClose={onClose} />
                ))}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
