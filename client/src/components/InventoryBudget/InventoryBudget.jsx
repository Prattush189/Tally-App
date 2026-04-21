import { Package, AlertTriangle, DollarSign, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import SectionHeader from '../common/SectionHeader';
import MetricCard from '../common/MetricCard';
import DataTable from '../common/DataTable';
import LoadingSpinner from '../common/LoadingSpinner';
import { useExtended } from '../../hooks/useExtended';
import { fmt, TOOLTIP_STYLE, CHART_COLORS } from '../../utils/format';

const urgencyConfig = { Critical: { color: '#ef4444', bg: 'bg-red-500/10 border-red-500/20' }, Soon: { color: '#f59e0b', bg: 'bg-amber-500/10 border-amber-500/20' }, OK: { color: '#22c55e', bg: 'bg-emerald-500/10 border-emerald-500/20' } };

export default function InventoryBudget() {
  const { data, loading } = useExtended('inventory');
  if (loading || !data) return <LoadingSpinner />;

  const sortedAlloc = [...data.allocations].sort((a, b) => b.allocatedBudget - a.allocatedBudget);

  return (
    <div className="space-y-6">
      <SectionHeader icon={Package} title="Inventory Budget & Alerts" subtitle="Purchase budget distribution, stock levels, and reorder alerts by category" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={DollarSign} label="Total Budget" value={fmt(data.totalBudget)} sub="Monthly allocation" color="indigo" />
        <MetricCard icon={DollarSign} label="Allocated" value={fmt(data.totalAllocated)} sub={`${Math.round(data.totalAllocated / data.totalBudget * 100)}% utilised`} color="violet" />
        <MetricCard icon={AlertTriangle} label="Reorder Alerts" value={data.alerts.length} sub="Categories below reorder point" color="red" />
        <MetricCard icon={Package} label="Critical Stock" value={data.alerts.filter(a => a.urgency === 'Critical').length} sub="Needs immediate reorder" color="red" />
      </div>

      {/* Alerts Banner */}
      {data.alerts.length > 0 && (
        <div className="glass-card p-4 border-l-4 border-red-500">
          <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2"><AlertTriangle size={16} /> Inventory Alerts</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.alerts.map(a => (
              <div key={a.category} className={`p-3 rounded-lg border ${urgencyConfig[a.urgency].bg}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{a.category}</span>
                  <span className="text-xs font-bold" style={{ color: urgencyConfig[a.urgency].color }}>{a.urgency}</span>
                </div>
                <div className="flex gap-3 mt-1.5 text-xs text-gray-400">
                  <span>Stock: {a.currentStock}</span>
                  <span>Reorder at: {a.reorderPoint}</span>
                  <span>{a.daysOfStock}d left</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Order {a.suggestedOrder} units ({fmt(a.suggestedOrderValue)})</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Budget Allocation by Category</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={sortedAlloc} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => fmt(v)} />
              <YAxis dataKey="category" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={110} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => fmt(v)} />
              <Bar dataKey="allocatedBudget" radius={[0, 6, 6, 0]} barSize={16} name="Budget">
                {sortedAlloc.map((a, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Stock Levels — Days of Stock Remaining</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={[...data.allocations].sort((a, b) => a.daysOfStock - b.daysOfStock)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis dataKey="category" type="category" tick={{ fill: '#9ca3af', fontSize: 10 }} width={110} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="daysOfStock" radius={[0, 6, 6, 0]} barSize={16} name="Days of Stock">
                {[...data.allocations].sort((a, b) => a.daysOfStock - b.daysOfStock).map((a, i) => (
                  <Cell key={i} fill={a.daysOfStock < 15 ? '#ef4444' : a.daysOfStock < 25 ? '#f59e0b' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <DataTable headers={['Category', 'Avg Price', 'Margin', 'Stock', 'Reorder Pt', 'Optimal', 'Days Left', 'Turnover', 'Budget', 'Status']}>
        {data.allocations.map(a => (
          <tr key={a.category} className="border-b border-gray-800/50 hover:bg-gray-800/40">
            <td className="px-4 py-3 font-medium text-white">{a.category}</td>
            <td className="px-4 py-3 text-gray-300">₹{a.avgPrice}</td>
            <td className="px-4 py-3 text-emerald-400">{a.margin}%</td>
            <td className="px-4 py-3 text-gray-300">{a.currentStock}</td>
            <td className="px-4 py-3 text-gray-400">{a.reorderPoint}</td>
            <td className="px-4 py-3 text-gray-400">{a.optimalStock}</td>
            <td className="px-4 py-3"><span className={a.daysOfStock < 15 ? 'text-red-400 font-bold' : a.daysOfStock < 25 ? 'text-amber-400' : 'text-gray-300'}>{a.daysOfStock}d</span></td>
            <td className="px-4 py-3 text-gray-300">{a.stockTurnover}x</td>
            <td className="px-4 py-3 text-gray-300">{fmt(a.allocatedBudget)}</td>
            <td className="px-4 py-3"><span className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: urgencyConfig[a.urgency].color + '20', color: urgencyConfig[a.urgency].color }}>{a.urgency}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
