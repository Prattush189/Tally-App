import { useState } from 'react';
import { DollarSign, TrendingUp, Activity, Users } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import LoadingSpinner from '../common/LoadingSpinner';
import TimeGranularityToggle, { aggregateSeries } from '../common/TimeGranularityToggle';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useTallyData } from '../../context/TallyDataContext';
import { fmt, TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtSalesMonth(yyyymm) {
  if (!yyyymm || yyyymm.length < 6) return yyyymm || '';
  return `${MONTH_NAMES[Number(yyyymm.slice(4, 6)) - 1] || '?'} '${yyyymm.slice(2, 4)}`;
}

export default function RevenueMetrics() {
  const { data, loading } = useAnalytics('revenue');
  const { financials } = useTallyData();
  const [granularity, setGranularity] = useState('month');
  if (loading || !data) return <LoadingSpinner />;
  const trendSeries = aggregateSeries(data.revenueTrends, granularity);
  const trendLabel = granularity === 'month' ? '12 Months' : granularity === 'quarter' ? 'Quarterly' : 'Yearly';

  // Sales Register monthly trend — always available, even when the
  // per-customer voucher detail isn't (Tally crashes on the per-voucher
  // iterator on this dataset; only the pre-compiled report path is safe).
  const salesMonthly = financials?.sales?.monthly || [];
  const salesTotal = financials?.sales?.total || 0;
  const peakMonth = salesMonthly.reduce((peak, m) => (m.value || 0) > (peak?.value || 0) ? m : peak, null);

  return (
    <div className="space-y-6">
      <SectionHeader icon={DollarSign} title="Revenue & Retention Metrics" subtitle="Monthly revenue from Tally Sales Register, plus per-customer retention where voucher data permits" />

      {salesMonthly.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard icon={DollarSign} label="Total Revenue" value={fmt(salesTotal)} sub={`across ${salesMonthly.length} months`} color="emerald" />
          <MetricCard icon={TrendingUp} label="Peak Month" value={peakMonth ? fmtSalesMonth(peakMonth.month) : '—'} sub={peakMonth ? fmt(peakMonth.value) : ''} color="indigo" />
          <MetricCard icon={Activity} label="Avg Monthly Revenue" value={fmt(Math.round(salesTotal / Math.max(1, salesMonthly.length)))} color="violet" />
        </div>
      )}

      {salesMonthly.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Monthly Revenue Trend (Sales Register)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={salesMonthly.map(m => ({ ...m, label: fmtSalesMonth(m.month) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={v => fmt(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              <Bar dataKey="value" fill="#22c55e" radius={[6, 6, 0, 0]} name="Revenue" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

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
