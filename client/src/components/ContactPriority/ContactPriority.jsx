import { Phone, Clock, TrendingDown, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import RiskBadge from '../common/RiskBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import AIInsights from '../common/AIInsights';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';

const urgencyColors = { Urgent: '#ef4444', High: '#f97316', Medium: '#f59e0b', Routine: '#6b7280' };

export default function ContactPriority() {
  const { data, loading } = useExtended('contact-priority');
  if (loading || !data) return <LoadingSpinner />;

  const list = data.customers;

  return (
    <div className="space-y-6">
      <SectionHeader icon={Phone} title="Contact Priority" subtitle="Who to contact based on recency, frequency & churn likelihood" />

      <AIInsights task="contact-priority" title="Outreach script from AI" subtitle="Ranked call plan for this week, with the opening line for each conversation." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Phone} label="Urgent Contacts" value={list.filter(c => c.contactUrgency === 'Urgent').length} sub="Call immediately" color="red" />
        <MetricCard icon={Clock} label="High Priority" value={list.filter(c => c.contactUrgency === 'High').length} sub="Schedule this week" color="orange" />
        <MetricCard icon={Users} label="Medium" value={list.filter(c => c.contactUrgency === 'Medium').length} color="amber" />
        <MetricCard icon={TrendingDown} label="Avg Contact Score" value={Math.round(list.reduce((s, c) => s + c.contactScore, 0) / list.length)} sub="Higher = more urgent" color="indigo" />
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Contact Score — Top 20 Customers</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={list.slice(0, 20)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 8 }} angle={-35} textAnchor="end" height={80} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="contactScore" radius={[6, 6, 0, 0]} name="Contact Score">
              {list.slice(0, 20).map((c, i) => <Cell key={i} fill={urgencyColors[c.contactUrgency]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2">
        {list.slice(0, 20).map((c, i) => (
          <div key={c.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
            c.contactUrgency === 'Urgent' ? 'bg-red-500/5 border-red-500/20' : c.contactUrgency === 'High' ? 'bg-orange-500/5 border-orange-500/20' : 'bg-gray-800/40 border-gray-700/50'
          }`}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: urgencyColors[c.contactUrgency] + '20', color: urgencyColors[c.contactUrgency] }}>
              #{i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-white">{c.name}</span>
                <span className="text-xs text-gray-500">{c.segment} · {c.region}</span>
                <RiskBadge risk={c.churnRisk} />
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: urgencyColors[c.contactUrgency] + '20', color: urgencyColors[c.contactUrgency] }}>{c.contactUrgency}</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">{c.suggestedAction}</p>
              <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
                <span>Last order: {c.lastOrderDays}d ago</span>
                <span>Last contact: {c.daysSinceContact}d ago</span>
                <span>Orders: {c.totalOrders}</span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-semibold text-white">{fmt(c.monthlyAvg)}/mo</p>
              <p className="text-lg font-bold mt-1" style={{ color: urgencyColors[c.contactUrgency] }}>{c.contactScore}</p>
              <p className="text-xs text-gray-500">score</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
