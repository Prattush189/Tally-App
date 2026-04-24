import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Circle, AlertCircle, Shield } from 'lucide-react';

// Stepwise progress panel for the unified Sync button. The edge function
// runs its work as a single opaque POST (~60-200s), so we can't stream
// real per-collection events today. Instead we drive an optimistic
// timeline based on the step durations inside the edge function (see
// supabase/functions/tally/index.ts — 65s ledgers, 15s groups, 20s
// stockItems, 12s stockGroups, 45s sales, 35s receipts with 4s cooldowns
// between) and reconcile with the real fetched/errors arrays once the
// response arrives.
//
// The "Portal auto-login" phase is hidden entirely unless the response's
// diagnostics confirm it actually fired. Previously we showed it in
// pending during the run and it would turn green on the optimistic
// cursor — a false positive when the portal path never ran. Now it only
// appears retrospectively, with its status set from the server
// diagnostics, so a green dot there always means the auto-login
// genuinely revived the RemoteApp session.

// Portal login now runs proactively at the top of tallyRequest() (see
// supabase/functions/tally/index.ts ensurePortalLogin), so its step is
// listed FIRST — before company discovery. Conditional: only shown when
// the server diagnostics confirm it actually fired on this invocation.
//
// Labels use plain business terms; the parenthetical shows the underlying
// Tally nomenclature for people who want the detail. "Sundry Debtors" is
// Tally's chart-of-accounts group for every customer who owes money, so
// "dealers" is the accurate business name; "invoices" / "payments" are
// the user-facing names for sales / receipt vouchers.
const STEPS = [
  { key: 'portal', label: 'Portal auto-login', etaMs: 4000, conditional: true },
  { key: 'discover', label: 'Discovering companies', etaMs: 5000 },
  { key: 'ledgers', label: 'Fetching dealers (Sundry Debtors ledgers)', etaMs: 65000 },
  { key: 'accountingGroups', label: 'Fetching accounting groups', etaMs: 15000 },
  { key: 'stockItems', label: 'Fetching stock items', etaMs: 20000 },
  { key: 'stockGroups', label: 'Fetching stock groups', etaMs: 12000 },
  { key: 'profitLoss', label: 'Fetching Profit & Loss', etaMs: 15000 },
  { key: 'balanceSheet', label: 'Fetching Balance Sheet', etaMs: 15000 },
  { key: 'trialBalance', label: 'Fetching Trial Balance', etaMs: 18000 },
  { key: 'salesVouchers', label: 'Fetching invoices (sales vouchers)', etaMs: 45000 },
  { key: 'receiptVouchers', label: 'Fetching receipts (receipt vouchers)', etaMs: 35000 },
  { key: 'paymentVouchers', label: 'Fetching payments (payment vouchers)', etaMs: 30000 },
  { key: 'journalVouchers', label: 'Fetching journal vouchers', etaMs: 25000 },
  { key: 'contraVouchers', label: 'Fetching contra entries', etaMs: 20000 },
  { key: 'persist', label: 'Persisting snapshot to cloud', etaMs: 4000 },
];

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

