export default function RiskBadge({ risk }) {
  const cls = risk === 'High'
    ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : risk === 'Medium'
    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>{risk}</span>;
}
