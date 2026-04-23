import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Circle, AlertCircle, Shield } from 'lucide-react';

// Stepwise progress panel for Test Connection + Sync Now. The edge function
// runs its work as a single opaque POST (~5-15s for test, ~60-200s for a
// full sync), so we can't stream real per-collection events today. Instead
// we drive an optimistic timeline based on the well-known step durations
// inside the edge function (see supabase/functions/tally/index.ts — 65s
// ledgers, 15s groups, 20s stockItems, 12s stockGroups, 45s sales, 35s
// receipts with 4s cooldowns between) and reconcile with the real
// fetched/errors arrays once the response arrives.
//
// The "portal" phase (hb.exe auto-login) is only shown if the diagnostics
// actually report it fired for this invocation — no point advertising a
// step that didn't run.

const STEPS = {
  test: [
    { key: 'host', label: 'Probing Tally host', etaMs: 2000 },
    { key: 'auth', label: 'Authenticating XML endpoint', etaMs: 3000 },
    { key: 'portal', label: 'Portal auto-login (hb.exe cp)', etaMs: 4000, conditional: true },
    { key: 'verify', label: 'Verifying XML response + company list', etaMs: 3000 },
  ],
  sync: [
    { key: 'discover', label: 'Discovering companies', etaMs: 3000 },
    { key: 'portal', label: 'Portal auto-login (hb.exe cp)', etaMs: 4000, conditional: true },
    { key: 'ledgers', label: 'Fetching ledgers (Sundry Debtors)', etaMs: 65000 },
    { key: 'accountingGroups', label: 'Fetching accounting groups', etaMs: 15000 },
    { key: 'stockItems', label: 'Fetching stock items', etaMs: 20000 },
    { key: 'stockGroups', label: 'Fetching stock groups', etaMs: 12000 },
    { key: 'salesVouchers', label: 'Fetching sales vouchers', etaMs: 45000 },
    { key: 'receiptVouchers', label: 'Fetching receipt vouchers', etaMs: 35000 },
    { key: 'persist', label: 'Persisting snapshot to cloud', etaMs: 3000 },
  ],
};

function StepRow({ step, status, detail }) {
  const Icon = status === 'done' ? CheckCircle2
    : status === 'error' ? AlertCircle
    : status === 'running' ? Loader2
    : step.key === 'portal' ? Shield
    : Circle;
  const cls = status === 'done' ? 'text-emerald-400'
    : status === 'error' ? 'text-red-400'
    : status === 'running' ? 'text-indigo-300 animate-spin'
    : 'text-gray-600';
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon size={14} className={`flex-shrink-0 ${cls}`} />
      <span className={status === 'pending' ? 'text-gray-500' : 'text-gray-200'}>{step.label}</span>
      {detail && <span className="text-gray-500">· {detail}</span>}
    </div>
  );
}

export default function SyncProgress({ kind = 'sync', active, result }) {
  // Wall-clock driver. While active=true we bump `elapsed` on a setInterval
  // so the optimistic step advances. When the response lands, `result`
  // tells us the real fetched/errors and we snap the UI to the truth.
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState(null);

  useEffect(() => {
    if (!active) { setElapsed(0); setStartedAt(null); return; }
    const t0 = Date.now();
    setStartedAt(t0);
    setElapsed(0);
    const id = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(id);
  }, [active]);

  // Skip the conditional portal step unless diagnostics confirm it fired.
  // During the in-flight phase we render it in pending state so the user
  // sees that the system will auto-login if needed.
  const portalFired = result?.diagnostics?.portalLoginAttempted;
  const steps = STEPS[kind].filter(s => !s.conditional || active || portalFired);

  // Compute cumulative ETA and derive where we are in the optimistic run.
  const totalEta = steps.reduce((s, st) => s + st.etaMs, 0);
  let cumulative = 0;
  const stepInfo = steps.map((s) => {
    const start = cumulative;
    cumulative += s.etaMs;
    return { ...s, start, end: cumulative };
  });

  // Per-step status. If we have a final result, project real outcomes.
  // If still active, use the optimistic elapsed cursor.
  const errKeys = new Set(Object.keys(result?.collectionErrors || result?.errors || {}));
  const fetchedKeys = new Set(result?.fetched || []);

  const statusFor = (step) => {
    if (result && !active) {
      if (step.key === 'portal') {
        if (result.diagnostics?.portalLoginOk) return 'done';
        if (result.diagnostics?.portalLoginAttempted && !result.diagnostics?.portalLoginOk) return 'error';
        return 'pending';
      }
      if (step.key === 'discover') {
        if (result.discoveryError) return 'error';
        return result.discoveredCompanies?.length ? 'done' : 'pending';
      }
      if (step.key === 'persist') return 'done';
      if (step.key === 'host' || step.key === 'auth' || step.key === 'verify') {
        return result.connected ?? result.success ? 'done' : 'error';
      }
      // Collection steps — use fetched / errors
      if (errKeys.has(step.key)) return 'error';
      if (fetchedKeys.has(step.key)) return 'done';
      return 'pending';
    }
    // Active run — use optimistic cursor.
    if (elapsed >= step.end) return 'done';
    if (elapsed >= step.start) return 'running';
    return 'pending';
  };

  const detailFor = (step) => {
    if (!result || active) return null;
    if (step.key === 'discover' && result.discoveredCompanies?.length) {
      return `${result.discoveredCompanies.length} company${result.discoveredCompanies.length === 1 ? '' : 'ies'}`;
    }
    if (step.key === 'portal') {
      if (result.diagnostics?.portalLoginOk) return 'session revived';
      if (result.diagnostics?.portalLoginError) return result.diagnostics.portalLoginError;
      return null;
    }
    const countKey = step.key === 'accountingGroups' ? 'groups' : step.key;
    // Note: the edge function's counts use salesVouchers / receiptVouchers /
    // stockItems / stockGroups / ledgers keys directly.
    const countMap = {
      ledgers: result.ledgers, salesVouchers: result.salesVouchers,
      receiptVouchers: result.receiptVouchers, stockItems: result.stockItems,
      stockGroups: result.stockGroups,
    };
    if (countMap[step.key] != null) return `${countMap[step.key]} records`;
    if (errKeys.has(step.key)) {
      const msg = (result.collectionErrors || result.errors || {})[step.key];
      return msg ? String(msg).slice(0, 60) : 'failed';
    }
    return null;
  };

  const displayedElapsed = result && !active ? (result.durationMs || (startedAt ? Date.now() - startedAt : 0)) : elapsed;
  const pct = Math.min(100, Math.round(((result && !active) ? 100 : (elapsed / totalEta * 100))));

  return (
    <div className="glass-card p-4 border border-indigo-500/30 bg-indigo-500/5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
          {kind === 'test' ? 'Testing connection' : 'Syncing from Tally'}
        </p>
        <p className="text-[11px] text-gray-500">
          {Math.round(displayedElapsed / 1000)}s · {pct}%
        </p>
      </div>
      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all duration-300 ${result && !result.success && !result.connected ? 'bg-red-500' : 'bg-indigo-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-1.5">
        {stepInfo.map((s) => (
          <StepRow key={s.key} step={s} status={statusFor(s)} detail={detailFor(s)} />
        ))}
      </div>
    </div>
  );
}
