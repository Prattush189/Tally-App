import { useState } from 'react';
import { MapPin, TrendingUp, Users, DollarSign } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function IndiaMap() {
  const { data, loading } = useExtended('map');
  const [selected, setSelected] = useState(null);

  if (loading || !data) return <LoadingSpinner />;

  const totalRevenue = data.states.reduce((s, st) => s + st.revenue, 0);
  const totalDealers = data.states.reduce((s, st) => s + st.dealers, 0);
  const sorted = [...data.states].sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="space-y-6">
      <SectionHeader icon={MapPin} title="India Map Analytics" subtitle="Geographic performance across states and regions" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={MapPin} label="Active States" value={data.totalStates} color="indigo" />
        <MetricCard icon={DollarSign} label="Total Revenue" value={fmt(totalRevenue)} color="emerald" />
        <MetricCard icon={Users} label="Total Dealers" value={totalDealers} color="blue" />
        <MetricCard icon={TrendingUp} label="Top State" value={sorted[0]?.state} sub={fmt(sorted[0]?.revenue)} color="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Map */}
        <div className="lg:col-span-3 glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">India — Revenue Heatmap</h3>
          <div className="relative" style={{ minHeight: 520 }}>
            <svg viewBox="150 100 450 520" className="w-full h-full">
              {/* India outline approximation */}
              <path d="M280,130 C310,120 340,130 360,150 L400,170 C430,180 460,200 470,230 L480,270 C490,310 480,340 470,370 L450,400 C430,430 410,460 390,480 L360,510 C340,540 320,560 300,570 L280,575 C260,570 240,550 230,530 L215,490 C205,460 200,430 210,400 L220,370 C215,340 210,310 220,280 L230,250 C225,220 240,190 260,170 Z"
                fill="#1e1b4b" fillOpacity="0.3" stroke="#4338ca" strokeWidth="1.5" strokeOpacity="0.4" />
              {data.states.map(st => {
                const maxRev = sorted[0]?.revenue || 1;
                const intensity = st.revenue / maxRev;
                const r = 6 + intensity * 18;
                const isSelected = selected?.state === st.state;
                return (
                  <g key={st.code} onClick={() => setSelected(st)} className="cursor-pointer">
                    <circle cx={st.x} cy={st.y} r={r}
                      fill={st.churnRisk === 'High' ? '#ef4444' : st.churnRisk === 'Medium' ? '#f59e0b' : '#22c55e'}
                      fillOpacity={isSelected ? 0.9 : 0.5}
                      stroke={isSelected ? '#fff' : 'transparent'} strokeWidth={isSelected ? 2 : 0}
                    />
                    <text x={st.x} y={st.y - r - 4} textAnchor="middle" fill="#9ca3af" fontSize="9" fontWeight="500">{st.code}</text>
                  </g>
                );
              })}
            </svg>
            <div className="absolute bottom-2 left-2 flex gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Low Risk</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Medium</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> High Risk</span>
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2 space-y-4">
          {selected ? (
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{selected.state}</h3>
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${selected.churnRisk === 'High' ? 'bg-red-500/20 text-red-400' : selected.churnRisk === 'Medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{selected.churnRisk} Risk</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900/50 rounded-lg p-3"><p className="text-xs text-gray-500">Revenue</p><p className="text-lg font-bold text-white">{fmt(selected.revenue)}</p></div>
                <div className="bg-gray-900/50 rounded-lg p-3"><p className="text-xs text-gray-500">Dealers</p><p className="text-lg font-bold text-white">{selected.dealers}</p></div>
                <div className="bg-gray-900/50 rounded-lg p-3"><p className="text-xs text-gray-500">Avg Order</p><p className="text-lg font-bold text-white">{fmt(selected.avgOrderValue)}</p></div>
                <div className="bg-gray-900/50 rounded-lg p-3"><p className="text-xs text-gray-500">Growth</p><p className={`text-lg font-bold ${selected.growth > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{selected.growth > 0 ? '+' : ''}{selected.growth}%</p></div>
                <div className="bg-gray-900/50 rounded-lg p-3"><p className="text-xs text-gray-500">Avg DSO</p><p className="text-lg font-bold text-white">{selected.avgDSO}d</p></div>
                <div className="bg-gray-900/50 rounded-lg p-3"><p className="text-xs text-gray-500">Penetration</p><p className="text-lg font-bold text-white">{selected.penetration}%</p></div>
              </div>
              <div><p className="text-xs text-gray-500">Top Category</p><p className="text-sm text-indigo-300">{selected.topCategory}</p></div>
              <div><p className="text-xs text-gray-500">Cities</p><p className="text-sm text-gray-300">{selected.cities.join(', ')}</p></div>
            </div>
          ) : (
            <div className="glass-card p-5 flex items-center justify-center h-64">
              <p className="text-gray-500 text-sm">Click a state bubble on the map to see details</p>
            </div>
          )}

          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Top States by Revenue</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sorted.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={v => fmt(v)} />
                <YAxis dataKey="state" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={85} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
                <Bar dataKey="revenue" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
