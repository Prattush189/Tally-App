import { Megaphone, DollarSign, Users, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import RiskBadge from '../common/RiskBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

const stratColors = { 'Retention focus': '#ef4444', 'Growth accelerate': '#22c55e', 'Maintain presence': '#6366f1' };

export default function MarketingBudget() {
  const { data, loading } = useExtended('marketing-budget');
  if (loading || !data) return <LoadingSpinner />;

  const channelTotals = [
    { channel: 'In-Store Display', total: data.dealerAllocations.reduce((s, d) => s + d.channels.inStoreDisplay, 0) },
    { channel: 'Co-op Advertising', total: data.dealerAllocations.reduce((s, d) => s + d.channels.coopAdvertising, 0) },
    { channel: 'Trade Schemes', total: data.dealerAllocations.reduce((s, d) => s + d.channels.tradeSchemes, 0) },
    { channel: 'Merchandising', total: data.dealerAllocations.reduce((s, d) => s + d.channels.merchandising, 0) },
    { channel: 'Digital Support', total: data.dealerAllocations.reduce((s, d) => s + d.channels.digitalSupport, 0) },
  ];

  const stratDist = [
    { name: 'Retention', value: data.dealerAllocations.filter(d => d.strategy === 'Retention focus').length },
    { name: 'Growth', value: data.dealerAllocations.filter(d => d.strategy === 'Growth accelerate').length },
    { name: 'Maintain', value: data.dealerAllocations.filter(d => d.strategy === 'Maintain presence').length },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader icon={Megaphone} title="Marketing & Merchandising Budget" subtitle="Per-dealer marketing allocation based on revenue, growth potential & churn risk" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={DollarSign} label="Total Marketing Budget" value={fmt(data.totalMarketingBudget)} sub="Monthly" color="indigo" />
        <MetricCard icon={Users} label="Dealers Covered" value={data.dealerAllocations.length} color="blue" />
        <MetricCard icon={TrendingUp} label="Avg ROI" value={`${(data.dealerAllocations.reduce((s, d) => s + d.roi, 0) / data.dealerAllocations.length).toFixed(1)}x`} color="emerald" />
        <MetricCard icon={Megaphone} label="Top Channel" value={channelTotals.sort((a, b) => b.total - a.total)[0].channel} color="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Budget by Marketing Channel</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={channelTotals}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="channel" tick={{ fill: '#9ca3af', fontSize: 10 }} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              <Bar dataKey="total" fill="#6366f1" radius={[8, 8, 0, 0]} name="Total Budget" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Strategy Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={stratDist} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                {stratDist.map((e, i) => <Cell key={i} fill={[stratColors['Retention focus'], stratColors['Growth accelerate'], stratColors['Maintain presence']][i]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Dealer allocation cards */}
      <div className="space-y-2">
        {data.dealerAllocations.slice(0, 15).map((d, i) => (
          <div key={d.id} className="glass-card p-4 flex items-center gap-4">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-sm font-bold text-indigo-400 flex-shrink-0">#{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-white">{d.name}</span>
                <span className="text-xs text-gray-500">{d.segment} · {d.region}</span>
                <RiskBadge risk={d.churnRisk} />
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: stratColors[d.strategy] + '20', color: stratColors[d.strategy] }}>{d.strategy}</span>
              </div>
              <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
                <span>Revenue: {fmt(d.monthlyAvg)}/mo</span>
                <span>Expansion: {d.expansionScore}</span>
                <span>ROI: {d.roi}x</span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold text-indigo-400">{fmt(d.allocated)}</p>
              <p className="text-xs text-gray-500">allocated/mo</p>
            </div>
            <div className="hidden lg:flex gap-1 flex-shrink-0">
              {Object.entries(d.channels).slice(0, 3).map(([ch, val]) => (
                <div key={ch} className="bg-gray-900/50 rounded px-2 py-1 text-center">
                  <p className="text-xs text-gray-500 capitalize">{ch.replace(/([A-Z])/g, ' $1').slice(0, 8)}</p>
                  <p className="text-xs font-medium text-gray-300">{fmt(val)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
