import { useState } from 'react';
import { Heart, Users, AlertTriangle, CheckCircle } from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';

const statusColors = { Critical: '#ef4444', 'At Risk': '#f97316', 'Needs Attention': '#f59e0b', Healthy: '#22c55e' };

export default function CustomerHealth() {
  const { data, loading } = useExtended('customer-health');
  const [selected, setSelected] = useState(null);

  if (loading || !data) return <LoadingSpinner />;

  const pieData = Object.entries(data.distribution).map(([key, val]) => {
    const labels = { critical: 'Critical', atRisk: 'At Risk', needsAttention: 'Needs Attention', healthy: 'Healthy' };
    return { name: labels[key], value: val };
  });

  return (
    <div className="space-y-6">
      <SectionHeader icon={Heart} title="Customer Health Dashboard" subtitle="5-dimensional health scoring: Purchase, Payment, Engagement, Growth, Loyalty" />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard icon={Heart} label="Avg Health Score" value={data.avgHealth} sub="Out of 100" color={data.avgHealth > 60 ? 'emerald' : 'amber'} />
        <MetricCard icon={CheckCircle} label="Healthy" value={data.distribution.healthy} color="emerald" />
        <MetricCard icon={AlertTriangle} label="Needs Attention" value={data.distribution.needsAttention} color="amber" />
        <MetricCard icon={AlertTriangle} label="At Risk" value={data.distribution.atRisk} color="orange" />
        <MetricCard icon={AlertTriangle} label="Critical" value={data.distribution.critical} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Health Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                {pieData.map((e, i) => <Cell key={i} fill={statusColors[e.name]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {selected ? (
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">{selected.name} — Health Radar</h3>
            <ResponsiveContainer width="100%" height={250}>
              <RadarChart data={selected.radarData}>
                <PolarGrid stroke="#374151" />
                <PolarAngleAxis dataKey="dimension" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <PolarRadiusAxis tick={{ fill: '#6b7280', fontSize: 9 }} domain={[0, 100]} />
                <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="text-center">
              <span className="text-2xl font-bold" style={{ color: statusColors[selected.status] }}>{selected.overallHealth}</span>
              <span className="text-sm text-gray-400 ml-2">{selected.status}</span>
            </div>
          </div>
        ) : (
          <div className="glass-card p-5 flex items-center justify-center">
            <p className="text-gray-500 text-sm">Click a customer to see their health radar</p>
          </div>
        )}

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Bottom 15 by Health</h3>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
            {data.customers.slice(0, 15).map(c => (
              <div key={c.id} onClick={() => setSelected(c)}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-700/30 cursor-pointer transition-all">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: statusColors[c.status] + '20', color: statusColors[c.status] }}>
                  {c.overallHealth}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.segment} · {fmt(c.monthlyAvg)}/mo</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: statusColors[c.status] + '20', color: statusColors[c.status] }}>{c.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
