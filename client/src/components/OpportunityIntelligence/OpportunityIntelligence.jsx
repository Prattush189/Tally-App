import { Zap, Target, DollarSign, Layers, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import DataTable from '../common/DataTable';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';

export default function OpportunityIntelligence() {
  const { data, loading } = useAnalytics('opportunities');
  if (loading || !data) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <SectionHeader icon={Zap} title="Opportunity Intelligence" subtitle="Upsell & cross-sell opportunities based on peer buying behaviour" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Target} label="Total Opportunities" value={data.opportunities.length} color="blue" />
        <MetricCard icon={DollarSign} label="Potential Monthly Rev" value={fmt(data.totalPotential)} sub="From identified gaps" color="emerald" />
        <MetricCard icon={Layers} label="Top Gap Category" value={data.byCat[0]?.category || '—'} sub={`${data.byCat[0]?.opportunities || 0} buyers missing`} color="violet" />
        <MetricCard icon={Users} label="Enterprise Opportunities" value={data.opportunities.filter(o => o.segment === 'Enterprise').length} color="indigo" />
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Category Gap Opportunities (buyers who could buy but don't)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.byCat.slice(0, 10)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="category" tick={{ fill: '#9ca3af', fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => name === 'potentialRevenue' ? fmt(v) : v} />
            <Bar dataKey="opportunities" fill="#3b82f6" radius={[8, 8, 0, 0]} name="Buyers with gap" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <DataTable headers={['Rank', 'Customer', 'Segment', 'Current Rev', 'Missed Categories', 'Potential Rev', 'Expansion Score']}>
        {data.opportunities.slice(0, 20).map((o, i) => (
          <tr key={o.id} className="border-b border-gray-800/50 hover:bg-gray-800/40">
            <td className="px-4 py-3 text-indigo-400 font-bold">#{i + 1}</td>
            <td className="px-4 py-3 font-medium text-white">{o.name}</td>
            <td className="px-4 py-3 text-gray-300">{o.segment}</td>
            <td className="px-4 py-3 text-gray-300">{fmt(o.monthlyAvg)}/mo</td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-1">
                {o.topMissed.map(cat => <span key={cat} className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30">{cat}</span>)}
              </div>
            </td>
            <td className="px-4 py-3 text-emerald-400 font-medium">{fmt(o.potentialRevenue)}/mo</td>
            <td className="px-4 py-3"><span className={`text-sm font-bold ${o.expansionScore > 70 ? 'text-emerald-400' : 'text-amber-400'}`}>{o.expansionScore}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
