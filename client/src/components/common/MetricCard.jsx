import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

const colorMap = {
  indigo: { bg: 'bg-indigo-500/15', text: 'text-indigo-400' },
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  red: { bg: 'bg-red-500/15', text: 'text-red-400' },
  amber: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  violet: { bg: 'bg-violet-500/15', text: 'text-violet-400' },
  blue: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  orange: { bg: 'bg-orange-500/15', text: 'text-orange-400' },
  cyan: { bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
};

export default function MetricCard({ icon: Icon, label, value, sub, trend, color = 'indigo' }) {
  const c = colorMap[color] || colorMap.indigo;
  return (
    <div className="glass-card-hover p-5">
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-xl ${c.bg}`}><Icon size={20} className={c.text} /></div>
        {trend !== undefined && (
          <span className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white mt-3">{value}</p>
      <p className="text-sm text-gray-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}
