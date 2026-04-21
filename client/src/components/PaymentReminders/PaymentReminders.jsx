import { Bell, AlertTriangle, Clock, DollarSign, CheckCircle } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';

const urgencyConfig = {
  Critical: { color: '#ef4444', bg: 'bg-red-500/10 border-red-500/20', icon: AlertTriangle },
  High: { color: '#f97316', bg: 'bg-orange-500/10 border-orange-500/20', icon: Bell },
  Medium: { color: '#f59e0b', bg: 'bg-amber-500/10 border-amber-500/20', icon: Clock },
  Upcoming: { color: '#3b82f6', bg: 'bg-blue-500/10 border-blue-500/20', icon: Clock },
  Low: { color: '#6b7280', bg: 'bg-gray-500/10 border-gray-700/50', icon: CheckCircle },
};

export default function PaymentReminders() {
  const { data, loading } = useExtended('payment-reminders');
  if (loading || !data) return <LoadingSpinner />;

  const pieData = [
    { name: 'Critical', value: data.stats.critical },
    { name: 'High', value: data.stats.high },
    { name: 'Medium', value: data.stats.medium },
    { name: 'Upcoming', value: data.stats.upcoming },
  ].filter(d => d.value > 0);

  const actionable = data.reminders.filter(r => r.urgency !== 'Low');

  return (
    <div className="space-y-6">
      <SectionHeader icon={Bell} title="Payment Reminders" subtitle="Intelligent payment follow-ups based on each dealer's payment history" />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard icon={AlertTriangle} label="Critical" value={data.stats.critical} sub="Significantly overdue" color="red" />
        <MetricCard icon={Bell} label="High" value={data.stats.high} sub="Overdue 10+ days" color="orange" />
        <MetricCard icon={Clock} label="Medium" value={data.stats.medium} sub="Recently overdue" color="amber" />
        <MetricCard icon={Clock} label="Upcoming" value={data.stats.upcoming} sub="Due within 5 days" color="blue" />
        <MetricCard icon={DollarSign} label="Total Pending" value={fmt(data.stats.totalPending)} color="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Urgency Distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                {pieData.map((e, i) => <Cell key={i} fill={urgencyConfig[e.name]?.color || '#6b7280'} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="lg:col-span-2 space-y-2 max-h-[340px] overflow-y-auto pr-2">
          {actionable.slice(0, 15).map((r, i) => {
            const cfg = urgencyConfig[r.urgency] || urgencyConfig.Low;
            const Icon = cfg.icon;
            return (
              <div key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border ${cfg.bg}`}>
                <Icon size={18} style={{ color: cfg.color }} className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white text-sm">{r.name}</span>
                    <span className="text-xs text-gray-500">{r.segment}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{r.action}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    <span>Pending: {fmt(r.totalPending)}</span>
                    <span>{r.pendingInvoices} invoices</span>
                    <span>On-time rate: {r.onTimeRate}%</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {r.overdue && <p className="text-sm font-bold" style={{ color: cfg.color }}>{r.overdueDays}d overdue</p>}
                  <p className="text-xs text-gray-500">Predicted: {r.predictedPayDate}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
