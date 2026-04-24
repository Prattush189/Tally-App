import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loadFromSnapshot, tallyAvailable } from '../lib/tallyClient';
import { transformTallyFull } from '../lib/tallyTransformer';
import { useAuth } from './AuthContext';

// Single source of truth for every dashboard's "do we have Tally data yet?"
// decision. Reads straight from the Supabase `tally_snapshots` row and runs
// the transformer in memory — no localStorage cache, no quota failures, no
// per-tab staleness. Every reader hooks into this via `useTallyData()`.
//
// After a sync finishes in TallySync, call `refresh()` and the cloud snapshot
// re-hydrates everything downstream on the same tick. Other browsers / PCs
// pick up the new snapshot on their next mount or tab-return.

const TallyDataContext = createContext(null);

const EMPTY_STATE = {
  customers: [],
  totals: null,
  financials: null,
  raw: null,
  diagnostics: null,
  syncedAt: null,
  source: null,
  loading: false,
  error: null,
};

export function TallyDataProvider({ children }) {
  const { user, isDemo } = useAuth();
  const [state, setState] = useState({ ...EMPTY_STATE, loading: true });

  const refresh = useCallback(async () => {
    // No user, no Supabase backend, or demo account — stay empty and idle.
    // Demo users see the same "sync Tally first" notice as fresh real users.
    if (!user || isDemo || !tallyAvailable()) {
      setState({ ...EMPTY_STATE, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const snap = await loadFromSnapshot();
      if (!snap || !snap.success || !snap.raw) {
        setState({ ...EMPTY_STATE, loading: false, error: snap?.error || null });
        return;
      }
      const transformed = transformTallyFull(snap.raw);
      setState({
        customers: transformed.customers,
        totals: transformed.totals,
        financials: transformed.financials || null,
        raw: snap.raw,
        diagnostics: transformed.diagnostics || null,
        syncedAt: snap.updatedAt,
        source: snap.source,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [user, isDemo]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <TallyDataContext.Provider value={{ ...state, refresh }}>
      {children}
    </TallyDataContext.Provider>
  );
}

export function useTallyData() {
  const ctx = useContext(TallyDataContext);
  if (!ctx) throw new Error('useTallyData must be used inside <TallyDataProvider>');
  return ctx;
}
