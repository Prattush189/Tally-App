import { createContext, useContext, useMemo, useState } from 'react';

// Global filter context: a year picker and a dealer picker live in the top
// bar and every dashboard reads from here. The "all" sentinel means no
// filter — that's the default so existing behaviour (show everything) is
// preserved for users who ignore the picker.

const FiltersContext = createContext(null);

export function FiltersProvider({ children }) {
  const [year, setYear] = useState('all');
  const [dealerId, setDealerId] = useState('all');

  const value = useMemo(() => ({ year, setYear, dealerId, setDealerId }), [year, dealerId]);
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used inside FiltersProvider');
  return ctx;
}

// Apply the current filters to a customer list. Dealer filter is trivial
// (drop everyone except the selected dealer). Year filter walks each
// customer's invoiceHistory, keeps only entries whose month ends with the
// selected 2-digit year suffix (Tally writes months like "Jan 26"), and
// recomputes revenue-derived aggregates (monthlyAvg, totalRevenue,
// invoiceCount) from the filtered subset so charts and metrics reflect the
// selection. Point-in-time fields (dso, aging buckets, churnRisk) are left
// untouched — they don't have a year-by-year shape.
export function applyFilters(customers, { year, dealerId }) {
  if (!Array.isArray(customers)) return [];
  let list = customers;
  if (dealerId && dealerId !== 'all') {
    list = list.filter(c => String(c.id) === String(dealerId));
  }
  if (!year || year === 'all') return list;

  const yearSuffix = String(year).slice(-2);
  return list.map(c => {
    const filtered = (c.invoiceHistory || []).filter(row => {
      const m = String(row.month || '').trim();
      return m.endsWith(yearSuffix) || m.endsWith(String(year));
    });
    if (!filtered.length) return { ...c, invoiceHistory: [], _filtered: true };
    const totalRevenue = filtered.reduce((s, r) => s + (r.value || 0), 0);
    const invoiceCount = filtered.reduce((s, r) => s + (r.invoiceCount || 0), 0);
    const monthlyAvg = Math.round(totalRevenue / filtered.length);
    return { ...c, invoiceHistory: filtered, totalRevenue, invoiceCount, monthlyAvg, _filtered: true };
  });
}

// Derive the option lists for the pickers from a live customer snapshot.
// Years are the distinct year suffixes appearing in any invoiceHistory
// entry; dealers are every customer (capped at the top 200 by monthlyAvg
// so the dropdown doesn't balloon on large books).
export function deriveFilterOptions(customers) {
  const yearSet = new Set();
  for (const c of customers || []) {
    for (const row of c.invoiceHistory || []) {
      const m = String(row.month || '').trim();
      const match = m.match(/\b(\d{2,4})$/);
      if (!match) continue;
      const tail = match[1];
      const full = tail.length === 2 ? `20${tail}` : tail;
      yearSet.add(full);
    }
  }
  const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  const dealers = [...(customers || [])]
    .sort((a, b) => (b.monthlyAvg || 0) - (a.monthlyAvg || 0))
    .slice(0, 200)
    .map(c => ({ id: c.id, name: c.name }));
  return { years, dealers };
}
