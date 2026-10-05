import { statusBadgeClass } from '../data/mockData';

export default function Badge({ status, children }) {
  return (
    <span className={'badge ' + statusBadgeClass(status)}>
      <span className="badge-dot" />
      {children || status}
    </span>
  );
}
