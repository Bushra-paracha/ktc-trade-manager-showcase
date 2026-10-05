import { Link } from 'react-router-dom';

const stageLabels = ['Lead', 'Quote', 'Negotiation', 'Order', 'Shipment'];

export default function PipelineOverview({ pipelineByStage }) {
  const max = Math.max(1, ...pipelineByStage.map((item) => item.count));
  const normalized = stageLabels.map((stage) => {
    const match = pipelineByStage.find((item) => String(item.stage || '').toLowerCase().includes(stage.toLowerCase()));
    return { stage, count: match?.count || 0 };
  });

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Export sales pipeline</h3>
          <div className="card-header-sub">Buyer movement from lead to shipment</div>
        </div>
        <Link to="/pipeline" className="btn btn-ghost btn-sm">Open pipeline</Link>
      </div>
      <div className="pipeline-overview">
        {normalized.map((item) => (
          <div className="pipeline-row" key={item.stage}>
            <div className="pipeline-label">
              <strong>{item.stage}</strong>
              <span>{item.count}</span>
            </div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
