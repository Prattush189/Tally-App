import { Star, TrendingUp, Package, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import DataTable from '../common/DataTable';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

export default function ToyCategoryScore() {
  const { data, loading } = useExtended('toy-categories');
  if (loading || !data) return <LoadingSpinner />;

  // Empty state — the user is on real Tally data but either stock items
  // or sale vouchers haven't synced yet, so we have no categories to score.
  // Showing fake toy category names would be misleading; render an explainer.
  if (!data.categories.length) {
    return (
      <div className="space-y-6">
        <SectionHeader icon={Star} title="Toy Category Scores" subtitle="Category-level demand scoring from your Tally stock master" />
        <div className="glass-card p-6 border-l-4 border-amber-500">
          <div className="flex items-start gap-3">
            <AlertTriangle size={22} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">No category data yet from Tally</p>
              <p className="text-xs text-gray-400">
                {data.note || 'Categories are derived from stock items + sale voucher line items in your Tally file. Sync stockItems and salesVouchers to populate this view.'}
              </p>
              <p className="text-xs text-gray-500">
                Go to <span className="text-indigo-300">Tally Sync</span> → click <b>Sync Now</b>. Once sales vouchers come back without errors, the categories your customers actually buy will appear here.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sorted = [...data.categories].sort((a, b) => b.healthScore - a.healthScore);
  const recColors = { Expand: '#22c55e', Maintain: '#f59e0b', Review: '#ef4444' };

  return (
    <div className="space-y-6">
      <SectionHeader icon={Star} title="Toy Category Scores" subtitle="Category-level demand scoring, margin analysis & seasonal intelligence" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Star} label="Top Category" value={sorted[0]?.name} sub={`Score: ${sorted[0]?.healthScore}`} color="emerald" />
        <MetricCard icon={TrendingUp} label="Highest Margin" value={sorted.sort((a,b) => b.margin - a.margin)[0]?.name} sub={`${sorted[0]?.margin}% margin`} color="violet" />
        <MetricCard icon={Package} label="Categories" value={data.categories.length} color="indigo" />
        <MetricCard icon={AlertTriangle} label="Needs Review" value={data.categories.filter(c => c.recommendation === 'Review').length} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Category Health Scores</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={[...data.categories].sort((a, b) => b.healthScore - a.healthScore)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={110} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="healthScore" radius={[0, 6, 6, 0]} barSize={16} name="Health Score">
                {[...data.categories].sort((a, b) => b.healthScore - a.healthScore).map((c, i) => (
                  <Cell key={i} fill={c.healthScore > 70 ? '#22c55e' : c.healthScore > 45 ? '#f59e0b' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Margin vs Dealer Adoption vs Growth</h3>
          <ResponsiveContainer width="100%" height={350}>
            <RadarChart data={data.categories.slice(0, 6).map(c => ({
              category: c.name.split(' ')[0], margin: c.margin, adoption: c.dealerAdoption,
              growth: Math.max(0, c.growthRate + 20), demand: c.demandScore,
            }))}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="category" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fill: '#6b7280', fontSize: 9 }} />
              <Radar name="Margin" dataKey="margin" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2} />
              <Radar name="Adoption" dataKey="adoption" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <DataTable headers={['Category', 'Avg Price', 'Margin', 'Dealer Adoption', 'Growth', 'Return Rate', 'Health Score', 'Peak', 'Action']}>
        {[...data.categories].sort((a, b) => b.healthScore - a.healthScore).map(c => (
          <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/40">
            <td className="px-4 py-3 font-medium text-white">{c.name}</td>
            <td className="px-4 py-3 text-gray-300">₹{c.avgPrice}</td>
            <td className="px-4 py-3 text-emerald-400">{c.margin}%</td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-14 h-2 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${c.dealerAdoption}%` }} /></div>
                <span className="text-gray-300 text-xs">{c.dealerAdoption}%</span>
              </div>
            </td>
            <td className="px-4 py-3"><span className={c.growthRate > 0 ? 'text-emerald-400' : 'text-red-400'}>{c.growthRate > 0 ? '+' : ''}{c.growthRate}%</span></td>
            <td className="px-4 py-3 text-gray-300">{c.returnRate}%</td>
            <td className="px-4 py-3"><span className={`text-sm font-bold ${c.healthScore > 70 ? 'text-emerald-400' : c.healthScore > 45 ? 'text-amber-400' : 'text-red-400'}`}>{c.healthScore}</span></td>
            <td className="px-4 py-3 text-gray-400 text-xs">{c.peakMonths.join(', ')}</td>
            <td className="px-4 py-3"><span className="text-xs font-medium px-2 py-1 rounded-full" style={{ backgroundColor: recColors[c.recommendation] + '20', color: recColors[c.recommendation] }}>{c.recommendation}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
