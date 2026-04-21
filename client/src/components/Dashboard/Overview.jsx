import { BarChart3, Users, DollarSign, AlertTriangle, ShieldAlert, Package, TrendingUp, Target } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt, RISK_COLORS, TOOLTIP_STYLE } from '../../utils/format';

export default function Overview() {
  const { data, loading } = useAnalytics('overview');
  if (loading || !data) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <SectionHeader icon={BarChart3} title="Executive Overview" subtitle="Invoice-driven intelligence across all B2B accounts" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Users} label="Total Accounts" value={data.totalAccounts} sub="Active B2B customers" color="indigo" />
        <MetricCard icon={DollarSign} label="Monthly Revenue" value={fmt(data.totalRevenue)} sub="From invoice data" trend={8.2} color="emerald" />
        <MetricCard icon={AlertTriangle} label="High Churn Risk" value={data.highChurn} sub={`${Math.round(data.highChurn / data.totalAccounts * 100)}% of accounts`} color="red" />
        <MetricCard icon={ShieldAlert} label="Payment Risk" value={data.highPayment} sub={`Avg DSO: ${data.avgDSO} days`} color="amber" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Package} label="Avg SKU Penetration" value={`${data.avgSKUPen}%`} sub="Across all buyers" color="violet" />
        <MetricCard icon={TrendingUp} label="Net Revenue Retention" value={`${data.latestNRR}%`} sub="Last month" trend={2.1} color="emerald" />
        <MetricCard icon={Target} label="Expansion Opportunities" value={data.expandable} sub="Buyers with high expansion score" color="blue" />
        <MetricCard icon={DollarSign} label="Avg Customer LTV" value={fmt(data.avgLTV)} sub="Lifetime value" color="cyan" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Revenue Trend (12 Months)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.revenueTrends}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="url(#revGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Churn & Payment Risk Distribution</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 text-center mb-2">Churn Risk</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data.churnDistribution} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                    {data.churnDistribution.map((e, i) => <Cell key={i} fill={RISK_COLORS[e.name]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-gray-500 text-center mb-2">Payment Risk</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data.paymentDistribution} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                    {data.paymentDistribution.map((e, i) => <Cell key={i} fill={RISK_COLORS[e.name]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Revenue by Segment</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.segmentBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="segment" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={v => fmt(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              <Bar dataKey="revenue" fill="#6366f1" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Revenue by Region</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.regionBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="region" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={v => fmt(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              <Bar dataKey="revenue" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
