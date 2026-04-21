import { TrendingUp, Package, Layers, Target, Star } from 'lucide-react';
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import DataTable from '../common/DataTable';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';

export default function GrowthEngine() {
  const { data, loading } = useAnalytics('growth');
  if (loading || !data) return <LoadingSpinner />;

  const avgSKU = Math.round(data.customers.reduce((s, c) => s + c.skuPenetration, 0) / data.customers.length);
  const avgCat = Math.round(data.customers.reduce((s, c) => s + c.catPenetration, 0) / data.customers.length);

  return (
    <div className="space-y-6">
      <SectionHeader icon={TrendingUp} title="Growth Engine" subtitle="SKU & category penetration analysis with peer benchmarking" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Package} label="Avg SKU Penetration" value={`${avgSKU}%`} color="violet" />
        <MetricCard icon={Layers} label="Avg Category Penetration" value={`${avgCat}%`} color="indigo" />
        <MetricCard icon={Target} label="High Expansion (>70)" value={data.customers.filter(c => c.expansionScore > 70).length} color="blue" />
        <MetricCard icon={Star} label="Active SKUs / Categories" value={`${data.totalSKUs} / ${data.totalCategories}`} color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Category Adoption Across Buyers</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.catAdoption} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis dataKey="category" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={85} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="buyers" fill="#8b5cf6" radius={[0, 8, 8, 0]} barSize={18} name="# Buyers" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Top 15: SKU Penetration vs Expansion Score</h3>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={data.customers.slice(0, 15)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 9 }} angle={-35} textAnchor="end" height={80} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ color: '#9ca3af' }} />
              <Bar dataKey="skuPenetration" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={14} name="SKU %" />
              <Line type="monotone" dataKey="expansionScore" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="Expansion Score" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <DataTable headers={['Customer', 'Segment', 'SKU %', 'Cat %', 'Categories Bought', 'Missed', 'Expansion Score']}>
        {data.customers.slice(0, 20).map(c => (
          <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/40">
            <td className="px-4 py-3 font-medium text-white">{c.name}</td>
            <td className="px-4 py-3 text-gray-300">{c.segment}</td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${c.skuPenetration}%` }} /></div>
                <span className="text-gray-300 text-xs">{c.skuPenetration}%</span>
              </div>
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${c.catPenetration}%` }} /></div>
                <span className="text-gray-300 text-xs">{c.catPenetration}%</span>
              </div>
            </td>
            <td className="px-4 py-3 text-gray-300 text-xs">{c.purchasedCategories.slice(0, 3).join(', ')}{c.purchasedCategories.length > 3 ? ` +${c.purchasedCategories.length - 3}` : ''}</td>
            <td className="px-4 py-3 text-amber-400 text-xs">{c.missedCategories.slice(0, 2).join(', ')}{c.missedCategories.length > 2 ? ` +${c.missedCategories.length - 2}` : ''}</td>
            <td className="px-4 py-3"><span className={`text-sm font-bold ${c.expansionScore > 70 ? 'text-emerald-400' : c.expansionScore > 40 ? 'text-amber-400' : 'text-gray-400'}`}>{c.expansionScore}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
