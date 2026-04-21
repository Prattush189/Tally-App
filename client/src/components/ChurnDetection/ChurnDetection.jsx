import { useState } from 'react';
import { AlertTriangle, TrendingDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import DataTable from '../common/DataTable';
import RiskBadge from '../common/RiskBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt, RISK_COLORS, TOOLTIP_STYLE } from '../../utils/format';

export default function ChurnDetection() {
  const { data, loading } = useAnalytics('churn');
  const [filter, setFilter] = useState('All');
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  if (loading || !data) return <LoadingSpinner />;

  const filtered = filter === 'All' ? data.customers : data.customers.filter(c => c.churnRisk === filter);

  return (
    <div className="space-y-6">
      <SectionHeader icon={AlertTriangle} title="Churn Detection" subtitle="Early warning system — purchase recency, frequency, value & SKU signals" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {data.distribution.map(d => (
          <div key={d.name} onClick={() => setFilter(f => f === d.name ? 'All' : d.name)}
            className={`cursor-pointer glass-card p-4 text-center transition-all ${filter === d.name ? 'border-indigo-500 ring-1 ring-indigo-500/30' : 'hover:border-gray-600/50'}`}>
            <p className="text-3xl font-bold" style={{ color: RISK_COLORS[d.name] }}>{d.value}</p>
            <p className="text-sm text-gray-400 mt-1">{d.name} Risk</p>
            <p className="text-xs text-gray-500 mt-0.5">Rev at risk: {fmt(d.atRiskRevenue)}</p>
          </div>
        ))}
        <MetricCard icon={TrendingDown} label="Avg Churn Score" value={Math.round(data.customers.reduce((s, c) => s + c.churnScore, 0) / data.customers.length)} sub="Lower is better (0-100)" color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Churn Score Distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.scoreDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="range" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} name="Customers">
                {data.scoreDistribution.map((_, i) => <Cell key={i} fill={['#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444'][i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {selectedCustomer && (
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">{selectedCustomer.name} — Invoice Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={selectedCustomer.invoiceHistory}>
                <defs><linearGradient id="churnGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
                <Area type="monotone" dataKey="value" stroke="#ef4444" fill="url(#churnGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {!selectedCustomer && (
          <div className="glass-card p-5 flex items-center justify-center">
            <p className="text-gray-500 text-sm">Click a customer row to see their invoice trend</p>
          </div>
        )}
      </div>

      <DataTable headers={['Customer', 'Segment', 'Churn Risk', 'Score', 'Last Order', 'Freq Decline', 'Revenue Δ', 'Reason', 'Action Window']}>
        {filtered.slice(0, 25).map(c => (
          <tr key={c.id} onClick={() => setSelectedCustomer(c)} className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors cursor-pointer">
            <td className="px-4 py-3 font-medium text-white">{c.name}</td>
            <td className="px-4 py-3 text-gray-300">{c.segment}</td>
            <td className="px-4 py-3"><RiskBadge risk={c.churnRisk} /></td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-12 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${c.churnScore}%`, backgroundColor: c.churnScore > 60 ? '#ef4444' : c.churnScore > 35 ? '#f59e0b' : '#22c55e' }} />
                </div>
                <span className="text-xs text-gray-400">{c.churnScore}</span>
              </div>
            </td>
            <td className="px-4 py-3 text-gray-300">{c.lastOrderDays}d ago</td>
            <td className="px-4 py-3">
              <span className={c.orderFreqDecline > 0 ? 'text-red-400' : 'text-emerald-400'}>
                {c.orderFreqDecline > 0 ? '↓' : '↑'}{Math.abs(c.orderFreqDecline)}%
              </span>
            </td>
            <td className="px-4 py-3">
              <span className={c.revenueChange < 0 ? 'text-red-400' : 'text-emerald-400'}>
                {c.revenueChange > 0 ? '+' : ''}{c.revenueChange}%
              </span>
            </td>
            <td className="px-4 py-3 text-gray-400 text-xs max-w-[200px] truncate">{c.churnReasons[0]}</td>
            <td className="px-4 py-3">
              <span className={`text-xs font-medium ${c.actionWindow === 'This week' ? 'text-red-400' : c.actionWindow === 'This month' ? 'text-amber-400' : 'text-gray-400'}`}>
                {c.actionWindow}
              </span>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
