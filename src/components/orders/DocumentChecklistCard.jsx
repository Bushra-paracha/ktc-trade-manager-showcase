import { Download, FileText, Upload, X } from 'lucide-react';
import Badge from '../Badge';

export default function DocumentChecklistCard({ docs = [], onStatusChange, onUpload, onView, onRemove, uploadingDocId }) {
  return (
    <div className="card document-control-card">
      <div className="card-header">
        <div>
          <h3>Export Document Checklist</h3>
          <p>Keep every required file in one place before shipment.</p>
        </div>
      </div>
      <div className="doc-checklist-list">
        {docs.length === 0 ? (
          <div className="empty-state compact-empty">
            <FileText />
            <h4>No document checklist yet</h4>
            <p>Create checklist templates in Supabase to auto-load required export documents.</p>
          </div>
        ) : docs.map((doc) => (
          <div className="doc-checklist-row" key={doc.id}>
            <div className="doc-icon"><FileText size={17} /></div>
            <div className="doc-main">
              <strong>{doc.document_type}</strong>
              <span>{doc.file_name || doc.responsible_party || 'Waiting for upload'}</span>
            </div>
            <select className="select-input doc-status-select" value={doc.status || 'Pending'} onChange={(e) => onStatusChange?.(doc.id, e.target.value)}>
              {['Pending', 'In Progress', 'Uploaded', 'Verified', 'Sent to Buyer'].map((status) => <option key={status}>{status}</option>)}
            </select>
            <Badge status={doc.status} />
            <div className="doc-actions">
              <button className="icon-btn" onClick={() => onUpload?.(doc.id)} disabled={uploadingDocId === doc.id} title="Upload file"><Upload size={15} /></button>
              {doc.file_path && <button className="icon-btn" onClick={() => onView?.(doc.file_path)} title="View file"><Download size={15} /></button>}
              {doc.file_path && <button className="icon-btn" onClick={() => onRemove?.(doc.id, doc.file_path)} title="Remove file"><X size={15} /></button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
