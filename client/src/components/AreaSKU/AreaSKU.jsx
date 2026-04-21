import { MapPin, DollarSign, Layers, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import SectionHeader from '../common/SectionHeader';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

export default function AreaSKU() {
  const { data, loading } = useExtended('area-sku');
  if (loading || !data) return <LoadingSpinner />;

  const priceRangeKeys = Object.keys(data.priceData[0]).filter(k => k.startsWith('₹'));

  return (
    <div className="space-y-6">
      <SectionHeader icon={MapPin} title="Area-wise SKU Analysis" subtitle="Price range distribution & category penetration by region" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">SKU Price Range by Region</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.priceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="region" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ color: '#9ca3af' }} />
              {priceRangeKeys.map((key, i) => (
                <Bar key={key} dataKey={key} stackId="a" fill={CHART_COLORS[i]} name={key} radius={i === priceRangeKeys.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Average Price Point by Region</h3>
          <div className="space-y-4 mt-6">
            {data.priceData.map(r => (
              <div key={r.region} className="flex items-center gap-4">
                <span className="text-sm text-gray-300 w-16">{r.region}</span>
                <div className="flex-1 h-8 bg-gray-700/50 rounded-lg overflow-hidden relative">
                  <div className="h-full bg-gradient-to-r from-indigo-600 to-violet-500 rounded-lg flex items-center px-3"
                    style={{ width: `${(r.avgPrice / 1200) * 100}%` }}>
                    <span className="text-xs font-bold text-white">₹{r.avgPrice}</span>
                  </div>
                </div>
                <span className="text-xs text-gray-500 w-24">Best: {r.bestSelling}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Top Category Penetration by Region</h3>
        <div className="overflow-x-auto rounded-xl border border-gray-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 bg-gray-900/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Region</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Top Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Total SKUs</th>
                {data.categoryData[0] && Object.keys(data.categoryData[0]).filter(k => !['region', 'topCategory', 'totalSKUs'].includes(k)).slice(0, 6).map(cat => (
                  <th key={cat} className="px-3 py-3 text-left text-xs font-semibold text-gray-400">{cat.length > 10 ? cat.slice(0, 10) + '..' : cat}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.categoryData.map(r => (
                <tr key={r.region} className="border-b border-gray-800/50 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-medium text-white">{r.region}</td>
                  <td className="px-4 py-3 text-indigo-300 text-xs">{r.topCategory}</td>
                  <td className="px-4 py-3 text-gray-300">{r.totalSKUs}</td>
                  {Object.entries(r).filter(([k]) => !['region', 'topCategory', 'totalSKUs'].includes(k)).slice(0, 6).map(([cat, val]) => (
                    <td key={cat} className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <div className="w-8 h-1.5 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${val}%` }} /></div>
                        <span className="text-xs text-gray-400">{val}</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
