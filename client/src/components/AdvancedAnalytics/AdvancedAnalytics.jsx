import { useState } from 'react';
import { Brain, Users, Target, TrendingUp, Layers } from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, AreaChart, Area, ComposedChart, Line } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt, TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

const RFM_COLORS = { Champions: '#22c55e', Loyal: '#3b82f6', Potential: '#f59e0b', 'Needs Attention': '#f97316', 'At Risk': '#ef4444' };
const HEALTH_COLORS = ['#ef4444', '#f59e0b', '#22c55e'];

export default function AdvancedAnalytics() {
  const { data, loading } = useAnalytics('advanced');
  const [tab, setTab] = useState('rfm');

  if (loading || !data) return <LoadingSpinner message="Computing advanced analytics..." />;

  const tabs = [
    { id: 'rfm', label: 'RFM Analysis' },
    { id: 'segment', label: 'Segment Health' },
    { id: 'pareto', label: 'Revenue Concentration' },
    { id: 'matrix', label: 'Risk Matrix' },
    { id: 'correlation', label: 'Correlations' },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader icon={Brain} title="Advanced Analytics" subtitle="RFM segmentation, Pareto analysis, risk matrices, and correlation insights" />

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-gray-800/60 rounded-xl border border-gray-700/50 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${tab === t.id ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* RFM Analysis */}
      {tab === 'rfm' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {data.rfmDist.map(seg => (
              <div key={seg.segment} className="glass-card p-4 text-center">
                <div className="w-3 h-3 rounded-full mx-auto mb-2" style={{ backgroundColor: RFM_COLORS[seg.segment] }} />
                <p className="text-2xl font-bold text-white">{seg.count}</p>
                <p className="text-xs text-gray-400 mt-1">{seg.segment}</p>
                <p className="text-xs text-gray-500">Avg: {fmt(seg.avgRevenue)}/mo</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">RFM Segment Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={data.rfmDist} cx="50%" cy="50%" innerRadius={60} outerRadius={110} dataKey="count" label={({ segment, count }) => `${segment}: ${count}`}>
                    {data.rfmDist.map((e, i) => <Cell key={i} fill={RFM_COLORS[e.segment]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">RFM Score Distribution (Top 30)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.rfmScores.sort((a, b) => b.rfmScore - a.rfmScore).slice(0, 30)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 8 }} angle={-45} textAnchor="end" height={80} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="rfmScore" radius={[4, 4, 0, 0]} name="RFM Score">
                    {data.rfmScores.slice(0, 30).map((e, i) => <Cell key={i} fill={RFM_COLORS[e.rfmSegment]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Segment Health */}
      {tab === 'segment' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Segment Health Radar</h3>
              <ResponsiveContainer width="100%" height={350}>
                <RadarChart data={[
                  { metric: 'Revenue', ...Object.fromEntries(data.segmentHealth.map(s => [s.segment, Math.round(s.avgRevenue / 1000)])) },
                  { metric: 'Penetration', ...Object.fromEntries(data.segmentHealth.map(s => [s.segment, s.avgPenetration])) },
                  { metric: 'Health (inv)', ...Object.fromEntries(data.segmentHealth.map(s => [s.segment, 100 - s.avgChurnScore])) },
                  { metric: 'DSO (inv)', ...Object.fromEntries(data.segmentHealth.map(s => [s.segment, Math.max(0, 100 - s.avgDSO)])) },
                  { metric: 'Count', ...Object.fromEntries(data.segmentHealth.map(s => [s.segment, s.count * 3])) },
                ]}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <PolarRadiusAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
                  {data.segmentHealth.map((s, i) => (
                    <Radar key={s.segment} name={s.segment} dataKey={s.segment} stroke={CHART_COLORS[i]} fill={CHART_COLORS[i]} fillOpacity={0.15} strokeWidth={2} />
                  ))}
                  <Legend wrapperStyle={{ color: '#9ca3af' }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Regional Performance</h3>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={data.regionHealth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="region" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={v => fmt(v)} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => name === 'Total Revenue' ? fmt(v) : v} />
                  <Legend wrapperStyle={{ color: '#9ca3af' }} />
                  <Bar yAxisId="left" dataKey="totalRevenue" fill="#6366f1" radius={[8, 8, 0, 0]} name="Total Revenue" />
                  <Line yAxisId="right" type="monotone" dataKey="churnRate" stroke="#ef4444" strokeWidth={2} dot={{ r: 5 }} name="Churn Rate %" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Segment table */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Segment Breakdown</h3>
            <div className="overflow-x-auto rounded-xl border border-gray-700/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700/50 bg-gray-900/50">
                    {['Segment', 'Accounts', 'Total Revenue', 'Avg Revenue', 'Avg DSO', 'Avg Churn Score', 'Avg SKU Penetration', 'High Risk'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.segmentHealth.map(s => (
                    <tr key={s.segment} className="border-b border-gray-800/50">
                      <td className="px-4 py-3 font-medium text-white">{s.segment}</td>
                      <td className="px-4 py-3 text-gray-300">{s.count}</td>
                      <td className="px-4 py-3 text-gray-300">{fmt(s.totalRevenue)}</td>
                      <td className="px-4 py-3 text-gray-300">{fmt(s.avgRevenue)}</td>
                      <td className="px-4 py-3 text-gray-300">{s.avgDSO}d</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${s.avgChurnScore > 50 ? 'text-red-400' : s.avgChurnScore > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>{s.avgChurnScore}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{s.avgPenetration}%</td>
                      <td className="px-4 py-3 text-red-400">{s.highRisk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Pareto / Revenue Concentration */}
      {tab === 'pareto' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <MetricCard icon={Users} label="Top 20% Revenue Share" value={`${data.paretoData[Math.floor(data.paretoData.length * 0.2)]?.cumulativePercent || 0}%`} sub="Revenue concentration" color="indigo" />
            <MetricCard icon={TrendingUp} label="Top Customer" value={fmt(data.paretoData[0]?.revenue || 0)} sub={data.paretoData[0]?.name} color="emerald" />
            <MetricCard icon={Target} label="Median Revenue" value={fmt(data.paretoData[Math.floor(data.paretoData.length / 2)]?.revenue || 0)} color="violet" />
          </div>

          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Revenue Pareto (Cumulative % vs Customer Rank)</h3>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={data.paretoData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="rank" tick={{ fill: '#9ca3af', fontSize: 11 }} label={{ value: 'Customer Rank', position: 'bottom', fill: '#6b7280', fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9ca3af', fontSize: 11 }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => name === 'revenue' ? fmt(v) : `${v}%`} />
                <Legend wrapperStyle={{ color: '#9ca3af' }} />
                <Bar yAxisId="left" dataKey="revenue" fill="#6366f1" radius={[2, 2, 0, 0]} name="Revenue" />
                <Line yAxisId="right" type="monotone" dataKey="cumulativePercent" stroke="#f59e0b" strokeWidth={2.5} dot={false} name="Cumulative %" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Risk Matrix */}
      {tab === 'matrix' && (
        <div className="space-y-6">
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold text-gray-300 mb-6">Customer Health Matrix — Churn Risk vs Payment Risk</h3>
            <div className="max-w-xl mx-auto">
              <div className="grid grid-cols-4 gap-2">
                <div className="text-xs text-gray-500 flex items-end justify-end pb-2 pr-2">Churn ↓ / Pay →</div>
                {['High', 'Medium', 'Low'].map(pr => (
                  <div key={pr} className="text-center text-xs font-semibold text-gray-400 pb-2">{pr} Payment</div>
                ))}
                {data.healthMatrix.map((row, ri) => (
                  <>
                    <div key={`label-${ri}`} className="text-xs font-semibold text-gray-400 flex items-center justify-end pr-2">{row.churnRisk} Churn</div>
                    {[row.payHigh, row.payMed, row.payLow].map((val, ci) => {
                      const danger = (2 - ri) + (2 - ci);
                      const bg = danger >= 3 ? 'bg-red-500/30 border-red-500/40' : danger >= 2 ? 'bg-amber-500/20 border-amber-500/30' : 'bg-emerald-500/15 border-emerald-500/25';
                      return (
                        <div key={ci} className={`${bg} border rounded-xl p-4 text-center transition-all hover:scale-105`}>
                          <p className="text-2xl font-bold text-white">{val}</p>
                          <p className="text-xs text-gray-400 mt-1">customers</p>
                        </div>
                      );
                    })}
                  </>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Correlations */}
      {tab === 'correlation' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">SKU Penetration vs Monthly Revenue</h3>
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="skuPenetration" name="SKU %" tick={{ fill: '#9ca3af', fontSize: 11 }} label={{ value: 'SKU Penetration %', position: 'bottom', fill: '#6b7280', fontSize: 11 }} />
                  <YAxis dataKey="monthlyRevenue" name="Revenue" tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => name === 'Revenue' ? fmt(v) : `${v}%`} />
                  <Scatter data={data.correlationData} fill="#6366f1" fillOpacity={0.7} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">DSO vs Churn Score</h3>
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="dso" name="DSO" tick={{ fill: '#9ca3af', fontSize: 11 }} label={{ value: 'DSO (days)', position: 'bottom', fill: '#6b7280', fontSize: 11 }} />
                  <YAxis dataKey="churnScore" name="Churn Score" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Scatter data={data.correlationData} fill="#ef4444" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
