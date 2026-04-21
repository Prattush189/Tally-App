import { Lightbulb, DollarSign, Target, TrendingUp } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt } from '../../utils/format';

const typeColors = { Geographic: '#3b82f6', Category: '#8b5cf6', Product: '#22c55e', Seasonal: '#f59e0b', Retention: '#ef4444', Digital: '#06b6d4' };
const impactBadge = (impact) => {
  const c = impact === 'High' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : impact === 'Medium' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${c}`}>{impact} Impact</span>;
};

export default function RevenueSuggestions() {
  const { data, loading } = useExtended('revenue-suggestions');
  if (loading || !data) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <SectionHeader icon={Lightbulb} title="Revenue Growth Suggestions" subtitle="AI-driven strategies on how and where to target for revenue growth" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard icon={DollarSign} label="Total Potential" value={fmt(data.totalPotential)} sub="From all strategies" color="emerald" />
        <MetricCard icon={Target} label="High Impact" value={data.strategies.filter(s => s.impact === 'High').length} sub="Strategies available" color="indigo" />
        <MetricCard icon={TrendingUp} label="Quick Wins" value={data.strategies.filter(s => s.effort === 'Low').length} sub="Low effort, high/medium impact" color="blue" />
      </div>

      <div className="space-y-4">
        {data.strategies.map((s, i) => (
          <div key={s.id} className="glass-card-hover p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0 bg-indigo-500/15 text-indigo-400">
                  {i + 1}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-lg font-semibold text-white">{s.title}</h4>
                    <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: typeColors[s.type] + '20', color: typeColors[s.type] }}>{s.type}</span>
                    {impactBadge(s.impact)}
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${s.effort === 'Low' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : s.effort === 'Medium' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{s.effort} Effort</span>
                  </div>
                  <p className="text-sm text-gray-400 mt-2 leading-relaxed max-w-2xl">{s.description}</p>
                  <div className="flex gap-4 mt-3">
                    {Object.entries(s.metrics).map(([key, val]) => (
                      <div key={key} className="bg-gray-900/50 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                        <p className="text-sm font-semibold text-white">{typeof val === 'number' && val > 1000 ? fmt(val) : String(val)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <p className="text-xs text-gray-500">Est. Monthly Revenue</p>
                <p className="text-xl font-bold text-emerald-400">{fmt(s.estimatedRevenue)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
