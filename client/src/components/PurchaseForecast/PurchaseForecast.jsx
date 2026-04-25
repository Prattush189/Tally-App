import { useState } from 'react';
import { TrendingUp, Calendar, DollarSign, Package } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, Cell } from 'recharts';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

export default function PurchaseForecast() {
  const { data, loading } = useExtended('forecast');
  const [selectedCat, setSelectedCat] = useState(null);

  if (loading || !data) return <LoadingSpinner />;

  const sorted = [...data.forecasts].sort((a, b) => b.totalForecast - a.totalForecast);
  const current = selectedCat || sorted[0];

  return (
    <div className="space-y-6">
      <SectionHeader icon={Calendar} title="Purchase Forecasting" subtitle="What to buy, when — 8-month demand forecast by category" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={DollarSign} label="Total 8-Month Forecast" value={fmt(data.totalForecast)} color="emerald" />
        <MetricCard icon={TrendingUp} label="Highest Demand" value={sorted[0]?.category || '—'} sub={sorted[0] ? fmt(sorted[0].totalForecast) : 'Awaiting voucher sync'} color="indigo" />
        <MetricCard icon={Package} label="Categories Tracked" value={data.forecasts.length} color="blue" />
        <MetricCard icon={Calendar} label="Forecast Horizon" value={`${data.months} months`} sub="May '26 — Dec '26" color="violet" />
      </div>

      {/* Category selector */}
      <div className="flex gap-2 flex-wrap">
        {sorted.map(f => (
          <button key={f.category} onClick={() => setSelectedCat(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${current?.category === f.category ? 'bg-indigo-600 text-white' : 'bg-gray-800/60 text-gray-400 hover:text-white border border-gray-700/50'}`}>
            {f.category}
          </button>
        ))}
      </div>

      {current && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">{current.category} — Forecast with Confidence Band</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={current.forecasts}>
                <defs>
                  <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
                <Area type="monotone" dataKey="upper" stroke="transparent" fill="url(#bandGrad)" name="Upper Bound" />
                <Area type="monotone" dataKey="predicted" stroke="#6366f1" fill="url(#forecastGrad)" strokeWidth={2.5} name="Predicted" />
                <Area type="monotone" dataKey="lower" stroke="#6366f1" strokeDasharray="4 4" fill="transparent" strokeWidth={1} strokeOpacity={0.4} name="Lower Bound" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Monthly Breakdown — Peak Months Highlighted</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={current.forecasts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
                <Bar dataKey="predicted" radius={[6, 6, 0, 0]} name="Forecast">
                  {current.forecasts.map((f, i) => <Cell key={i} fill={f.isPeak ? '#f59e0b' : '#6366f1'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500 inline-block" /> Peak Month</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-500 inline-block" /> Regular</span>
            </div>
          </div>
        </div>
      )}

      {/* All categories summary */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Category Forecast Summary</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={sorted}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="category" tick={{ fill: '#9ca3af', fontSize: 10 }} angle={-25} textAnchor="end" height={70} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
            <Bar dataKey="totalForecast" fill="#8b5cf6" radius={[6, 6, 0, 0]} name="8-Month Forecast" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
