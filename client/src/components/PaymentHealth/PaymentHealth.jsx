import { ShieldAlert, Clock, AlertTriangle, DollarSign, TrendingDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import DataTable from '../common/DataTable';
import RiskBadge from '../common/RiskBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';

export default function PaymentHealth() {
  const { data, loading } = useAnalytics('payment');
  if (loading || !data) return <LoadingSpinner />;

  const avgDSO = Math.round(data.customers.reduce((s, c) => s + c.dso, 0) / data.customers.length);
  const risky = data.customers.filter(c => c.paymentRisk !== 'Low');

  return (
    <div className="space-y-6">
      <SectionHeader icon={ShieldAlert} title="Payment Health" subtitle="DSO tracking, aging analysis & deterioration detection" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Clock} label="Average DSO" value={`${avgDSO} days`} color="amber" />
        <MetricCard icon={AlertTriangle} label="High Risk Accounts" value={data.customers.filter(c => c.paymentRisk === 'High').length} color="red" />
        <MetricCard icon={DollarSign} label="Total Outstanding" value={fmt(data.totalOutstanding)} color="orange" />
        <MetricCard icon={TrendingDown} label="Overdue (60+ days)" value={fmt(data.totalOverdue60)} sub="Needs immediate follow-up" color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Aging Buckets</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.agingBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="bucket" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={v => fmt(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              <Bar dataKey="amount" radius={[8, 8, 0, 0]}>
                {data.agingBuckets.map((_, i) => <Cell key={i} fill={['#22c55e', '#f59e0b', '#f97316', '#ef4444'][i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">DSO by Segment & Region</h3>
          <div className="grid grid-cols-2 gap-4">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.dsoBySegment} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis dataKey="segment" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={80} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="dso" fill="#8b5cf6" radius={[0, 8, 8, 0]} barSize={22} name="DSO (days)" />
              </BarChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.dsoByRegion} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis dataKey="region" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="dso" fill="#6366f1" radius={[0, 8, 8, 0]} barSize={22} name="DSO (days)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <DataTable headers={['Customer', 'Payment Risk', 'DSO', 'Outstanding', 'Credit Limit', '0-30d', '31-60d', '61-90d', '90+d', 'Trend', 'Priority']}>
        {risky.slice(0, 20).map(c => (
          <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors">
            <td className="px-4 py-3 font-medium text-white">{c.name}</td>
            <td className="px-4 py-3"><RiskBadge risk={c.paymentRisk} /></td>
            <td className="px-4 py-3 text-gray-300">{c.dso}d</td>
            <td className="px-4 py-3 text-gray-300">{fmt(c.outstandingAmount)}</td>
            <td className="px-4 py-3 text-gray-300">{fmt(c.creditLimit)}</td>
            <td className="px-4 py-3 text-gray-300">{fmt(c.agingCurrent)}</td>
            <td className="px-4 py-3 text-gray-300">{fmt(c.aging30)}</td>
            <td className="px-4 py-3 text-amber-400">{fmt(c.aging60)}</td>
            <td className="px-4 py-3 text-red-400">{c.aging90 > 0 ? fmt(c.aging90) : '—'}</td>
            <td className="px-4 py-3">
              <span className={c.paymentTrend === 'Worsening' ? 'text-red-400' : c.paymentTrend === 'Improving' ? 'text-emerald-400' : 'text-gray-400'}>{c.paymentTrend}</span>
            </td>
            <td className="px-4 py-3">
              <span className={`text-xs px-2 py-1 rounded-full ${c.paymentRisk === 'High' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                {c.paymentRisk === 'High' ? 'Urgent' : 'Monitor'}
              </span>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
