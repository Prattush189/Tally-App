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
  // Day Book is conditional — disabled by default while the customer's
  // Tally data files trigger a c0000005 crash on voucher queries. The
  // row is shown only when livePhase / result diagnostics indicate Day
  // Book actually ran, so a sync that intentionally skips it doesn't
  // get a phantom "pending" row that never resolves.
  { key: 'dayBook', label: 'Fetching Day Book (sales, receipts, payments, journals, contra)', etaMs: 75000, conditional: true },
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

export default function SyncProgress({ active, result, progressCompany, livePhase }) {
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

  // Ticking "now" so the cooldown countdown below rerenders each second
  // instead of only on phase transitions. Cheap — one setState/s while
  // active, nothing when idle.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  // Client-driven per-phase progress wins over the optimistic timer when
  // present. `livePhase` comes from syncAllPhases' onPhase callback so we
  // can show "ledgers: running · accountingGroups: 142 records · dayBook_2023: connection reset by peer (retry 2/2)"
  // in real time rather than guessing from a stopwatch. Falls back to the
  // old timer-based cursor when livePhase is null (e.g. background sync
  // recovered from a different tab where we don't have live events).
  const hasLiveDriver = Boolean(livePhase);

  // Show the Portal step whenever the server reports diagnostic
  // information for it — either it actually fired (attempted=true) OR
  // it was deliberately skipped with a reason the user should see
  // (portalLoginSkippedReason). Previously the row was hidden unless the
  // login fired, which made "no portal creds configured" look like the
  // integration was silently working when it wasn't.
  const portalFired = result?.diagnostics?.portalLoginAttempted;
  const portalSkipped = Boolean(result?.diagnostics?.portalLoginSkippedReason);
  // Day Book row visibility: only show it when day-book activity is
  // actually present — either livePhase recorded a dayBook* phase or
  // the finished result has dayBook counts/errors. Sync runs that
  // skip Day Book (current default while the c0000005 voucher crash
  // is live) drop the row entirely instead of leaving it pending.
  const dayBookActive = hasLiveDriver
    && Object.keys(livePhase.keyStatus || {}).some((k) => k.startsWith('dayBook'));
  const dayBookFinished = !!result && (
    Object.keys(result.collectionErrors || {}).some((k) => k.startsWith('dayBook'))
    || Number(result.dayBook) > 0
    || (result.fetched || []).some((k) => k.startsWith('dayBook'))
  );
  const showStep = (s) => {
    if (!s.conditional) return true;
    if (s.key === 'portal') return portalFired || portalSkipped;
    if (s.key === 'dayBook') return dayBookActive || dayBookFinished;
    return false;
  };
  const steps = STEPS.filter(showStep);

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
    // Active run, live-driver path — real per-phase status from
    // syncAllPhases. Each step reflects what the client-chained sync is
    // actually doing right now instead of a stopwatch guess.
    if (hasLiveDriver) {
      if (step.key === 'discover') {
        const s = livePhase.discoveryStatus;
        if (s === 'done') return 'done';
        if (s === 'error') return 'error';
        if (s === 'running') return 'running';
        return 'pending';
      }
      if (step.key === 'persist') {
        // Persist is implicit per-phase (each sync-collection writes its
        // own row server-side), so mirror the last phase's state.
        const allDone = STEPS.every((s) =>
          s.conditional || s.key === 'persist' || s.key === 'portal'
            || livePhase.keyStatus[s.key] === 'done'
            || livePhase.keyStatus[s.key] === 'error');
        if (allDone) return 'done';
        return 'pending';
      }
      if (step.key === 'dayBook') {
        // dayBook rolls up every dayBook_YYYY sub-phase. Running if any
        // year is currently running, error if any year errored, done if
        // every year finished cleanly, pending otherwise.
        const dayBookKeys = Object.keys(livePhase.keyStatus).filter((k) => k.startsWith('dayBook'));
        if (!dayBookKeys.length) {
          if (livePhase.currentKey && livePhase.currentKey.startsWith('dayBook')) return 'running';
          return 'pending';
        }
        if (dayBookKeys.some((k) => livePhase.keyStatus[k] === 'running')) return 'running';
        if (dayBookKeys.some((k) => livePhase.keyStatus[k] === 'error')) {
          const allFinished = dayBookKeys.every((k) => livePhase.keyStatus[k] !== 'running');
          return allFinished ? 'error' : 'running';
        }
        if (dayBookKeys.every((k) => livePhase.keyStatus[k] === 'done')) return 'done';
        return 'pending';
      }
      const s = livePhase.keyStatus[step.key];
      if (s) return s;
      return 'pending';
    }
    // Active run — optimistic cursor (used when livePhase is not provided,
    // e.g. background-recovery path with no streamed events).
    if (elapsed >= step.end) return 'done';
    if (elapsed >= step.start) return 'running';
    return 'pending';
  };

  const detailFor = (step) => {
    // Live-driver path: surface real-time details during an active sync
    // so the user sees exactly what's happening (or what failed) without
    // waiting for the whole run to finish. This is the main
    // observability win of the per-phase architecture — each phase's
    // error lands on its own row with its own message instead of being
    // collapsed into "earlier Day Book chunk failed".
    if (active && hasLiveDriver) {
      if (step.key === 'discover') {
        if (livePhase.discoveryStatus === 'running') return 'probing companies…';
        if (livePhase.discoveryStatus === 'error') return 'failed';
        return null;
      }
      if (step.key === 'dayBook') {
        const entries = Object.entries(livePhase.keyStatus).filter(([k]) => k.startsWith('dayBook'));
        const running = entries.find(([, s]) => s === 'running');
        const errored = entries.filter(([, s]) => s === 'error');
        if (running) {
          const year = running[0].replace(/^dayBook_?/, '') || 'current window';
          const attempt = livePhase.attempt?.key === running[0]
            ? ` (retry ${livePhase.attempt.n}/${livePhase.attempt.of})` : '';
          return `year ${year}${attempt}`;
        }
        if (errored.length) {
          const [k, ] = errored[0];
          const msg = livePhase.keyErrors[k];
          return `${errored.length} year${errored.length === 1 ? '' : 's'} failed — ${String(msg || '').slice(0, 50)}`;
        }
        const total = Object.keys(livePhase.keyCounts).filter((k) => k.startsWith('dayBook')).reduce((s, k) => s + (livePhase.keyCounts[k] || 0), 0);
        if (total > 0) return `${total} vouchers`;
        return null;
      }
      // Non-dayBook live detail: show the per-phase count if it landed,
      // the per-phase error if it failed, or "attempt N/M" while a retry
      // is mid-flight so the user understands why the step is still
      // spinning after 30+ seconds.
      const s = livePhase.keyStatus[step.key];
      if (s === 'running') {
        if (livePhase.attempt?.key === step.key) return `retry ${livePhase.attempt.n}/${livePhase.attempt.of}`;
        return null;
      }
      if (s === 'error') {
        const msg = livePhase.keyErrors[step.key];
        return msg ? String(msg).slice(0, 80) : 'failed';
      }
      if (s === 'done') {
        const count = livePhase.keyCounts[step.key];
        if (count != null) return `${count} records`;
      }
      return null;
    }
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
      ledgers: result.ledgers,
      salesVouchers: result.salesVouchers,
      receiptVouchers: result.receiptVouchers,
      paymentVouchers: result.paymentVouchers,
      journalVouchers: result.journalVouchers,
      contraVouchers: result.contraVouchers,
      dayBook: result.dayBook,
      stockItems: result.stockItems,
      stockGroups: result.stockGroups,
      profitLoss: result.profitLoss,
      balanceSheet: result.balanceSheet,
      trialBalance: result.trialBalance,
    };
    if (countMap[step.key] != null) return `${countMap[step.key]} records`;
    if (errKeys.has(step.key)) {
      const msg = (result.collectionErrors || result.errors || {})[step.key];
      return msg ? String(msg).slice(0, 60) : 'failed';
    }
    return null;
  };

  const displayedElapsed = elapsed;
  // When the live phase driver is present we compute the progress bar
  // from real step completion rather than a stopwatch — otherwise a
  // long retry or cooldown made the bar race past real progress.
  const livePct = (() => {
    if (!active || !hasLiveDriver) return null;
    const countable = stepInfo.filter((s) => s.key !== 'persist' && s.key !== 'portal');
    if (!countable.length) return 0;
    const doneCount = countable.reduce((n, s) => n + (statusFor(s) === 'done' ? 1 : statusFor(s) === 'running' ? 0.5 : 0), 0);
    return Math.round((doneCount / countable.length) * 100);
  })();
  const pct = Math.min(100, Math.round(
    (result && !active) ? 100
      : livePct != null ? livePct
        : (elapsed / totalEta * 100)
  ));
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

  // Cooldown banner — visible while syncAllPhases is waiting between
  // phases so the user understands why the bar is idle for 12 s. Without
  // this the UI looked frozen.
  const cooldownBanner = (() => {
    if (!active || !hasLiveDriver) return null;
    const ends = livePhase.cooldownEndsAt;
    if (!ends) return null;
    const remaining = Math.max(0, ends - now);
    if (remaining <= 0) return null;
    return (
      <p className="text-[11px] text-amber-300/80 mt-3">
        Pausing {Math.ceil(remaining / 1000)} s before the next phase — lets Tally's RemoteApp tunnel recover between calls.
      </p>
    );
  })();

  // Live error log: during an active sync, surface every per-phase error
  // immediately under the step list. This is the whole reason we split
  // sync into separate edge invocations — each phase's failure is its
  // own line with its own message, instead of being hidden behind a
  // single "earlier Day Book chunk failed" cascade.
  const liveErrorLog = (() => {
    if (!active || !hasLiveDriver) return null;
    const entries = Object.entries(livePhase.keyErrors || {});
    if (!entries.length) return null;
    return (
      <div className="mt-3 pt-3 border-t border-red-500/20 space-y-1">
        <p className="text-[11px] text-red-400 uppercase tracking-wider mb-1">Errors so far</p>
        {entries.map(([k, msg]) => (
          <div key={k} className="text-[11px] text-red-300/90">
            <span className="font-mono text-red-400/80">{k}</span>
            <span className="text-red-300/70"> — {String(msg).slice(0, 200)}</span>
          </div>
        ))}
      </div>
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
      {cooldownBanner}
      {liveErrorLog}
      {perCompanyRows}
      {result?.fellBackToSnapshot && !active && (
        <p className="text-[11px] text-cyan-300/80 mt-3">
          Live sync did not return fresh data — loaded the most recent cloud snapshot instead.
        </p>
      )}
    </div>
  );
}
