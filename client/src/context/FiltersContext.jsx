import { createContext, useContext, useMemo, useState } from 'react';

// Global filter context: a date-range picker and a dealer picker live in
// the top bar; every dashboard reads from here. The empty-string
// sentinel for the date range means "no filter" (full data span); the
// 'all' sentinel for dealer means "no filter" too. Both default to the
// no-filter state so previously-rendered dashboards keep their full
// view for users who don't touch the pickers.

const FiltersContext = createContext(null);

export function FiltersProvider({ children }) {
  // dateFrom / dateTo are YYYY-MM-DD strings (matching the value
  // returned by <input type="date">). Empty string = unbounded on
  // that side. Defaults to fully unbounded so old behaviour
  // ("show everything") is the default.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dealerId, setDealerId] = useState('all');

  const value = useMemo(
    () => ({ dateFrom, setDateFrom, dateTo, setDateTo, dealerId, setDealerId }),
    [dateFrom, dateTo, dealerId],
  );
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used inside FiltersProvider');
  return ctx;
}

// Map a "Mon YY" month label (Tally's format) to the YYYY-MM-01 ISO
// date that represents the first of that month. Returns null when the
// label can't be parsed; the filter treats that as "include this row"
// rather than dropping unrecognised history.
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function monthLabelToIso(label) {
  if (!label) return null;
  const s = String(label).trim().toLowerCase();
  // Match "Jan 26", "Jan 2026", "January 2026". Permissive on whitespace.
  const m = s.match(/^([a-z]+)\s+(\d{2,4})$/);
  if (!m) return null;
  const monthIdx = MONTH_NAMES.indexOf(m[1].slice(0, 3));
  if (monthIdx < 0) return null;
  let year = Number(m[2]);
  if (!Number.isFinite(year)) return null;
  if (year < 100) year += 2000;
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
}

// Apply the current filters to a customer list. Dealer filter is
// trivial (drop everyone except the selected dealer). Date-range
// filter keeps only invoiceHistory rows whose parsed month falls in
// [dateFrom, dateTo] (either bound may be empty = unbounded), and
// recomputes revenue-derived aggregates (monthlyAvg, totalRevenue,
// invoiceCount) from the surviving subset so charts and metrics
// reflect the selection. Point-in-time fields (dso, aging buckets,
// churnRisk) are left untouched — they don't have a per-month shape.
export function applyFilters(customers, { dateFrom, dateTo, dealerId }) {
  if (!Array.isArray(customers)) return [];
  let list = customers;
  if (dealerId && dealerId !== 'all') {
    list = list.filter(c => String(c.id) === String(dealerId));
  }
  if (!dateFrom && !dateTo) return list;
  return list.map(c => {
    const filtered = (c.invoiceHistory || []).filter(row => {
      const iso = monthLabelToIso(row.month);
      if (!iso) return true;
      if (dateFrom && iso < dateFrom) return false;
      if (dateTo && iso > dateTo) return false;
      return true;
    });
    if (!filtered.length) return { ...c, invoiceHistory: [], _filtered: true };
    const totalRevenue = filtered.reduce((s, r) => s + (r.value || 0), 0);
    const invoiceCount = filtered.reduce((s, r) => s + (r.invoiceCount || 0), 0);
    const monthlyAvg = Math.round(totalRevenue / filtered.length);
    return { ...c, invoiceHistory: filtered, totalRevenue, invoiceCount, monthlyAvg, _filtered: true };
  });
}

// Derive the option lists for the pickers from a live customer
// snapshot. dataSpan is the actual min/max month range we have data
// for — the date picker uses these as min/max attributes so the user
// can't pick a range outside what was synced. dealers is the top-200
// customers by monthlyAvg (the dropdown would balloon otherwise).
export function deriveFilterOptions(customers) {
  let minIso = null;
  let maxIso = null;
  for (const c of customers || []) {
    for (const row of c.invoiceHistory || []) {
      const iso = monthLabelToIso(row.month);
      if (!iso) continue;
      if (!minIso || iso < minIso) minIso = iso;
      if (!maxIso || iso > maxIso) maxIso = iso;
    }
  }
  // Pad the upper bound to month-end so the date input shows "Mar 31"
  // not "Mar 01" when the data ends in March.
  const maxEnd = maxIso ? endOfMonthIso(maxIso) : null;
  const dealers = [...(customers || [])]
    .sort((a, b) => (b.monthlyAvg || 0) - (a.monthlyAvg || 0))
    .slice(0, 200)
    .map(c => ({ id: c.id, name: c.name }));
  return {
    dataSpan: { from: minIso, to: maxEnd },
    dealers,
  };
}

function endOfMonthIso(iso) {
  // iso is YYYY-MM-DD on the 1st. Bump month by one and step back a day.
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return iso;
  const nextMonth = m === 12 ? new Date(y + 1, 0, 0) : new Date(y, m, 0);
  const yy = nextMonth.getFullYear();
  const mm = String(nextMonth.getMonth() + 1).padStart(2, '0');
  const dd = String(nextMonth.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
