import { UserPlus, MapPin, Star, DollarSign } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import LoadingSpinner from '../common/LoadingSpinner';
import AIInsights from '../common/AIInsights';
import { useExtended } from '../../hooks/useExtended';
import { fmt } from '../../utils/format';

const priorityColors = { High: '#22c55e', Medium: '#f59e0b', Low: '#6b7280' };

export default function DealerSuggestions() {
  const { data, loading } = useExtended('dealer-suggestions');
  if (loading || !data) return <LoadingSpinner />;

  const isReactivation = data.kind === 'reactivation';
  const subtitle = isReactivation
    ? `Dormant dealers worth re-engaging — ${data.today.length} candidates as of ${data.date}`
    : `Daily outbound targets — ${data.date}`;

  return (
    <div className="space-y-6">
      <SectionHeader icon={UserPlus} title={isReactivation ? 'Reactivation Targets' : 'New Dealer Suggestions'} subtitle={subtitle} />

      <AIInsights task="dealer-suggestions" title="New-market prospects from AI" subtitle="Google-Search-grounded suggestions for genuinely-new dealers, plus reactivation plays." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={UserPlus} label="Today's Suggestions" value={data.today.length} sub="New dealer prospects" color="emerald" />
        <MetricCard icon={MapPin} label="Cities Covered" value={[...new Set(data.today.map(d => d.city))].length} color="blue" />
        <MetricCard icon={DollarSign} label="Est. Monthly Potential" value={fmt(data.today.reduce((s, d) => s + d.estimatedMonthly, 0))} color="violet" />
        <MetricCard icon={Star} label="High Fit Prospects" value={data.today.filter(d => d.fitScore > 80).length} color="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.today.map((d, i) => (
          <div key={d.id} className="glass-card-hover p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: priorityColors[d.priority] + '20', color: priorityColors[d.priority] }}>
                  #{i + 1}
                </div>
                <div>
                  <h4 className="font-semibold text-white">{d.name}</h4>
                  <p className="text-sm text-gray-400 flex items-center gap-1 mt-0.5">
                    <MapPin size={12} />{d.city}, {d.state}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {d.categories.slice(0, 4).map(cat => (
                      <span key={cat} className="px-2 py-0.5 rounded text-xs bg-indigo-500/15 text-indigo-300">{cat}</span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">{d.reason}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-2xl font-bold" style={{ color: priorityColors[d.priority] }}>{d.fitScore}</div>
                <div className="text-xs text-gray-500">fit score</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-700/30 grid grid-cols-4 gap-2 text-center">
              <div><p className="text-xs text-gray-500">Est. Monthly</p><p className="text-sm font-medium text-white">{fmt(d.estimatedMonthly)}</p></div>
              <div>
                <p className="text-xs text-gray-500">Market Size</p>
                <p className="text-sm font-medium text-white">{d.marketSize != null ? fmt(d.marketSize) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Competitors</p>
                <p className="text-sm font-medium text-white">{d.competitorPresence != null ? d.competitorPresence : '—'}</p>
              </div>
              <div><p className="text-xs text-gray-500">Contact Via</p><p className="text-sm font-medium text-indigo-300">{d.contactMethod}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
