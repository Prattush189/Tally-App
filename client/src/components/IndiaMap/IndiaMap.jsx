import { useState, useEffect } from 'react';
import { MapPin, TrendingUp, Users, DollarSign, AlertTriangle } from 'lucide-react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE } from '../../utils/format';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Fallback chain of public India-states TopoJSON/GeoJSON mirrors. We try them
// in order until one loads — some CDNs get blocked by ad blockers or have
// expired paths, so having three alternatives keeps the map from going dark.
// First good response wins; we pass the parsed object (not a URL) to
// react-simple-maps so parse errors surface in our catch handler.
const INDIA_MAP_SOURCES = [
  'https://cdn.jsdelivr.net/gh/deldersveld/topojson@master/countries/india/india-states.json',
  'https://cdn.jsdelivr.net/gh/Anuj-Arora/india-states-geojson@main/india.json',
  'https://raw.githubusercontent.com/deldersveld/topojson/master/countries/india/india-states.json',
];

// Normalize name for matching between our state data and the TopoJSON
// properties. TopoJSON sometimes uses "NCT of Delhi", "Orissa" (old spelling),
// "Jammu & Kashmir" etc.; our data uses the current short names.
function normState(name) {
  if (!name) return '';
  let s = String(name).toLowerCase().trim();
  s = s.replace(/^nct of /, '');
  s = s.replace(/&/g, 'and');
  s = s.replace(/\s+/g, ' ');
  if (s === 'orissa') s = 'odisha';
  if (s === 'uttaranchal') s = 'uttarakhand';
  return s;
}

export default function IndiaMap() {
  const { data, loading } = useExtended('map');
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null);
  const [geoData, setGeoData] = useState(null);
  const [geoError, setGeoError] = useState(null);

  // Manually fetch the TopoJSON so we can walk the fallback list and surface
  // any error visibly instead of rendering a silent empty SVG. AbortController
  // cancels in-flight fetches on unmount / re-render.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      for (const url of INDIA_MAP_SOURCES) {
        try {
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const parsed = await res.json();
          setGeoData(parsed);
          setGeoError(null);
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn(`[IndiaMap] ${url} failed:`, err.message);
        }
      }
      setGeoError('Could not fetch any India TopoJSON source. Check console + network tab — likely blocked by an extension or firewall.');
    })();
    return () => ctrl.abort();
  }, []);

  if (loading || !data) return <LoadingSpinner />;

  const totalRevenue = data.states.reduce((s, st) => s + st.revenue, 0);
  const totalDealers = data.states.reduce((s, st) => s + st.dealers, 0);
  const sorted = [...data.states].sort((a, b) => b.revenue - a.revenue);
  const maxRev = sorted[0]?.revenue || 1;

  // Build a quick lookup: normalized state name -> our data record. The
  // TopoJSON carries 36 state/UT features; only those matching our data get
  // coloured, the rest render as inactive fill.
  const byName = new Map(data.states.map((st) => [normState(st.state), st]));

  // Colour a state by its churn risk class + tint by revenue intensity.
  // No data → soft indigo (still clearly part of India). Active states use
  // emerald/amber/red to match the legend under the map.
  function colorFor(name) {
    const st = byName.get(normState(name));
    if (!st) return '#1e1b4b';
    const intensity = 0.35 + 0.55 * (st.revenue / maxRev);
    if (st.churnRisk === 'High') return `rgba(239, 68, 68, ${intensity})`;
    if (st.churnRisk === 'Medium') return `rgba(245, 158, 11, ${intensity})`;
    return `rgba(34, 197, 94, ${intensity})`;
  }

  function handleStateClick(geo) {
    const st = byName.get(normState(geo.properties.NAME_1 || geo.properties.name));
    if (st) setSelected(st);
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
            {geoError ? (
              <div className="h-[520px] flex flex-col items-center justify-center text-center p-6 gap-3">
                <AlertTriangle size={32} className="text-amber-400" />
                <p className="text-sm font-semibold text-white">Map tiles couldn't load</p>
                <p className="text-xs text-gray-400 max-w-md">{geoError}</p>
                <p className="text-[11px] text-gray-500">State bubbles and the right-side panel still work — click a state in the list.</p>
              </div>
            ) : !geoData ? (
              <div className="h-[520px] flex items-center justify-center">
                <p className="text-xs text-gray-500">Loading map…</p>
              </div>
            ) : (
            <ComposableMap
              projection="geoMercator"
              projectionConfig={{ center: [82, 22], scale: 1000 }}
              width={800}
              height={520}
              style={{ width: '100%', height: 520 }}
            >
              <Geographies geography={geoData}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const name = geo.properties.NAME_1 || geo.properties.name || '';
                    const st = byName.get(normState(name));
                    const isSelected = selected?.state && normState(selected.state) === normState(name);
                    const isHover = hover && normState(hover) === normState(name);
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onClick={() => handleStateClick(geo)}
                        onMouseEnter={() => setHover(name)}
                        onMouseLeave={() => setHover(null)}
                        style={{
                          default: {
                            fill: colorFor(name),
                            stroke: isSelected ? '#ffffff' : 'rgba(99, 102, 241, 0.4)',
                            strokeWidth: isSelected ? 1.4 : 0.6,
                            outline: 'none',
                            cursor: st ? 'pointer' : 'default',
                          },
                          hover: {
                            fill: st ? colorFor(name) : '#312e81',
                            stroke: '#ffffff',
                            strokeWidth: 1.2,
                            outline: 'none',
                            cursor: st ? 'pointer' : 'default',
                          },
                          pressed: { outline: 'none' },
                        }}
                      />
                    );
                  })
                }
              </Geographies>
            </ComposableMap>
            )}
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
            <div className="absolute bottom-2 left-2 flex gap-3 text-xs text-gray-500">
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
