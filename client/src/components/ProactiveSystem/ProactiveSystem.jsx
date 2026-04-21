import { Bell, AlertTriangle, DollarSign, Zap } from 'lucide-react';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import RiskBadge from '../common/RiskBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt } from '../../utils/format';

const intentColors = {
  retention: 'text-red-400 bg-red-500/15',
  maintenance: 'text-amber-400 bg-amber-500/15',
  payment: 'text-orange-400 bg-orange-500/15',
  expansion: 'text-blue-400 bg-blue-500/15',
};

export default function ProactiveSystem() {
  const { data, loading } = useAnalytics('proactive');
  if (loading || !data) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <SectionHeader icon={Bell} title="Relationship Orchestration" subtitle="Behaviour-driven reminders — who to contact, when, and why" />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard icon={Bell} label="Active Reminders" value={data.stats.total} color="amber" />
        <MetricCard icon={AlertTriangle} label="Retention Alerts" value={data.stats.retention} color="red" />
        <MetricCard icon={DollarSign} label="Payment Follow-ups" value={data.stats.payment} color="orange" />
        <MetricCard icon={Zap} label="Expansion Prompts" value={data.stats.expansion} color="blue" />
        <MetricCard icon={Bell} label="Maintenance" value={data.stats.maintenance} color="amber" />
      </div>

      <div className="space-y-3">
        {data.reminders.slice(0, 15).map((r, i) => (
          <div key={r.id} className="glass-card-hover p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="bg-indigo-500/15 text-indigo-400 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0">#{i + 1}</div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white">{r.name}</span>
                    <span className="text-xs text-gray-500">{r.segment} · {r.region}</span>
                    <RiskBadge risk={r.churnRisk} />
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {r.triggers.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${intentColors[t.type]}`}>{t.type}</span>
                        <span className="text-sm text-gray-400">{t.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm text-gray-300">{fmt(r.monthlyAvg)}/mo</p>
                <p className="text-xs text-gray-500 mt-1">{r.actionWindow}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