export default function SyncProgress({ active, result, progressCompany }) {
  // Wall-clock driver. While active=true we bump `elapsed` on a setInterval
  // so the optimistic step advances. When the response lands we stop the
  // timer but KEEP the final elapsed value — resetting it to 0 on !active
  // made the reconciled panel display "0s · 100%" which was misleading.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return; // keep prior elapsed value so the post-run header stays honest
    setElapsed(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(id);
  }, [active]);

  // Show the Portal step whenever the server reports diagnostic
  // information for it — either it actually fired (attempted=true) OR
  // it was deliberately skipped with a reason the user should see
  // (portalLoginSkippedReason). Previously the row was hidden unless the
  // login fired, which made "no portal creds configured" look like the
  // integration was silently working when it wasn't.
  const portalFired = result?.diagnostics?.portalLoginAttempted;
  const portalSkipped = Boolean(result?.diagnostics?.portalLoginSkippedReason);
  const steps = STEPS.filter(s => !s.conditional || portalFired || portalSkipped);

  // Recompute cumulative ETA from the steps we actually show so the
  // optimistic cursor is accurate when the Portal step is included.
  let cumulative = 0;
  const stepInfo = steps.map((s) => {
    const start = cumulative;
    cumulative += s.etaMs;
    return { ...s, start, end: cumulative };
  });
  const totalEta = cumulative;

  const errKeys = new Set(Object.keys(result?.collectionErrors || result?.errors || {}));
  const fetchedKeys = new Set(result?.fetched || []);

  // "Total failure" = the edge call itself bailed (timeout, abort,
  // supabase-js rejected) before producing any per-collection data. In
  // that case `fetched` and `collectionErrors` are both empty but we
  // still have `result.success === false` and a top-level error message.
  // We mark every remaining step as 'error' so the panel reflects reality
  // instead of leaving everything grey under a red progress bar.
  const totalFailure = Boolean(
    result && !active && !result.success
      && fetchedKeys.size === 0 && errKeys.size === 0
  );

  const statusFor = (step) => {
    if (result && !active) {
      if (step.key === 'portal') {
        if (result.diagnostics?.portalLoginOk) return 'done';
        if (result.diagnostics?.portalLoginAttempted && !result.diagnostics?.portalLoginOk) return 'error';
        // Skipped by configuration → explicit error so the user sees
        // that this is why the XML calls are failing.
        if (result.diagnostics?.portalLoginSkippedReason) return 'error';
        return 'pending';
      }
      if (step.key === 'discover') {
        if (result.discoveryError) return 'error';
        if (result.discoveredCompanies?.length) return 'done';
        return totalFailure ? 'error' : 'pending';
      }
      if (step.key === 'persist') {
        if (result.success) return 'done';
        return totalFailure ? 'error' : 'pending';
      }
      if (errKeys.has(step.key)) return 'error';
      if (fetchedKeys.has(step.key)) return 'done';
      return totalFailure ? 'error' : 'pending';
    }
    // Active run — optimistic cursor.
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
      if (result.diagnostics?.portalLoginSkippedReason) return result.diagnostics.portalLoginSkippedReason;
      return null;
    }
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

  const displayedElapsed = elapsed;
  const pct = Math.min(100, Math.round(((result && !active) ? 100 : (elapsed / totalEta * 100))));
  const isFailure = result && !active && !result.success && !result.connected;

  // When the parent is mid-loop across companies, show which one is
  // currently syncing ("2 of 4 — UNITED AGENCIES LLP"). We clear
  // progressCompany.total to 1 when there's only a single company to
  // sync, which collapses the header back to the default wording.
  const companyHeader = (() => {
    if (!active) return null;
    if (!progressCompany || progressCompany.total <= 1 || !progressCompany.name) return null;
    return (
      <p className="text-[11px] text-indigo-200/80 mt-1">
        Company {progressCompany.index} of {progressCompany.total} — <span className="text-indigo-100">{progressCompany.name}</span>
      </p>
    );
  })();

  // After the whole loop finishes, show a per-company breakdown so the
  // user can see "Company A: 4 dealers, 12 invoices · Company B: …".
  const perCompany = result?.perCompany;
  const perCompanyRows = (!active && perCompany && Object.keys(perCompany).length > 1) ? (
    <div className="mt-3 pt-3 border-t border-gray-700/40 space-y-1">
      <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Per company</p>
      {Object.entries(perCompany).map(([name, c]) => (
        <div key={name} className="flex items-center justify-between text-[11px]">
          <span className={c.success ? 'text-gray-200' : 'text-red-300'}>
            {c.success ? '✓' : '✗'} {name}
          </span>
          <span className="text-gray-500">
            {c.success
              ? `${c.ledgers || 0} dealers · ${c.salesVouchers || 0} invoices · ${c.receiptVouchers || 0} payments · ${c.stockItems || 0} items`
              : (c.error || 'failed').slice(0, 80)}
          </span>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="glass-card p-4 border border-indigo-500/30 bg-indigo-500/5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
            Syncing from Tally
          </p>
          {companyHeader}
        </div>
        <p className="text-[11px] text-gray-500">
          {Math.round(displayedElapsed / 1000)}s · {pct}%
        </p>
      </div>
      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all duration-300 ${isFailure ? 'bg-red-500' : 'bg-indigo-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-1.5">
        {stepInfo.map((s) => (
          <StepRow key={s.key} step={s} status={statusFor(s)} detail={detailFor(s)} />
        ))}
      </div>
      {perCompanyRows}
      {result?.fellBackToSnapshot && !active && (
        <p className="text-[11px] text-cyan-300/80 mt-3">
          Live sync did not return fresh data — loaded the most recent cloud snapshot instead.
        </p>
      )}
    </div>
  );
}
