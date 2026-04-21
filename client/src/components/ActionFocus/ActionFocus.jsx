import { Target } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import RiskBadge from '../common/RiskBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt } from '../../utils/format';

export default function ActionFocus() {
  const { data, loading } = useAnalytics('action-focus');
  if (loading || !data) return <LoadingSpinner />;

  const list = data.priorityList;
  const urgent = list.filter(c => c.churnRisk === 'High' || c.paymentRisk === 'High').length;
  const growth = list.filter(c => c.expansionScore > 70).length;
  const maintain = list.length - urgent - growth;

  return (
    <div className="space-y-6">
      <SectionHeader icon={Target} title="Prioritisation & Actionability" subtitle={`Here are the ${list.length} buyers you must think about this week — and why.`} />

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 text-center">
          <p className="text-4xl font-bold text-red-400">{urgent}</p>
          <p className="text-sm text-red-300 mt-1">Urgent Attention</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5 text-center">
          <p className="text-4xl font-bold text-blue-400">{growth}</p>
          <p className="text-sm text-blue-300 mt-1">Growth Accounts</p>
        </div>
        <div className="bg-gray-500/10 border border-gray-500/20 rounded-2xl p-5 text-center">
          <p className="text-4xl font-bold text-gray-300">{maintain}</p>
          <p className="text-sm text-gray-400 mt-1">Relationship Maintain</p>
        </div>
      </div>

      <div className="space-y-2">
        {list.map((c, i) => (
          <div key={c.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all hover:border-gray-600/50 ${
            i < 5 ? 'bg-red-500/5 border-red-500/20' : i < 10 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-gray-800/40 border-gray-700/50'
          }`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${
              i < 5 ? 'bg-red-500/20 text-red-400' : i < 10 ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-700/50 text-gray-400'
            }`}>#{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-white">{c.name}</span>
                <span className="text-xs text-gray-500">{c.segment} · {c.region}</span>
                <RiskBadge risk={c.churnRisk} />
                {c.paymentRisk !== 'Low' && (
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${c.paymentRisk === 'High' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'}`}>
                    Pay: {c.paymentRisk}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {c.reasons.map((r, ri) => <span key={ri} className="text-xs text-gray-400 bg-gray-700/50 px-2 py-0.5 rounded">{r}</span>)}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-semibold text-white">{fmt(c.monthlyAvg)}</p>
              <p className="text-xs text-gray-500">{c.actionWindow}</p>
            </div>
            <div className="w-12 text-center flex-shrink-0">
              <div className={`text-lg font-bold ${c.priorityScore > 60 ? 'text-red-400' : c.priorityScore > 35 ? 'text-amber-400' : 'text-gray-400'}`}>{c.priorityScore}</div>
              <div className="text-xs text-gray-500">score</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
