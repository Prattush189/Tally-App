import { useState } from 'react';
import { MapPin, TrendingUp, Users, DollarSign } from 'lucide-react';
import indiaMap from '@svg-maps/india';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// @svg-maps/india ships a full-detail India SVG (all 28 states + 8 UTs) as
// a compile-time import — no CDN fetch, no CORS risk, no runtime failure
// mode. Each location has { name, id (2-letter code), path (SVG path) }.

// Normalize name for matching between our data and the svg-maps locations.
// svg-maps uses current canonical names (Odisha, Telangana, Puducherry etc.)
// matching our data. This handles tiny case / ampersand variants.
function normState(name) {
  if (!name) return '';
  let s = String(name).toLowerCase().trim();
  s = s.replace(/&/g, 'and').replace(/\s+/g, ' ');
  if (s === 'orissa') s = 'odisha';
  if (s === 'uttaranchal') s = 'uttarakhand';
  if (s === 'pondicherry') s = 'puducherry';
  return s;
}

export default function IndiaMap() {
  const { data, loading } = useExtended('map');
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null);

  if (loading || !data) return <LoadingSpinner />;

  const totalRevenue = data.states.reduce((s, st) => s + st.revenue, 0);
  const totalDealers = data.states.reduce((s, st) => s + st.dealers, 0);
  const sorted = [...data.states].sort((a, b) => b.revenue - a.revenue);
  const maxRev = sorted[0]?.revenue || 1;

  const byName = new Map(data.states.map((st) => [normState(st.state), st]));

  function colorFor(name) {
    const st = byName.get(normState(name));
    if (!st) return '#1e1b4b';
    const intensity = 0.35 + 0.55 * (st.revenue / maxRev);
    if (st.churnRisk === 'High') return `rgba(239, 68, 68, ${intensity})`;
    if (st.churnRisk === 'Medium') return `rgba(245, 158, 11, ${intensity})`;
    return `rgba(34, 197, 94, ${intensity})`;
  }

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
        <div className="lg:col-span-3 glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">India — Revenue Heatmap</h3>
          <div className="relative" style={{ minHeight: 520 }}>
            <svg viewBox={indiaMap.viewBox} className="w-full" style={{ maxHeight: 520 }}>
              {indiaMap.locations.map((loc) => {
                const st = byName.get(normState(loc.name));
                const isSelected = selected && normState(selected.state) === normState(loc.name);
                const isHover = hover && normState(hover) === normState(loc.name);
                return (
                  <path
                    key={loc.id}
                    d={loc.path}
                    fill={colorFor(loc.name)}
                    stroke={isSelected ? '#ffffff' : isHover ? '#c7d2fe' : 'rgba(99, 102, 241, 0.45)'}
                    strokeWidth={isSelected ? 1.5 : isHover ? 1.2 : 0.6}
                    style={{ cursor: st ? 'pointer' : 'default', transition: 'stroke 0.12s' }}
                    onClick={() => { if (st) setSelected(st); }}
                    onMouseEnter={() => setHover(loc.name)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{loc.name}{st ? ` — ${fmt(st.revenue)} · ${st.dealers} dealers · ${st.churnRisk} risk` : ''}</title>
                  </path>
                );
              })}
            </svg>
            {hover && (
              <div className="absolute top-2 right-2 bg-gray-900/90 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-200 pointer-events-none">
                <p className="font-semibold text-white">{hover}</p>
                {byName.get(normState(hover)) ? (
                  <>
                    <p className="text-gray-400">{fmt(byName.get(normState(hover)).revenue)} · {byName.get(normState(hover)).dealers} dealers</p>
                    <p className="text-gray-500">{byName.get(normState(hover)).churnRisk} risk</p>
                  </>
                ) : <p className="text-gray-500">No data</p>}
              </div>
            )}
            <div className="absolute bottom-2 left-2 flex gap-3 text-xs text-gray-500 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Low Risk</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Medium</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> High Risk</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#1e1b4b' }} /> No data</span>
            </div>
          </div>
        </div>

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
              <p className="text-gray-500 text-sm">Click a state on the map to see details</p>
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
