import { useMemo, useState } from 'react';
import { fmt } from '../../utils/format';

// Renders the financial-statement rows as an indented table. Tally returns
// groups in pre-order (parent first, children with higher depth right after),
// so we just walk the flat list — the visual indent is driven by `depth`.
function StatementTable({ title, rows, emptyHint }) {
  if (!rows?.length) {
    return (
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">{title}</h3>
        <p className="text-xs text-gray-500">{emptyHint}</p>
      </div>
    );
  }
  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-gray-700/50">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60">
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
              <th className="px-4 py-2">Group</th>
              <th className="px-4 py-2 text-right">Debit</th>
              <th className="px-4 py-2 text-right">Credit</th>
              <th className="px-4 py-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${i}`} className="border-t border-gray-800/60 hover:bg-gray-800/40">
                <td className="px-4 py-2 text-gray-200" style={{ paddingLeft: `${16 + r.depth * 16}px` }}>
                  {r.name}
                </td>
                <td className="px-4 py-2 text-right text-gray-300 font-mono text-xs">{r.debit ? fmt(r.debit) : '—'}</td>
                <td className="px-4 py-2 text-right text-gray-300 font-mono text-xs">{r.credit ? fmt(r.credit) : '—'}</td>
                <td className={`px-4 py-2 text-right font-mono text-xs ${r.net >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {fmt(r.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = tone === 'good' ? 'text-emerald-300'
    : tone === 'bad' ? 'text-amber-300'
    : 'text-white';
  return (
    <div className="glass-card p-4">
      <p className="text-[11px] text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${toneClass}`}>
        {typeof value === 'number' ? fmt(value) : value}
      </p>
    </div>
  );
}

export function ProfitLossTab({ financials }) {
  const pl = financials?.profitLoss;
  const totals = pl?.totals;
  const income = totals?.credit || 0;
  const expense = totals?.debit || 0;
  const netProfit = income - expense;
  const margin = income > 0 ? Math.round((netProfit / income) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Income" value={income} tone="good" />
        <StatCard label="Expenditure" value={expense} tone="bad" />
        <StatCard label="Net Profit" value={netProfit} tone={netProfit >= 0 ? 'good' : 'bad'} />
        <StatCard label="Net Margin" value={`${margin}%`} tone={margin >= 0 ? 'good' : 'bad'} />
      </div>
      <StatementTable
        title="Profit & Loss A/c"
        rows={pl?.rows || []}
        emptyHint="P&L report did not land in this sync. Run Sync again — the job is listed in the progress panel."
      />
    </div>
  );
}

export function BalanceSheetTab({ financials }) {
  const bs = financials?.balanceSheet;
  const totals = bs?.totals;
  const assets = totals?.debit || 0;
  const liabilities = totals?.credit || 0;
  const equity = assets - liabilities;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StatCard label="Total Assets" value={assets} tone="good" />
        <StatCard label="Total Liabilities" value={liabilities} tone="bad" />
        <StatCard label="Equity (derived)" value={equity} tone={equity >= 0 ? 'good' : 'bad'} />
      </div>
      <StatementTable
        title="Balance Sheet"
        rows={bs?.rows || []}
        emptyHint="Balance Sheet did not land in this sync. Run Sync again — the job is listed in the progress panel."
      />
    </div>
  );
}

export function TrialBalanceTab({ financials }) {
  const tb = financials?.trialBalance;
  const debit = tb?.totals?.debit || 0;
  const credit = tb?.totals?.credit || 0;
  const variance = Math.abs(debit - credit);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StatCard label="Total Debit" value={debit} />
        <StatCard label="Total Credit" value={credit} />
        <StatCard label="Variance" value={variance} tone={variance > 1 ? 'bad' : 'good'} />
      </div>
      <StatementTable
        title="Trial Balance"
        rows={tb?.rows || []}
        emptyHint="Trial Balance did not land in this sync. Run Sync again."
      />
    </div>
  );
}

// "All entries" table — every voucher type routed through the sync, with a
// type filter + text search. Shows one row per voucher: date, number, type,
// party ledger, amount. The transformer has already deduped by
// date|number|type so rows are unique.
export function VouchersTab({ financials }) {
  const vouchers = financials?.vouchers?.all || [];
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const mapped = vouchers.map((v) => {
      const t = String(v.VOUCHERTYPENAME || v._VOUCHERTYPENAME || '').trim();
      const d = String(v.DATE || v._DATE || '').trim();
      const n = String(v.VOUCHERNUMBER || v._VOUCHERNUMBER || '').trim();
      const party = String(v.PARTYLEDGERNAME || v._PARTYLEDGERNAME || '').trim();
      const amountStr = String(v.AMOUNT || v._AMOUNT || '0');
      const amount = Math.abs(parseFloat(amountStr.replace(/[^0-9.-]/g, '')) || 0);
      // Tally dates are YYYYMMDD — format for humans.
      const prettyDate = /^\d{8}$/.test(d)
        ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
        : d;
      return { date: prettyDate, sortKey: d, number: n, type: t, party, amount };
    });
    mapped.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return mapped;
  }, [vouchers]);

  const types = useMemo(() => {
    const set = new Set(rows.map((r) => r.type).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (!q) return true;
      return r.number.toLowerCase().includes(q)
        || r.party.toLowerCase().includes(q)
        || r.type.toLowerCase().includes(q);
    });
  }, [rows, typeFilter, search]);

  const totals = useMemo(() => ({
    count: filtered.length,
    value: filtered.reduce((s, r) => s + r.amount, 0),
  }), [filtered]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StatCard label="Entries" value={totals.count.toString()} />
        <StatCard label="Gross Value" value={totals.value} />
        <StatCard label="Voucher Types" value={(types.length - 1).toString()} />
      </div>
      <div className="glass-card p-5 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
          <h3 className="text-sm font-semibold text-gray-300 flex-1">All Entries</h3>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            {types.map((t) => (
              <option key={t} value={t}>{t === 'all' ? 'All voucher types' : t}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search number / party..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-700/50">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60">
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Number</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Party</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((r, i) => (
                <tr key={`${r.sortKey}-${r.number}-${i}`} className="border-t border-gray-800/60 hover:bg-gray-800/40">
                  <td className="px-4 py-2 text-gray-300 font-mono text-xs">{r.date}</td>
                  <td className="px-4 py-2 text-gray-300 font-mono text-xs">{r.number}</td>
                  <td className="px-4 py-2 text-gray-300 text-xs">{r.type}</td>
                  <td className="px-4 py-2 text-gray-200">{r.party || '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-200 font-mono text-xs">{r.amount ? fmt(r.amount) : '—'}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-gray-500">No entries match the current filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && (
          <p className="text-[11px] text-gray-500">Showing first 500 of {filtered.length} — narrow the filter to see more.</p>
        )}
      </div>
    </div>
  );
}
