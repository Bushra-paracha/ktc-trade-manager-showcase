export function getLeadTier(score = 0) {
  const n = Number(score || 0);
  if (n >= 80) return { label: 'Hot', className: 'lead-score hot', emoji: '🔥' };
  if (n >= 60) return { label: 'Warm', className: 'lead-score warm', emoji: '🌤' };
  if (n >= 40) return { label: 'Nurture', className: 'lead-score nurture', emoji: '🌱' };
  return { label: 'Cold', className: 'lead-score cold', emoji: '❄️' };
}

export default function LeadScoreBadge({ score }) {
  const tier = getLeadTier(score);
  return (
    <span className={tier.className} title={`Lead score: ${score || 0}/100`}>
      <span>{tier.emoji}</span>
      {tier.label}
      <strong>{score || 0}</strong>
    </span>
  );
}
