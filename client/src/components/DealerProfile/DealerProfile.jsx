import { useState, useEffect } from 'react';
import {
  User, ArrowLeft, TrendingUp, TrendingDown, DollarSign, Package, CreditCard,
  AlertTriangle, Star, Clock, MapPin, Hash, Search, ChevronRight, Sparkles
} from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, ComposedChart, Line
} from 'recharts';
import SectionHeader from '../common/SectionHeader';
import RiskBadge from '../common/RiskBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import api, { HAS_BACKEND } from '../../utils/api';
import { getDealer, getDealers } from '../../lib/extendedEngine';
import { useTallyData } from '../../context/TallyDataContext';
import { useAuth } from '../../context/AuthContext';
import { fmt, TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

const priorityColors = { Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#3b82f6' };
const typeColors = { Retention: '#ef4444', 'Cross-sell': '#8b5cf6', 'SKU Deepening': '#6366f1', Payment: '#f59e0b', Growth: '#22c55e', Timing: '#3b82f6' };

export default function DealerProfile() {
  const { isDemo, user } = useAuth();
  const { customers } = useTallyData();
  const [dealers, setDealers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [dealer, setDealer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [expandedSuggestion, setExpandedSuggestion] = useState(null);

  // Pick the customer source: cloud-synced data for real users, none for demo.
  const liveCustomers = !isDemo && customers.length ? customers : null;
  const overrides = liveCustomers ? { customers: liveCustomers } : undefined;

  // Load dealer list
  useEffect(() => {
    if (HAS_BACKEND) {
      api.get('/extended/dealers').then(r => {
        setDealers(r.data.dealers);
        setListLoading(false);
      }).catch(() => setListLoading(false));
    } else if (isDemo || liveCustomers) {
      setDealers(getDealers(overrides).dealers);
      setListLoading(false);
    } else {
      setDealers([]);
      setListLoading(false);
    }
  }, [isDemo, user?.email]);

  // Load dealer profile
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    if (HAS_BACKEND) {
      api.get(`/extended/dealer/${selectedId}`).then(r => {
        setDealer(r.data);
        setLoading(false);
        setExpandedSuggestion(null);
      }).catch(() => setLoading(false));
    } else {
      const d = getDealer(selectedId, overrides);
      setDealer(d);
      setLoading(false);
      setExpandedSuggestion(null);
    }
  }, [selectedId]);

  const filtered = dealers.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.city?.toLowerCase().includes(search.toLowerCase()) ||
    d.region?.toLowerCase().includes(search.toLowerCase())
  );

  // ─── DEALER LIST VIEW ──────────────────────────────────────────────────────
  if (!selectedId) {
    return (
      <div className="space-y-6">
        <SectionHeader icon={User} title="Dealer Analytics" subtitle="Select a dealer to view detailed analytics, health scores, and AI-powered suggestions" />

        <div className="glass-card p-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text" placeholder="Search dealers by name, city, or region..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 text-sm"
            />
          </div>
        </div>

        {listLoading ? <LoadingSpinner /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map(d => (
              <div key={d.id} onClick={() => setSelectedId(d.id)}
                className="glass-card-hover p-4 cursor-pointer group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center text-sm font-bold text-indigo-400 flex-shrink-0">
                      {d.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{d.name}</p>
                      <p className="text-xs text-gray-500">{d.segment} · {d.city}, {d.region}</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-gray-600 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                </div>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-800/50">
                  <span className="text-sm font-semibold text-indigo-400">{fmt(d.monthlyAvg)}/mo</span>
                  <RiskBadge risk={d.churnRisk} />
                  {d.paymentRisk !== 'Low' && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.paymentRisk === 'High' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                      Pay: {d.paymentRisk}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── DEALER DETAIL VIEW ────────────────────────────────────────────────────
  if (loading || !dealer) return <LoadingSpinner />;

  const agingColors = ['#22c55e', '#f59e0b', '#f97316', '#ef4444'];

  return (
    <div className="space-y-6">
      {/* Back button + Dealer Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => { setSelectedId(null); setDealer(null); }}
          className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 text-gray-400 hover:text-white transition-all">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-bold text-white">{dealer.name}</h2>
            <span className="text-sm text-gray-500">{dealer.segment}</span>
            <RiskBadge risk={dealer.churnRisk} />
            {dealer.paymentRisk !== 'Low' && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${dealer.paymentRisk === 'High' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
                Payment: {dealer.paymentRisk}
              </span>
            )}
          </div>
          <div className="flex gap-4 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><MapPin size={12} /> {dealer.city}, {dealer.region}</span>
            <span className="flex items-center gap-1"><Hash size={12} /> {dealer.gstin}</span>
            <span className="flex items-center gap-1"><Clock size={12} /> Joined {dealer.joinedDate}</span>
          </div>
        </div>
        <div className="text-right hidden md:block">
          <div className="text-3xl font-bold" style={{ color: dealer.overallHealth > 65 ? '#22c55e' : dealer.overallHealth > 40 ? '#f59e0b' : '#ef4444' }}>
            {dealer.overallHealth}
          </div>
          <p className="text-xs text-gray-500">Health Score</p>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { icon: DollarSign, label: 'Monthly Avg', value: fmt(dealer.monthlyAvg), color: 'indigo' },
          { icon: TrendingUp, label: 'Momentum', value: `${dealer.momentum > 0 ? '+' : ''}${dealer.momentum}%`, color: dealer.momentum >= 0 ? 'emerald' : 'red' },
          { icon: Package, label: 'SKUs / Categories', value: `${dealer.skuCount} / ${dealer.catCount}`, color: 'violet' },
          { icon: CreditCard, label: 'DSO', value: `${dealer.dso} days`, color: dealer.dso > 60 ? 'red' : dealer.dso > 35 ? 'amber' : 'emerald' },
          { icon: Star, label: 'Expansion Score', value: `${dealer.expansionScore}/100`, color: 'blue' },
          { icon: DollarSign, label: 'LTV', value: fmt(dealer.ltv), color: 'emerald' },
        ].map((m, i) => {
          const Icon = m.icon;
          return (
            <div key={i} className="glass-card p-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className={`text-${m.color}-400`} />
                <span className="text-xs text-gray-500">{m.label}</span>
              </div>
              <p className={`text-lg font-bold text-${m.color}-400`}>{m.value}</p>
            </div>
          );
        })}
      </div>

      {/* Charts Row 1 — Revenue Trend + Health Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Revenue & Order Trend (12 Months)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={dealer.orderTrend}>
              <defs>
                <linearGradient id="dealerRevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => name === 'Revenue' ? fmt(v) : v} />
              <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#6366f1" fill="url(#dealerRevGrad)" strokeWidth={2} name="Revenue" />
              <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Orders" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Health Radar</h3>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={dealer.healthRadar}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="dimension" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fill: '#6b7280', fontSize: 9 }} domain={[0, 100]} />
              <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 — Category Spend + Payment Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Category Spend Breakdown</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, dealer.categorySpend.length * 35)}>
            <BarChart data={dealer.categorySpend} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
              <YAxis dataKey="category" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={100} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              <Bar dataKey="spend" radius={[0, 6, 6, 0]} barSize={14} name="Monthly Spend">
                {dealer.categorySpend.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Payment Aging</h3>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie data={dealer.agingBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={80} dataKey="amount"
                  label={({ pct }) => pct > 0 ? `${pct}%` : ''}>
                  {dealer.agingBreakdown.map((_, i) => <Cell key={i} fill={agingColors[i]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2.5 flex-1">
              {dealer.agingBreakdown.map((a, i) => (
                <div key={a.bucket} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: agingColors[i] }} />
                    <span className="text-gray-400 text-xs">{a.bucket}</span>
                  </div>
                  <span className="font-medium text-gray-300">{fmt(a.amount)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-gray-700/50 flex justify-between text-sm">
                <span className="text-gray-400">Outstanding</span>
                <span className="font-bold text-white">{fmt(dealer.outstandingAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Credit Limit</span>
                <span className="font-medium text-gray-300">{fmt(dealer.creditLimit)}</span>
              </div>
            </div>
          </div>
          {/* Payment trend sparkline */}
          <h4 className="text-xs font-semibold text-gray-500 mt-4 mb-2">DSO Trend (12 Months)</h4>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={dealer.paymentHistory}>
              <defs>
                <linearGradient id="dsoGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 9 }} />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => `${v} days`} />
              <Area type="monotone" dataKey="dso" stroke="#f59e0b" fill="url(#dsoGrad)" strokeWidth={1.5} name="DSO" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Missed Categories */}
      {dealer.missedCategories.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Untapped Categories ({dealer.missedCategories.length})</h3>
          <div className="flex flex-wrap gap-2">
            {dealer.missedCategories.map(cat => (
              <span key={cat} className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm">{cat}</span>
            ))}
          </div>
        </div>
      )}

      {/* ─── AI SUGGESTIONS ────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Sparkles size={20} className="text-indigo-400" />
          <h3 className="text-lg font-bold text-white">AI-Powered Suggestions</h3>
          <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 text-xs font-medium border border-indigo-500/20">
            {dealer.aiMeta.model}
          </span>
        </div>

        {dealer.aiSuggestions.map((s, i) => (
          <div key={i} className="glass-card-hover overflow-hidden">
            <div
              className="p-5 cursor-pointer"
              onClick={() => setExpandedSuggestion(expandedSuggestion === i ? null : i)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-2xl flex-shrink-0">{s.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-white">{s.title}</h4>
                      <span className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{ backgroundColor: (typeColors[s.type] || '#6366f1') + '20', color: typeColors[s.type] || '#6366f1' }}>
                        {s.type}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold border"
                        style={{ backgroundColor: priorityColors[s.priority] + '15', color: priorityColors[s.priority], borderColor: priorityColors[s.priority] + '30' }}>
                        {s.priority}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{s.impact}</p>
                  </div>
                </div>
                <ChevronRight size={16} className={`text-gray-500 transition-transform flex-shrink-0 mt-1 ${expandedSuggestion === i ? 'rotate-90' : ''}`} />
              </div>
            </div>

            {expandedSuggestion === i && (
              <div className="px-5 pb-5 border-t border-gray-800/50">
                <p className="text-sm text-gray-300 mt-4 leading-relaxed">{s.suggestion}</p>
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-500 mb-2">ACTION ITEMS</p>
                  <div className="space-y-1.5">
                    {s.actions.map((action, j) => (
                      <div key={j} className="flex items-center gap-2 text-sm">
                        <div className="w-5 h-5 rounded-md bg-gray-800/80 border border-gray-700/50 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs text-gray-500">{j + 1}</span>
                        </div>
                        <span className="text-gray-300">{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Key Stats Footer */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap gap-6 text-xs text-gray-500 justify-center">
          <span>Total Orders: <strong className="text-gray-300">{dealer.totalOrders}</strong></span>
          <span>Avg Order Value: <strong className="text-gray-300">{fmt(dealer.avgOrderValue)}</strong></span>
          <span>Last Order: <strong className="text-gray-300">{dealer.lastOrderDays}d ago</strong></span>
          <span>Last Contacted: <strong className="text-gray-300">{dealer.lastContacted}d ago</strong></span>
          <span>SKU Penetration: <strong className="text-gray-300">{dealer.skuPenetration}%</strong></span>
          <span>Category Penetration: <strong className="text-gray-300">{dealer.catPenetration}%</strong></span>
        </div>
      </div>
    </div>
  );
}
