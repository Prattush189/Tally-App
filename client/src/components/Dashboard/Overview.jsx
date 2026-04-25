import { useState } from 'react';
import { BarChart3, Users, DollarSign, AlertTriangle, ShieldAlert, Package, TrendingUp, Target, Wallet, Receipt, FileWarning, Info } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import MetricCard from '../common/MetricCard';
import SectionHeader from '../common/SectionHeader';
import LoadingSpinner from '../common/LoadingSpinner';
import TimeGranularityToggle, { aggregateSeries } from '../common/TimeGranularityToggle';
import { useAnalytics } from '../../hooks/useAnalytics';
import { fmt, RISK_COLORS, TOOLTIP_STYLE } from '../../utils/format';

const BUCKET_COLORS = ['#10b981', '#6366f1', '#8b5cf6', '#f59e0b', '#ef4444'];

function LedgerOnlyOverview({ data }) {
  const ledger = data.ledger;
  return (
    <div className="space-y-6">
      <SectionHeader icon={BarChart3} title="Receivables Overview" subtitle="Ledger-driven intelligence — voucher data is paused" />

      <div className="glass-card p-4 border-l-4 border-amber-500/70">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-amber-300 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">Voucher data unavailable — Day Book is disabled on this dataset.</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Sales / receipt vouchers can&apos;t be fetched from this Tally install (c0000005 crash on the voucher tree). The tiles below are computed entirely from the ledger master — outstanding balances, credit limits, region, and GSTIN. Revenue, DSO, churn, SKU penetration, and aging trends will fill in automatically once vouchers can be synced.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Users} label="Total Dealers" value={ledger.totalDealers} sub="Sundry Debtors loaded" color="indigo" />
        <MetricCard icon={Wallet} label="Total Receivables" value={fmt(ledger.totalReceivables)} sub="Sum of closing balances" color="emerald" />
        <MetricCard icon={Receipt} label="Avg Receivable / Dealer" value={fmt(ledger.avgReceivable)} sub="Across dealers with balance" color="violet" />
        <MetricCard icon={FileWarning} label="Over Credit Limit" value={ledger.overLimit} sub={`${ledger.overLimitPct}% of dealers`} color="red" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={ShieldAlert} label="GSTIN Coverage" value={`${ledger.gstinPct}%`} sub={`${ledger.withGstin} dealers registered`} color="cyan" />
        <MetricCard icon={Target} label="Credit Terms Set" value={`${ledger.creditTermsPct}%`} sub={`${ledger.withCreditTerms} dealers with limit`} color="blue" />
        <MetricCard icon={TrendingUp} label="Top 20% Concentration" value={`${ledger.top20Concentration}%`} sub="Receivables held by top 20% of dealers" color="amber" />
        <MetricCard icon={Package} label="Settled Dealers" value={ledger.settled} sub={`${ledger.settledPct}% have zero balance`} color="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Receivables by Region</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={ledger.receivablesByRegion}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="region" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => n === 'receivables' ? fmt(v) : v} />
              <Legend wrapperStyle={{ color: '#9ca3af' }} />
              <Bar dataKey="receivables" fill="#6366f1" radius={[8, 8, 0, 0]} name="Receivables" />
              <Bar dataKey="dealers" fill="#8b5cf6" radius={[8, 8, 0, 0]} name="Dealers" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Outstanding Balance Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={ledger.outstandingBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                {ledger.outstandingBuckets.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i % BUCKET_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Top 10 Dealers by Outstanding</h3>
        <div className="overflow-x-auto rounded-xl border border-gray-700/50">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60">
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Dealer</th>
                <th className="px-4 py-2">Region</th>
                <th className="px-4 py-2 text-right">Outstanding</th>
                <th className="px-4 py-2 text-right">Credit Limit</th>
                <th className="px-4 py-2 text-right">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {ledger.topByOutstanding.map((d, i) => (
                <tr key={d.id} className="border-t border-gray-800/60 hover:bg-gray-800/40">
                  <td className="px-4 py-2 text-gray-500 font-mono text-xs">{i + 1}</td>
                  <td className="px-4 py-2 text-gray-200">{d.name}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs">{d.region || '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-200 font-mono text-xs">{fmt(d.outstanding)}</td>
                  <td className="px-4 py-2 text-right text-gray-400 font-mono text-xs">{d.creditLimit ? fmt(d.creditLimit) : '—'}</td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${d.utilization == null ? 'text-gray-500' : d.utilization > 100 ? 'text-red-400' : d.utilization > 70 ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {d.utilization == null ? '—' : `${d.utilization}%`}
                  </td>
                </tr>
              ))}
              {!ledger.topByOutstanding.length && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-gray-500">No outstanding balances on file.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Overview() {
  const { data, loading } = useAnalytics('overview');
  const [granularity, setGranularity] = useState('month');
  if (loading || !data) return <LoadingSpinner />;
  if (data.ledgerOnly) return <LedgerOnlyOverview data={data} />;

  const trendSeries = aggregateSeries(data.revenueTrends, granularity);
  const trendLabel = granularity === 'month' ? '12 Months' : granularity === 'quarter' ? 'Quarterly' : 'Yearly';

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
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-300">Revenue Trend ({trendLabel})</h3>
            <TimeGranularityToggle value={granularity} onChange={setGranularity} size="xs" />
          </div>
          {granularity === 'year' && trendSeries.length <= 1 ? (
            <div className="h-[280px] flex flex-col items-center justify-center gap-3">
              <p className="text-xs text-gray-500">Full-year total</p>
              <p className="text-4xl font-bold text-white">{fmt(trendSeries[0]?.revenue || 0)}</p>
              <p className="text-xs text-gray-500">Across the last 12 months of invoice data</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trendSeries}>
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
          )}
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
