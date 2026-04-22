import { useState } from 'react';
import { DollarSign, TrendingUp, Activity, Users } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import LoadingSpinner from '../common/LoadingSpinner';
import TimeGranularityToggle, { aggregateSeries } from '../common/TimeGranularityToggle';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt, TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

export default function RevenueMetrics() {
  const { data, loading } = useAnalytics('revenue');
  const [granularity, setGranularity] = useState('month');
  if (loading || !data) return <LoadingSpinner />;
  const trendSeries = aggregateSeries(data.revenueTrends, granularity);
  const trendLabel = granularity === 'month' ? '12 Months' : granularity === 'quarter' ? 'Quarterly' : 'Yearly';

  return (
    <div className="space-y-6">
      <SectionHeader icon={DollarSign} title="Revenue & Retention Metrics" subtitle="NRR, GRR, LTV & cohort analysis — all from invoice history" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={TrendingUp} label="Net Revenue Retention" value={`${data.latestNRR}%`} trend={2.1} color="emerald" />
        <MetricCard icon={Activity} label="Gross Revenue Retention" value={`${data.latestGRR}%`} trend={1.0} color="blue" />
        <MetricCard icon={DollarSign} label="Avg Customer LTV" value={fmt(data.avgLTV)} color="violet" />
        <MetricCard icon={Users} label="Expanding Accounts" value={data.expanding} sub={`Revenue growing >5%`} color="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-300">NRR & GRR Trend ({trendLabel})</h3>
            <TimeGranularityToggle value={granularity} onChange={setGranularity} size="xs" />
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} domain={[80, 130]} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ color: '#9ca3af' }} />
              <Line type="monotone" dataKey="nrr" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 4 }} name="NRR %" />
              <Line type="monotone" dataKey="grr" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} name="GRR %" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Cohort Retention (% retained over time)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.cohortData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="cohort" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} domain={[60, 105]} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ color: '#9ca3af' }} />
              <Line type="monotone" dataKey="month1" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} name="Month 1" connectNulls />
              <Line type="monotone" dataKey="month3" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} name="Month 3" connectNulls />
              <Line type="monotone" dataKey="month6" stroke={CHART_COLORS[2]} strokeWidth={2} dot={{ r: 3 }} name="Month 6" connectNulls />
              <Line type="monotone" dataKey="month12" stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 3 }} name="Month 12" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Expansion vs Contraction</h3>
        <div className="grid grid-cols-3 gap-6 text-center py-4">
          <div>
            <p className="text-4xl font-bold text-emerald-400">{data.expanding}</p>
            <p className="text-sm text-gray-400 mt-2">Expanding (&gt;5% growth)</p>
            <div className="mt-2 h-2 bg-gray-700 rounded-full mx-auto w-32">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${data.expanding / (data.expanding + data.stable + data.contracting) * 100}%` }} />
            </div>
          </div>
          <div>
            <p className="text-4xl font-bold text-gray-400">{data.stable}</p>
            <p className="text-sm text-gray-400 mt-2">Stable (±5%)</p>
            <div className="mt-2 h-2 bg-gray-700 rounded-full mx-auto w-32">
              <div className="h-full bg-gray-500 rounded-full" style={{ width: `${data.stable / (data.expanding + data.stable + data.contracting) * 100}%` }} />
            </div>
          </div>
          <div>
            <p className="text-4xl font-bold text-red-400">{data.contracting}</p>
            <p className="text-sm text-gray-400 mt-2">Contracting (&lt;-5%)</p>
            <div className="mt-2 h-2 bg-gray-700 rounded-full mx-auto w-32">
              <div className="h-full bg-red-500 rounded-full" style={{ width: `${data.contracting / (data.expanding + data.stable + data.contracting) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
