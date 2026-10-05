import { CalendarDays, MapPin, Ship } from 'lucide-react';
import Badge from '../Badge';
import { formatDate } from '../../lib/dates';

export default function ShipmentSummaryCard({ shipment, onAddShipment, onStatusChange, statusOptions = [] }) {
  if (!shipment) {
    return (
      <div className="card shipment-summary-card empty-shipment-card">
        <Ship size={24} />
        <h3>No shipment booked</h3>
        <p>Add vessel, container, BL and ETA details once cargo is ready.</p>
        <button className="btn btn-primary" onClick={onAddShipment}><Ship size={16} /> Add Shipment</button>
      </div>
    );
  }

  return (
    <div className="card shipment-summary-card">
      <div className="card-header">
        <div>
          <h3>Shipment</h3>
          <p>{shipment.shipping_line || 'Shipping line pending'}</p>
        </div>
        <Badge status={shipment.status} />
      </div>
      <div className="shipment-route">
        <div>
          <span>POL</span>
          <strong>{shipment.pol || 'Port Qasim'}</strong>
        </div>
        <div className="route-line"><Ship size={16} /></div>
        <div>
          <span>POD</span>
          <strong>{shipment.pod || '—'}</strong>
        </div>
      </div>
      <div className="shipment-facts">
        <div><MapPin size={15} /><span>Container</span><strong>{shipment.container_number || '—'}</strong></div>
        <div><MapPin size={15} /><span>Seal</span><strong>{shipment.seal_number || '—'}</strong></div>
        <div><CalendarDays size={15} /><span>ETD</span><strong>{formatDate(shipment.etd)}</strong></div>
        <div><CalendarDays size={15} /><span>ETA</span><strong>{formatDate(shipment.eta)}</strong></div>
      </div>
      <select className="select-input" value={shipment.status || 'Booked'} onChange={(e) => onStatusChange?.(e.target.value)}>
        {statusOptions.map((status) => <option key={status}>{status}</option>)}
      </select>
    </div>
  );
}
