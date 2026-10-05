import { CheckCircle2 } from 'lucide-react';
import { ORDER_STAGES, getStageIndex } from '../../lib/orderWorkflow';

export default function StageTracker({ status, compact = false }) {
  const currentIndex = getStageIndex(status);

  return (
    <div className={compact ? 'stage-tracker stage-tracker-compact' : 'stage-tracker'}>
      {ORDER_STAGES.map((stage, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'upcoming';
        return (
          <div className={`stage-step ${state}`} key={stage.label} title={stage.helper}>
            <div className="stage-dot">
              {index < currentIndex ? <CheckCircle2 size={14} /> : index + 1}
            </div>
            {!compact && (
              <div>
                <strong>{stage.label}</strong>
                <span>{stage.helper}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
