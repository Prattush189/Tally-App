import { useState, useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, Wifi, WifiOff, Database, Users, Package, Layers, Eye, Cloud } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import SyncProgress from '../common/SyncProgress';
import { fmt } from '../../utils/format';
import { canonicalCompanyName, extractFyFromName } from '../../utils/companyName';
import { useAuth } from '../../context/AuthContext';
import { useTallyData } from '../../context/TallyDataContext';
import {
  TALLY_BACKEND, tallyAvailable,
  getStatus, getDataSummary, getCompanies, deleteSnapshot, loadFromSnapshot,
  syncAllPhases,
} from '../../lib/tallyClient';

const TALLY_CONFIG_KEY = 'b2b_tally_config';

// Legacy configs stored a single "host" field like "103.76.213.243:9007" or
// a full URL. The UI now exposes ip + port separately (the IP is the portal
// login URL you open in a browser; port is the XML endpoint Tally listens on),
// so on read we split the old value and on write we compose it back.
function parseHost(raw) {
  if (!raw) return { ip: '', port: '' };
  const trimmed = String(raw).trim();
  // Pull host[:port] out of a URL if they pasted one.
  const urlMatch = trimmed.match(/^https?:\/\/([^/]+)/i);
  const hostPart = urlMatch ? urlMatch[1] : trimmed;
  const idx = hostPart.lastIndexOf(':');
  if (idx === -1) return { ip: hostPart, port: '' };
  return { ip: hostPart.slice(0, idx), port: hostPart.slice(idx + 1) };
}

function composeHost(ip, port) {
  if (!ip) return '';
  return port ? `${ip.trim()}:${port.trim()}` : ip.trim();
}

function loadTallyConfig() {
  try {
    const raw = localStorage.getItem(TALLY_CONFIG_KEY);
    if (!raw) return { ip: '', port: '' };
    const parsed = JSON.parse(raw);
    const split = (parsed.ip || parsed.port)
      ? { ip: parsed.ip || '', port: parsed.port || '' }
      : parseHost(parsed.host);
    return { ip: split.ip, port: split.port };
  } catch {
    return { ip: '', port: '' };
  }
}

export default function TallySync() {
  const { isDemo, user } = useAuth();
  const { customers: liveCustomers, totals: liveTotals, diagnostics: liveDiagnostics, syncedAt: liveSyncedAt, source: liveSource, refresh: refreshTallyData } = useTallyData();
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [syncing, setSyncing] = useState(false);
  // Wall-clock marker captured when Sync starts. If the tab is backgrounded
  // mid-sync the client-side invoke promise may be throttled or dropped, but
  // the edge function completes server-side and writes tally_snapshots. When
  // the tab returns we compare the cloud snapshot's updatedAt against this
  // marker — if the snapshot is newer, we know the sync landed even though
  // our fetch never saw the response, and we can unstick the UI.
  const [syncStartedAt, setSyncStartedAt] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [config, setConfig] = useState(loadTallyConfig);
  // `snapshotInfo` reflects the latest cloud snapshot's metadata; sourced
  // straight from the shared Tally data context so the TallySync card
  // agrees with every other dashboard about what's currently loaded.
  const snapshotInfo = liveSyncedAt ? { updatedAt: liveSyncedAt, source: liveSource } : null;
  const [activeCompany, setActiveCompany] = useState('');

  const available = tallyAvailable();

  // Persist both the new split fields AND a composed `host` string, so any
  // legacy code path that still reads config.host keeps working until it's
  // migrated.
  useEffect(() => {
    try {
      localStorage.setItem(TALLY_CONFIG_KEY, JSON.stringify({
        ...config,
        host: composeHost(config.ip, config.port),
      }));
    } catch { /* quota / private mode */ }
  }, [config]);

  const tallyHost = composeHost(config.ip, config.port);
  const portalUrl = config.ip ? `http://${config.ip.trim()}/` : '';

  useEffect(() => {
    if (!available) return;
    getStatus().then(setStatus).catch(() => {});
    getDataSummary().then(setSummary).catch(() => {});
    refreshCompanies();
  }, [available]);

  async function refreshCompanies() {
    try {
      const r = await getCompanies();
      setActiveCompany(r?.activeCompany || '');
    } catch { /* non-fatal */ }
  }

  // Every call to the backend consumes the composed host string rather than
  // the split fields — keeps the tallyClient / edge function contract stable
  // (one "host" field, same as before) while the UI shows them split.
  const backendCreds = () => ({
    host: tallyHost,
    // No auth — TallyPrime's XML server on this deployment doesn't
    // require Basic Auth, and we removed the portal auto-login
    // scaffolding once it became clear it was a no-op every run.
    // `company` is passed per-iteration via syncAllPhases({ company });
    // setting it here would collapse multi-company runs onto the
    // first entry.
  });

  // Multi-company sync progress. Each Sync press iterates through every
  // company Tally detected on the first round-trip — each company gets
  // its own edge-function call with its own 150s budget so we don't have
  // to fit 4 companies into one 140s window. The progress header flips
  // between companies as they complete; the data that powers the
  // dashboards comes from whichever company is currently active in the
  // top-bar picker.
  const [progressCompany, setProgressCompany] = useState({ name: '', index: 0, total: 1 });

  // Live per-phase state, driven by syncAllPhases' onPhase callback. Lets
  // SyncProgress show the true current phase + per-phase status/counts
  // instead of the previous timer-based optimistic cursor. Shape:
  //   { currentKey, keyStatus: { [key]: 'running' | 'done' | 'error' },
  //     keyCounts: { [key]: number }, keyErrors: { [key]: string },
  //     cooldownEndsAt: number | null, attempt: { key, n, of } | null }
  const [livePhase, setLivePhase] = useState(null);

  // Run the per-phase chained sync for a single company. Replaces the old
  // monolithic sync-full call. Each phase hits sync-collection in its own
  // Edge Function isolate (fresh 150 s / 150 MB budget), separated by a
  // 12 s cooldown so Tally's RemoteApp tunnel can recover between hits.
  // A connection-reset error on one phase (e.g. Tally's c0000005 memory
  // access violation momentarily dropping the XML socket) no longer
  // cascades into skipping every subsequent phase — each phase is tried
  // independently with its own retry.
  //
  // After all phases finish we load the persisted snapshot from the cloud
  // so the transformer can populate customers / totals / diagnostics.
  // Phase results themselves only carry counts + per-phase errors; the
  // actual data tree lives in tally_snapshots and is pulled by
  // loadFromSnapshot once the walk is done.
  const syncOneCompany = async (companyName) => {
    const phaseEvents = (evt) => {
      setLivePhase((prev) => {
        // Carry forward EVERY field from prev so per-event handlers
        // only have to set what they're updating. The earlier shape
        // explicitly listed each field, which silently dropped any
        // not in the list (loadCompanyStatus / loadCompanyName /
        // loadCompanyError) on the next event — that's why the
        // "Opening company in Tally" row stayed pending even after
        // the load actually fired and succeeded.
        const next = {
          ...(prev || {}),
          keyStatus: { ...(prev?.keyStatus || {}) },
          keyCounts: { ...(prev?.keyCounts || {}) },
          keyErrors: { ...(prev?.keyErrors || {}) },
          discoveryStatus: prev?.discoveryStatus || 'pending',
        };
        if (evt.type === 'discover-start') {
          next.discoveryStatus = 'running';
        } else if (evt.type === 'discover-done') {
          next.discoveryStatus = evt.error ? 'error' : 'done';
        } else if (evt.type === 'load-company-start') {
          next.loadCompanyStatus = 'running';
          next.loadCompanyName = evt.company || null;
        } else if (evt.type === 'load-company-done') {
          next.loadCompanyStatus = evt.error || evt.result?.error ? 'error' : 'done';
          next.loadCompanyError = evt.error || evt.result?.error || null;
        } else if (evt.type === 'phase-start') {
          next.currentKey = evt.key;
          next.keyStatus[evt.key] = 'running';
          next.cooldownEndsAt = null;
          next.attempt = null;
        } else if (evt.type === 'phase-attempt') {
          if (evt.attempt > 1) next.attempt = { key: evt.key, n: evt.attempt, of: evt.maxAttempts };
          else next.attempt = null;
        } else if (evt.type === 'phase-done') {
          next.keyStatus[evt.key] = evt.error ? 'error' : 'done';
          if (evt.count != null) next.keyCounts[evt.key] = evt.count;
          if (evt.error) next.keyErrors[evt.key] = evt.error;
          next.attempt = null;
        } else if (evt.type === 'cooldown-start') {
          next.cooldownEndsAt = Date.now() + (evt.ms || 0);
        } else if (evt.type === 'cooldown-done') {
          next.cooldownEndsAt = null;
        } else if (evt.type === 'done') {
          next.currentKey = null;
          next.cooldownEndsAt = null;
        }
        return next;
      });
    };

    let r;
    try {
      // Bound the voucher queries by the FY encoded in the company name
      // suffix ("(from 1-Apr-26)" → 2026-04-01 through 2027-03-31).
      // Each Tally "company" is one FY's data file by convention; without
      // an explicit period filter Tally returns whatever range happens
      // to be loaded in the GUI which on a fresh open of an FY company
      // can OOM Sales Register's parse tree. The FY suffix gives us a
      // safe, deterministic period that strictly matches what's in
      // that data file.
      const fy = extractFyFromName(companyName);
      r = await syncAllPhases({
        config: backendCreds(),
        // companyName is the literal Tally name (with the suffix); used
        // verbatim in SVCURRENTCOMPANY. If empty, syncAllPhases falls
        // back to whichever company Tally has open.
        company: companyName || undefined,
        // canonicalCompany is the storage key on tally_snapshots — every
        // FY of the same business writes to the same canonical row so
        // the dashboards stitch them together transparently.
        canonicalCompany: canonicalCompanyName(companyName) || undefined,
        // FY tag becomes a sub-key suffix for voucher data (e.g.
        // salesRegister_2526) so multiple FYs for the same canonical
        // business can coexist under one snapshot row without
        // overwriting each other.
        fyTag: fy ? fy.label : null,
        fromDate: fy?.fromDate,
        toDate: fy?.toDate,
        onPhase: phaseEvents,
      });
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), mode: 'client-chained' };
    }

    // Trust per-phase persistence. Each sync-collection invocation
    // already wrote its data to tally_snapshots via the
    // merge_tally_snapshot_key RPC, so the cloud row is correct the
    // moment the phase chain finishes. We deliberately DO NOT
    // re-download the full data tree here — for a tenant with 3000+
    // ledgers + 800+ stock items the tree is 10-30 MB of JSONB and
    // pulling it again just to compute dealersStored locally was
    // adding 30-120 s of "Syncing..." spinner with the rest of the
    // UI already settled. Counts come straight from the phase
    // results; the customer/totals transform now happens lazily
    // on the dashboards via TallyDataContext when they mount.
    r.ledgers = r.counts?.ledgers ?? 0;
    r.stockItems = r.counts?.stockItems ?? 0;
    r.stockGroups = r.counts?.stockGroups ?? 0;
    r.profitLoss = r.counts?.profitLoss ?? 0;
    r.balanceSheet = r.counts?.balanceSheet ?? 0;
    r.trialBalance = r.counts?.trialBalance ?? 0;
    r.salesVouchers = r.counts?.salesRegister ?? 0;
    r.purchaseVouchers = r.counts?.purchaseRegister ?? 0;
    r.receiptVouchers = r.counts?.receiptRegister ?? 0;
    r.dealersStored = r.counts?.ledgers ?? 0;
    return r;
  };

  // One button, one flow. handleSync orchestrates everything across all
  // companies Tally exposes:
  //   1. First edge-function call returns the discoveredCompanies list
  //      (the edge function always auto-detects at the top of sync-full).
  //   2. For every company beyond the first, fire another sync-full.
  //      Serial — shared-host Tally tunnels don't like parallel XML.
  //   3. Transform + save the customer list for the ACTIVE company (what
  //      the top-bar CompanySwitcher points at) so the dashboards hydrate
  //      with that one. The server still persists per-company snapshots,
  //      so switching company in the top bar just reads the other rows.
  //   4. If nothing came back with dealers, fall back to the cloud
  //      snapshot as before.
  const handleSync = async () => {
    if (isDemo) return;
    setSyncing(true);
    setSyncStartedAt(Date.now());
    setSyncResult(null);
    setProgressCompany({ name: '', index: 0, total: 1 });
    // Hard guarantee: no matter what throws inside the body —
    // ReferenceError from a stale variable name, a transient
    // network blip, anything — the spinner state always gets
    // cleared at the end. Last regression here left `syncing=true`
    // stuck indefinitely because an unrelated ReferenceError
    // jumped past setSyncing(false), so wrap the whole flow.
    try {
    setLivePhase({
      currentKey: null,
      keyStatus: {},
      keyCounts: {},
      keyErrors: {},
      cooldownEndsAt: null,
      attempt: null,
      discoveryStatus: 'pending',
      loadCompanyStatus: 'pending',
      loadCompanyName: null,
      loadCompanyError: null,
    });

    // First pass: no explicit company. syncAllPhases runs the
    // List-of-Companies probe + the TDL Company collection probe
    // and resolves whichever company Tally has loaded in the GUI.
    // The company name discovered by that first pass drives any
    // subsequent passes — TallyPrime supports multiple companies
    // loaded at once, so we sync each detected company separately.
    setProgressCompany({ name: '', index: 1, total: 1 });
    const first = await syncOneCompany('');
    const discoveredCompanies = first?.discoveredCompanies || [];
    const firstCompany = first?.activeCompany || discoveredCompanies[0] || '';
    const companiesToSync = discoveredCompanies.length
      ? discoveredCompanies
      : (firstCompany ? [firstCompany] : ['']);

    const results = new Map();
    results.set(firstCompany || '(default)', first);

    // Subsequent passes: every other company Tally has loaded.
    for (let i = 0; i < companiesToSync.length; i++) {
      const name = companiesToSync[i];
      if (!name || name === firstCompany) continue;
      setProgressCompany({ name, index: results.size + 1, total: companiesToSync.length });
      setLivePhase({
        currentKey: null,
        keyStatus: {},
        keyCounts: {},
        keyErrors: {},
        cooldownEndsAt: null,
        attempt: null,
        discoveryStatus: 'pending',
        loadCompanyStatus: 'pending',
        loadCompanyName: null,
        loadCompanyError: null,
      });
      const r = await syncOneCompany(name);
      results.set(name, r);
    }

    // Pick the "primary" company for the result panel's headline counts —
    // the one the user has pinned, otherwise the first we synced. The
    // edge function has already written every company's data to
    // tally_snapshots on the server, so dashboards refresh from there
    // below; no per-browser localStorage write needed.
    const preferred = activeCompany || firstCompany || companiesToSync[0];
    const primary = results.get(preferred) || results.get(firstCompany) || results.values().next().value;

    // Aggregated result used by the sync-result panel + progress reconcile.
    // Counts are summed across all companies; collectionErrors show which
    // companies failed where. `raw` mirrors the primary company's raw
    // bundle so the transformer-based diagnostics still make sense.
    const agg = {
      success: Boolean(primary?.success),
      error: primary?.error,
      partial: Array.from(results.values()).some(r => !r?.success),
      mode: primary?.mode || 'full',
      tallyNotRunning: primary?.tallyNotRunning,
      ledgers: 0, salesVouchers: 0, purchaseVouchers: 0, receiptVouchers: 0, stockItems: 0, stockGroups: 0,
      counts: {},
      collectionErrors: {},
      dealersStored: primary?.dealersStored || 0,
      diagnostics: primary?.diagnostics,
      discoveredCompanies: companiesToSync,
      activeCompany: firstCompany,
      raw: primary?.raw,
      perCompany: Object.fromEntries(Array.from(results.entries()).map(([name, res]) => ([name, {
        success: Boolean(res?.success),
        ledgers: res?.ledgers || 0,
        salesVouchers: res?.salesVouchers || 0,
        purchaseVouchers: res?.purchaseVouchers || 0,
        receiptVouchers: res?.receiptVouchers || 0,
        stockItems: res?.stockItems || 0,
        stockGroups: res?.stockGroups || 0,
        error: res?.error || null,
      }]))),
      fetched: primary?.fetched || [],
    };
    for (const res of results.values()) {
      agg.ledgers += res?.ledgers || 0;
      agg.salesVouchers += res?.salesVouchers || 0;
      agg.purchaseVouchers += res?.purchaseVouchers || 0;
      agg.receiptVouchers += res?.receiptVouchers || 0;
      agg.stockItems += res?.stockItems || 0;
      agg.stockGroups += res?.stockGroups || 0;
      // Sum every per-phase count across companies so SyncProgress can
      // display "salesRegister: 1234 records" etc. on the post-completion
      // panel. Without this, agg.counts stayed empty and only the legacy
      // hardcoded fields above ever showed in the summary line.
      if (res?.counts) {
        for (const [k, v] of Object.entries(res.counts)) {
          agg.counts[k] = (agg.counts[k] || 0) + (Number(v) || 0);
        }
      }
      if (res?.collectionErrors) {
        for (const [k, v] of Object.entries(res.collectionErrors)) {
          if (v && !agg.collectionErrors[k]) agg.collectionErrors[k] = v;
        }
      }
    }

    // Tally-side "no company really loaded" heuristic. When Tally's
    // XML server is up but no company is actually open (e.g. the
    // Select Company screen is showing on top of a c0000005 crash
    // dialog), every collection still answers — but with synthetic
    // defaults: 1 root "Primary" group, 1 built-in ledger, 1 stub
    // stock entry, and zero P&L / BS / TB rows. The counts all land
    // as ~0-1 even though the phase-level sync reports "connected".
    // We detect that pattern and surface a clear "Tally isn't
    // serving real data" note so this stops looking like our bug.
    // Tally-side "no company really loaded" heuristic. When Tally's
    // XML server is up but no company is actually open, every
    // collection still answers — but with synthetic defaults: 1 root
    // "Primary" group, 1 built-in ledger, 1 stub stock entry, and
    // zero P&L / BS / TB rows. We detect that pattern PER COMPANY so
    // multi-company runs can call out exactly which ones the user
    // forgot to open in Tally instead of a single generic warning.
    // Day Book counts are intentionally excluded — we skip that phase
    // entirely while the voucher c0000005 crash is unresolved.
    const looksPlaceholder = (counts) =>
      Number(counts?.ledgers || 0) <= 1
      && Number(counts?.stockItems || 0) <= 1
      && Number(counts?.stockGroups || 0) <= 1;
    const notLoadedCompanies = Object.entries(agg.perCompany || {})
      .filter(([name, c]) => name !== '(default)' && c.success && looksPlaceholder(c))
      .map(([name]) => name);
    const loadedCompanies = Object.entries(agg.perCompany || {})
      .filter(([name, c]) => name !== '(default)' && c.success && !looksPlaceholder(c))
      .map(([name]) => name);
    if (notLoadedCompanies.length) {
      agg.notLoadedCompanies = notLoadedCompanies;
      agg.loadedCompanies = loadedCompanies;
    }
    // Keep the legacy banner for the all-companies-empty case (the
    // user hasn't loaded ANY company in Tally), but skip it when at
    // least one company in the run worked — the per-company list
    // below is the precise signal in that case.
    const lookSuspect = agg.ledgers <= 1 && agg.stockItems <= 1 && agg.stockGroups <= 1
      && !Object.keys(agg.collectionErrors).length;
    if (lookSuspect && !loadedCompanies.length && (agg.success || agg.fetched.length)) {
      agg.tallyNotServingRealData = true;
      agg.note = 'Tally answered every phase but returned only placeholder counts (1 ledger / 1 group). No company appears to be loaded in TallyPrime — open one (or several) in Tally\'s Select Company screen, then sync again.';
    }

    setSyncResult(agg);

    // Fire-and-forget: each dashboard already polls the snapshot
    // on mount, so a stuck refresh here is recoverable. Errors are
    // swallowed because they don't change anything the user cares
    // about — the cloud row is the canonical source either way.
    refreshTallyData().catch(() => {});
    getStatus().then((s) => { if (s) setStatus(s); }).catch(() => {});
    getDataSummary().then((sm) => { if (sm) setSummary(sm); }).catch(() => {});
    refreshCompanies();
    } catch (err) {
      // Surface as a sync result so the UI shows the actual error
      // instead of just leaving a stale spinner. The finally block
      // clears the syncing state regardless.
      setSyncResult((prev) => prev || {
        success: false,
        error: `Sync orchestration failed: ${err instanceof Error ? err.message : String(err)}`,
        partial: true,
        mode: 'client-chained',
        collectionErrors: { handleSync: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      // Always clear the spinner, no matter how the body exited —
      // success, partial-success, or thrown ReferenceError.
      setProgressCompany({ name: '', index: 0, total: 1 });
      setLivePhase(null);
      setSyncing(false);
      setSyncStartedAt(null);
    }
  };

  // Multi-PC + background-tab recovery: if a sync started on this browser,
  // but the response got throttled (hidden-tab fetch suspend) or a *different*
  // PC ran the sync, we still want THIS tab to pick up the result. Gating on
  // visibility-return, not window-focus (too aggressive — flickers on every
  // alt-tab). Refs (not state) keep in-flight metadata visible without
  // re-subscribing the listener every toggle.
  //
  // The recovery path is designed for the old single-call sync-full model
  // where the edge function owned the whole run and the browser was just
  // awaiting one fetch. Under client-chained sync the browser itself is
  // driving phase-by-phase, and `livePhase` acts as a heartbeat — as long
  // as livePhase.currentKey or a per-phase 'running' status is moving, the
  // run is healthy even if the tab was briefly hidden. We only fire
  // recovery when the chain has been silent longer than MIN_HIDDEN_MS
  // without a phase transition, which is a real "something got wedged"
  // signal rather than "user alt-tabbed while background cooldowns got
  // throttled by Chrome".
  const MIN_HIDDEN_MS = 75_000;
  const syncingRef = useRef(false);
  const syncStartedAtRef = useRef(null);
  const hiddenSinceRef = useRef(null);
  const livePhaseActivityAtRef = useRef(null);
  useEffect(() => { syncingRef.current = syncing; }, [syncing]);
  useEffect(() => { syncStartedAtRef.current = syncStartedAt; }, [syncStartedAt]);
  // Track "last time we saw a phase transition". Any change to livePhase
  // (new currentKey, new keyStatus entry, cooldown toggle) counts as a
  // heartbeat. If the tab comes back and this is recent, we know the
  // chain is still marching and recovery shouldn't fire.
  useEffect(() => {
    if (livePhase) livePhaseActivityAtRef.current = Date.now();
  }, [livePhase]);

  useEffect(() => {
    if (!available || isDemo) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        return;
      }
      const since = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      const longEnough = since && Date.now() - since > MIN_HIDDEN_MS;
      // Under client-chained sync, THIS tab is the only thing driving
      // the phase chain — there is no backgrounded edge-function call
      // whose response we might have missed. Chrome throttles
      // background setTimeouts but doesn't kill them, so the chain
      // keeps marching while the tab is hidden and will call
      // setSyncing(false) itself when it finishes. Firing the cloud-
      // recovery path on top of that was the regression: the banner
      // ("Sync did not return data while this tab was hidden") showed
      // up even though the chain was still live in the same tab.
      // Skip recovery whenever a client-chained sync is in flight;
      // it only makes sense for the legacy single-call sync-full path.
      const clientChainedActive = syncingRef.current && livePhaseActivityAtRef.current != null;
      if (longEnough && !clientChainedActive) {
        // Re-pull from cloud AND wait so we can populate real record counts
        // in the recovery banner instead of the misleading "No records
        // returned" placeholder. Every dashboard reads via the context, so
        // one refresh propagates.
        const wasSyncing = syncingRef.current;
        // Pull both the context (to drive hasLiveData) AND the raw snapshot
        // metadata in parallel. The raw snapshot is what tells us WHICH
        // collection errored with what message — without that the recovery
        // banner can only say "something went wrong" and the user has no
        // way to diagnose. loadFromSnapshot returns counts + collectionErrors
        // from the server-side row, so we can feed real per-collection
        // status into the existing SyncProgress panel.
        Promise.allSettled([refreshTallyData(), loadFromSnapshot()]).then(([_, snapRes]) => {
          if (!wasSyncing) return;
          const snap = snapRes?.status === 'fulfilled' ? snapRes.value : null;
          const snapCounts = snap?.raw ? (snap || {}) : {};
          const snapErrors = snap?.collectionErrors || {};
          setSyncing(false);
          setSyncStartedAt(null);
          setSyncResult((r) => {
            if (r) return r;
            const hasData = Boolean(liveCustomers.length)
              || Number(snapCounts.ledgers) > 0
              || Number(snapCounts.salesVouchers) > 0
              || Number(snapCounts.receiptVouchers) > 0
              || Number(snapCounts.stockItems) > 0;
            // Per-collection errors came back from the cloud row: at least
            // ONE job got far enough to write its error into the snapshot.
            // That means the edge function ran, just didn't produce data —
            // the user can see which tunnel/auth/compute error hit which
            // collection in the existing progress panel.
            const hasServerErrors = Object.keys(snapErrors).length > 0;
            if (hasData) {
              return {
                success: true,
                mode: 'full',
                note: 'Sync finished in the background while this tab was hidden — data loaded from the cloud snapshot.',
                dealersStored: liveCustomers.length,
                ledgers: snapCounts.ledgers,
                salesVouchers: snapCounts.salesVouchers,
                receiptVouchers: snapCounts.receiptVouchers,
                paymentVouchers: snapCounts.paymentVouchers,
                stockItems: snapCounts.stockItems,
                stockGroups: snapCounts.stockGroups,
                collectionErrors: snapErrors,
                fetched: Object.keys(snapCounts).filter((k) => typeof snapCounts[k] === 'number'),
              };
            }
            if (hasServerErrors) {
              const firstErr = Object.values(snapErrors)[0];
              return {
                success: false,
                mode: 'full',
                partial: true,
                error: `Sync finished server-side but every collection failed. First error: ${String(firstErr).slice(0, 200)}. See per-collection details below.`,
                collectionErrors: snapErrors,
                fetched: [],
              };
            }
            return {
              success: false,
              mode: 'full',
              partial: true,
              error: 'Sync did not return data while this tab was hidden, and the cloud snapshot is still empty. Usually means one of: (1) the edge-function deploy has not propagated yet — check EDGE_BUILD_ID on a future success banner, (2) Tally/RemoteApp is not running on the configured :9007, or (3) the edge function hit its 150 s wall-clock budget. Press Sync again WITHOUT switching tabs so you can watch the live progress, and check Supabase Edge Function logs if it keeps failing.',
              collectionErrors: {},
            };
          });
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [available, isDemo, refreshTallyData, liveCustomers.length, liveTotals]);

  // "Clear" wipes the cloud snapshot for this tenant — that's where
  // dashboards read from. Local browser state is already reactive to the
  // context refresh that follows. Used when a bad sync leaves stale counts
  // in collection_meta and the TTL-based skipFresh optimisation keeps
  // honouring them.
  //
  // We keep the existing `syncResult` (if any) visible while the DELETE
  // round-trip runs, so the user doesn't lose the previous sync's
  // diagnostic panel just because they clicked Clear by mistake. Result
  // only clears once deleteSnapshot returns.
  const [clearing, setClearing] = useState(false);
  const handleClearLiveData = async () => {
    if (isDemo || clearing) return;
    setClearing(true);
    try {
      const r = await deleteSnapshot();
      if (r.success) {
        await refreshTallyData();
        setSyncResult({ success: true, cleared: true });
      } else {
        setSyncResult({
          success: false,
          error: `Failed to clear snapshot: ${r.error || 'unknown error (edge function may not be redeployed yet)'}`,
        });
      }
    } finally {
      setClearing(false);
    }
  };

  // Surface the cloud snapshot using the same shape the old code expected —
  // rest of the component reads `liveSnapshot.customers.length` etc.
  const liveSnapshot = !isDemo && liveCustomers.length
    ? { customers: liveCustomers, syncedAt: liveSyncedAt, source: liveSource }
    : null;

  // A populated cloud snapshot counts as "connected" — the banner's job is
  // to tell the user whether their dashboards actually have real data.
  const isConnected = Boolean(status?.connected) || Boolean(liveSnapshot);
  const lastSyncAt = status?.lastAttempt || liveSnapshot?.syncedAt;

  if (!available) {
    return (
      <div className="space-y-6">
        <SectionHeader icon={RefreshCw} title="Tally Prime 7.0 Integration" subtitle="Live connection to Tally XML Server — requires a backend" />
        <div className="glass-card p-6 border-l-4 border-amber-500">
          <div className="flex items-start gap-3">
            <AlertTriangle size={22} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Tally sync is not configured for this deployment.</p>
              <p className="text-xs text-gray-400">
                Tally's XML API can't be called directly from a browser. Wire up one of the backends below and redeploy:
              </p>
              <ul className="text-xs text-gray-300 list-disc list-inside space-y-1">
                <li><span className="font-semibold">Supabase</span> — deploy the <code className="text-indigo-300">tally</code> Edge Function and set <code className="text-indigo-300">VITE_SUPABASE_URL</code> + <code className="text-indigo-300">VITE_SUPABASE_ANON_KEY</code> as GitHub Actions variables.</li>
                <li><span className="font-semibold">Dedicated server</span> — run <code className="text-indigo-300">server/</code> (Railway, VPS, etc.) and set <code className="text-indigo-300">VITE_API_URL</code>.</li>
              </ul>
              <p className="text-xs text-gray-500">Dashboards keep working on mock data in the meantime.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader icon={RefreshCw} title="Tally Prime 7.0 Integration" subtitle={`Live connection via ${TALLY_BACKEND} backend — pulls real data for all analytics`} />

      {/* Connection Status Banner */}
      <div className={`glass-card p-5 border-l-4 ${isConnected ? 'border-emerald-500' : 'border-amber-500'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isConnected ? <Wifi size={20} className="text-emerald-400" /> : <WifiOff size={20} className="text-amber-400" />}
            <div>
              <p className="text-sm font-semibold text-white">
                {isConnected ? 'Connected to Tally Prime' : isDemo ? 'Demo Data' : 'Not Connected'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {isConnected
                  ? `Live data from Tally · Last sync: ${lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'N/A'}${liveSnapshot ? ` · ${liveSnapshot.customers.length} dealers cached` : ''}`
                  : isDemo
                    ? 'Pre-loaded sample data powers every dashboard on the demo account.'
                    : 'Configure your Tally XML endpoint below and click Sync Now to populate dashboards.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${isConnected ? 'bg-emerald-500/15 text-emerald-400' : isDemo ? 'bg-indigo-500/15 text-indigo-300' : 'bg-gray-700/40 text-gray-400'}`}>
              {isConnected ? 'LIVE' : isDemo ? 'DEMO' : 'AWAITING SYNC'}
            </span>
          </div>
        </div>
      </div>

      {isDemo && (
        <div className="glass-card p-4 border border-indigo-500/30 bg-indigo-500/5">
          <div className="flex items-start gap-3">
            <Eye size={18} className="text-indigo-300 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-white">View-only demo account</p>
              <p className="text-xs text-gray-400 mt-0.5">
                You can browse every page with pre-loaded sample data, but Test Connection and Sync are disabled. Create your own account to connect your live Tally server.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Actions */}
        <div className="space-y-4">
          <div className="glass-card p-6 space-y-5">
            <h3 className="text-lg font-semibold text-white">Tally Connection</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Tally IP / Hostname</label>
                  <input type="text" value={config.ip} disabled={isDemo || syncing} onChange={e => setConfig(c => ({ ...c, ip: e.target.value }))}
                    className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="103.76.213.243" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">XML Port</label>
                  <input type="text" value={config.port} disabled={isDemo || syncing} onChange={e => setConfig(c => ({ ...c, port: e.target.value.replace(/[^0-9]/g, '') }))}
                    className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="9007" />
                </div>
              </div>
              <p className="text-[11px] text-gray-500 -mt-2">
                IP is what you open to log in ({portalUrl ? (
                  <a href={portalUrl} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">{portalUrl}</a>
                ) : 'http://your-ip/'}). Port is where TallyPrime's XML server listens (usually <code className="text-gray-300">9007</code> for cloud, <code className="text-gray-300">9000</code> for desktop).
              </p>
              <div className="p-3 rounded-lg border text-[11px] bg-amber-500/10 border-amber-500/30 text-amber-200 space-y-1">
                <div className="font-semibold text-amber-300">⚠ Open a company in Tally before syncing</div>
                <p>
                  Per <a className="underline text-amber-200" href="https://help.tallysolutions.com/pre-requisites-for-integrations/" target="_blank" rel="noopener noreferrer">TallyPrime&apos;s integration prerequisites</a>: <i>&quot;at least one company must be loaded in Tally for third-party applications to work with it.&quot;</i> Whichever company you have open in Tally is the one we&apos;ll sync — its name, current period, and data are auto-detected on every run.
                </p>
              </div>
              <div className="p-3 rounded-lg border text-[11px] bg-red-500/10 border-red-500/30 text-red-200 space-y-1">
                <div className="font-semibold text-red-300">⚠ Day Book (vouchers) disabled — Tally crashes on this dataset</div>
                <p>
                  TallyPrime throws a <code className="text-red-200">c0000005 (Memory Access Violation)</code> exception every time we walk the voucher tree on this installation, on every company we&apos;ve tried. It&apos;s a Tally-side bug — confirmed against the slimmest possible XML shape and per-year chunked windows. Voucher fetch is disabled until Tally Solutions ships a patched build or the data files are restored from a clean backup.
                </p>
                <p>
                  Until then these dashboards <b>will stay empty</b>: Customer Health revenue (per-dealer ₹/month), Purchase Forecasting (historical demand), Toy Category Scores (margin / dealer adoption), Avg Price by Region. Master-data dashboards (Customers, Stock, P&amp;L, Balance Sheet, Trial Balance) sync normally.
                </p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Companies & range</p>
                <p className="text-sm text-white">
                  Auto-detected from whichever company is open in Tally.
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Master data uses Tally&apos;s current period; Day Book pulls every available year.
                </p>
                <p className="text-[11px] text-indigo-300/80 mt-1">
                  Use the top-bar company picker to choose which one&apos;s data the dashboards show.
                </p>
              </div>
              {status?.cacheAge != null && (
                <div className="bg-gray-900/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Cache</p>
                  <p className="text-sm text-gray-300">
                    Data is {status.cacheAge}s old (refreshes every {status.cacheTTL}s)
                  </p>
                </div>
              )}
            </div>

            <button onClick={handleSync} disabled={syncing || isDemo}
              title={isDemo ? 'Disabled for the demo account' : 'Sync from Tally. Auto-logs into the portal if needed and falls back to the last cloud snapshot on failure.'}
              className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${syncing ? 'bg-indigo-500/50 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-500'} text-white`}>
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync'}
            </button>

            {snapshotInfo?.updatedAt && (
              <div className="text-xs text-cyan-300/80 flex items-center gap-2">
                <Cloud size={12} /> Snapshot from {new Date(snapshotInfo.updatedAt).toLocaleString()}
                {snapshotInfo.source ? ` · via ${snapshotInfo.source}` : ''}
              </div>
            )}

            {/* Stepwise progress panel. Driven by an optimistic timer while
                the request is in flight; reconciles with the real per-
                collection results + portal-auto-login diagnostics once the
                response lands. Unmounts when the next Sync starts. */}
            {(syncing || syncResult) && (
              <SyncProgress
                kind="sync"
                active={syncing}
                result={syncResult}
                progressCompany={progressCompany}
                livePhase={livePhase}
              />
            )}

            {/* Tally-side "no company open" banner. Distinct from
                tallyNotRunning (which fires when every query timed out)
                — this one fires when queries ALL succeeded but came
                back with Tally's built-in defaults, meaning the XML
                server is alive but no real company is loaded. Almost
                always the c0000005 Memory Access Violation dialog is
                blocking the UI. */}
            {/* Per-company "not loaded in Tally" callout. Fires when
                some companies in the textarea got real data but
                others came back with placeholder counts — almost
                always because the user opened one company in Tally
                but not the others. Tally's XML interface only sees
                companies the GUI has loaded. */}
            {syncResult?.notLoadedCompanies?.length && !syncing && (
              <div className="p-3 rounded-lg border text-sm bg-amber-500/10 border-amber-500/30 text-amber-300 space-y-2">
                <div className="font-semibold">⚠ Some companies aren&apos;t loaded in Tally</div>
                <p className="text-xs text-amber-200/90">
                  TallyPrime returned real data for {syncResult.loadedCompanies?.length || 0} compan{syncResult.loadedCompanies?.length === 1 ? 'y' : 'ies'} and only placeholder counts for {syncResult.notLoadedCompanies.length}. Tally&apos;s XML server only exposes companies the desktop GUI has actually opened — our Load Company action XML can&apos;t open them programmatically on this build.
                </p>
                {syncResult.loadedCompanies?.length > 0 && (
                  <div className="text-xs text-emerald-300/90">
                    <span className="font-semibold">✓ Loaded (got real data):</span>
                    <ul className="ml-4 mt-0.5 list-disc">
                      {syncResult.loadedCompanies.map((n) => (<li key={n}><code className="text-emerald-200/90">{n}</code></li>))}
                    </ul>
                  </div>
                )}
                <div className="text-xs text-red-300/90">
                  <span className="font-semibold">✗ Not loaded (got placeholders):</span>
                  <ul className="ml-4 mt-0.5 list-disc">
                    {syncResult.notLoadedCompanies.map((n) => (<li key={n}><code className="text-red-200/90">{n}</code></li>))}
                  </ul>
                </div>
                <p className="text-xs text-amber-200/90">
                  Fix: in TallyPrime, open each of the &quot;not loaded&quot; companies (Gateway of Tally → F1: Help → Select Company, repeat for each). TallyPrime supports multiple companies loaded at once. Then re-run Sync — every loaded company will pull real data.
                </p>
              </div>
            )}

            {syncResult?.tallyNotServingRealData && (
              <div className="p-3 rounded-lg border text-sm bg-amber-500/10 border-amber-500/30 text-amber-300 space-y-1">
                <div className="font-semibold">⚠ Tally is up but no company is actually open</div>
                <div className="text-xs text-amber-200/90">
                  Every sync phase answered, but with only placeholder counts ({syncResult.ledgers || 0} ledger / {syncResult.stockGroups || 0} group / 0 vouchers). That pattern means TallyPrime's XML server is responding with its built-in defaults — there's no loaded company to actually read from.
                </div>
                <div className="text-xs text-amber-200/90 pt-1">Most likely cause right now:</div>
                <ul className="text-xs text-amber-200/80 list-disc list-inside pt-0.5 space-y-0.5">
                  <li>A <b>&quot;Software Exception c0000005 (Memory Access Violation)&quot;</b> dialog is blocking the Tally UI — on the Tally machine, click <b>OK</b> to dismiss it, then open a company.</li>
                  <li>Try a <b>different company</b> from the list — the crash is usually specific to one corrupted data file. E.g. if <code>GIRNAR KIDS PLAY LLP (from 1-Apr-25)</code> crashes, try the <code>(from 1-Apr-26)</code> one or <code>UNITED AGENCIES DISTRIBUTORS LLP</code>.</li>
                  <li>If <b>every</b> company crashes with c0000005, the Tally data files are corrupt — restore from the last good backup, or contact Tally Solutions support for a repair.</li>
                </ul>
                <div className="text-xs text-amber-200/80 pt-1">
                  You can also paste the exact company name into the <b>Company name</b> field above to bypass Tally's auto-detect (useful if the crashing company is the one Tally keeps defaulting to).
                </div>
              </div>
            )}

            {/* Load Company diagnostics panel. Surfaces the raw Tally
                response from each Load Company XML form attempt so we
                can tell whether the action genuinely opened the company
                or whether Tally just acknowledged the request and kept
                the Select Company screen up. Visible only after a sync
                completes (we don't want to render it during the live
                run — the cooldown banner / per-phase rows already cover
                in-flight diagnostics). */}
            {syncResult?.loadCompany && !syncing && (
              <div className="p-3 rounded-lg border text-xs bg-gray-900/40 border-gray-700/50 text-gray-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-200">Load Company response</span>
                  <span className={syncResult.loadCompany.connected ? 'text-emerald-400' : 'text-red-400'}>
                    {syncResult.loadCompany.connected ? 'accepted' : 'rejected'}
                  </span>
                </div>
                {syncResult.loadCompany.company && (
                  <div className="text-[11px] text-gray-400">
                    Sent for company: <span className="font-mono text-gray-200">{syncResult.loadCompany.company}</span>
                  </div>
                )}
                {syncResult.loadCompany.error && (
                  <div className="text-[11px] text-red-300/90">{syncResult.loadCompany.error}</div>
                )}
                {Array.isArray(syncResult.loadCompany.attempts) && syncResult.loadCompany.attempts.map((a, i) => (
                  <details key={i} className="text-[11px] text-gray-400">
                    <summary className="cursor-pointer">
                      Form {i + 1} ({a.form}) — {a.ok ? '✓ accepted' : `✗ ${a.error ? a.error.slice(0, 60) : 'rejected'}`}
                    </summary>
                    {a.sample && (
                      <pre className="mt-1 text-[10px] text-gray-400 font-mono break-all whitespace-pre-wrap bg-gray-900/60 rounded p-2 max-h-48 overflow-auto">
                        {a.sample}
                      </pre>
                    )}
                  </details>
                ))}
              </div>
            )}

            {/* Sync Result */}
            {syncResult?.tallyNotRunning && (
              <div className="p-3 rounded-lg border text-sm bg-amber-500/10 border-amber-500/30 text-amber-300 space-y-1">
                <div className="font-semibold">⚠ Every live query timed out this run</div>
                <div className="text-xs text-amber-200/90">
                  Tally's lightweight "test" endpoint works, but the heavier collection queries aren't completing. Most common causes:
                </div>
                <ul className="text-xs text-amber-200/80 list-disc list-inside pt-1 space-y-0.5">
                  <li>Someone's actively using the TallyPrime GUI inside the RemoteApp (opening a report, entering a voucher) — Tally serialises everything, so our XML calls block until they're idle.</li>
                  <li>The cloud tunnel's idle timer is cutting off queries before Tally starts responding.</li>
                  <li>No TallyPrime RemoteApp session is open right now.</li>
                </ul>
                <div className="text-xs text-amber-200/80 pt-1">
                  Fix: wait a few seconds for Tally to idle, then click <b>Sync Now</b> again. Or use the <b>Chrome extension</b> (<code>extension/README.md</code>) — it runs inside the portal tab with the live RemoteApp session and is much more reliable for this tunnel.
                </div>
              </div>
            )}
            {syncResult && (
              <div className={`p-3 rounded-lg border text-sm ${syncResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                {syncResult.success ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <span>{syncResult.cleared ? '✓ Cloud snapshot cleared' : '✓ Synced successfully from Tally'}</span>
                      {syncResult.edgeBuildId && (
                        <span className="text-[10px] text-emerald-300/60 font-mono" title="Edge function build that handled this sync">
                          edge: {syncResult.edgeBuildId}
                        </span>
                      )}
                    </div>
                    {!syncResult.cleared && (
                      <div className="text-xs text-emerald-300/80">
                        {[
                          syncResult.customers != null && `${syncResult.customers} dealers`,
                          syncResult.skus != null && `${syncResult.skus} SKUs`,
                          syncResult.categories != null && `${syncResult.categories} categories`,
                          syncResult.ledgers ? `${syncResult.ledgers} ledgers` : null,
                          syncResult.stockItems ? `${syncResult.stockItems} stock items` : null,
                          syncResult.stockGroups ? `${syncResult.stockGroups} stock groups` : null,
                          syncResult.salesVouchers ? `${syncResult.salesVouchers} sales` : null,
                          syncResult.purchaseVouchers ? `${syncResult.purchaseVouchers} purchases` : null,
                          syncResult.receiptVouchers ? `${syncResult.receiptVouchers} receipts` : null,
                          syncResult.counts?.billsOutstanding ? `${syncResult.counts.billsOutstanding} bills outstanding` : null,
                          syncResult.profitLoss ? 'P&L' : null,
                          syncResult.balanceSheet ? 'Balance Sheet' : null,
                          syncResult.trialBalance ? 'Trial Balance' : null,
                          syncResult.dealersStored ? `${syncResult.dealersStored} dealers → dashboards` : null,
                        ].filter(Boolean).join(' · ') || 'No records returned'}
                      </div>
                    )}
                    {syncResult.mode === 'lean' && (
                      <div className="text-xs text-amber-300/80 pt-1">
                        Full sync unavailable{syncResult.fullError ? ` (${syncResult.fullError})` : ''} — fell back to ledger-only. Sales history / SKU penetration will stay at zero until the full sync succeeds.
                      </div>
                    )}
                    {syncResult.discoveredCompanies && (
                      <div className="text-xs pt-1">
                        {syncResult.discoveredCompanies.length > 0 ? (
                          <div className="text-cyan-300/80">
                            {syncResult.usedCachedCompanies
                              ? <>Using cached company list ({syncResult.discoveredCompanies.length}): {syncResult.discoveredCompanies.join(', ')}. Active: <b>{syncResult.activeCompany || '(none)'}</b>. TallyPrime didn't report any loaded companies — pick one on the "Select Company" screen for a fresh detection.</>
                              : <>Detected {syncResult.discoveredCompanies.length} company{syncResult.discoveredCompanies.length === 1 ? '' : 'ies'}: {syncResult.discoveredCompanies.join(', ')}. Active: <b>{syncResult.activeCompany || '(none)'}</b>.</>}
                          </div>
                        ) : syncResult.discoveryError ? (
                          <div className="text-amber-300/80">
                            Company auto-detect failed: {syncResult.discoveryError}
                          </div>
                        ) : syncResult.discoveryRawSample ? (
                          <div className="text-amber-300/80 space-y-1">
                            <div>Tally responded to List of Companies but the parser found 0 companies. Raw sample:</div>
                            <pre className="text-[10px] text-gray-400 font-mono break-all whitespace-pre-wrap bg-gray-900/40 rounded p-2 max-h-32 overflow-auto">
                              {syncResult.discoveryRawSample}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {syncResult.collectionErrors && Object.keys(syncResult.collectionErrors).length > 0 && (
                      <div className="text-xs text-amber-300/80 pt-1 space-y-0.5">
                        {Object.entries(syncResult.collectionErrors).map(([col, msg]) => (
                          <div key={col}>
                            <span className="font-semibold">{col}</span>: {String(msg)}
                          </div>
                        ))}
                      </div>
                    )}
                    {syncResult.note && !syncResult.cleared && (
                      <div className="text-xs text-amber-300/80 pt-1">{syncResult.note}</div>
                    )}
                    {syncResult.transformError && (
                      <div className="text-xs text-red-300/80 pt-1">Transform warning: {syncResult.transformError}</div>
                    )}
                    {/* Dashboard hydration status — driven by the live
                        TallyDataContext (which runs the transformer on
                        the cloud snapshot) rather than transformer
                        output computed during sync. The post-sync
                        refreshTallyData() fires-and-forgets, so this
                        block reflects whatever the dashboards actually
                        see, even if the transformer is still running
                        when the sync result panel first renders. */}
                    {syncResult.success && !syncing && (
                      <div className="text-xs pt-1 space-y-1">
                        {liveCustomers.length > 0 ? (
                          <div className="text-emerald-300/90">
                            ✓ {liveCustomers.length} dealers loaded into dashboards
                            {liveDiagnostics?.filterMatched
                              ? ` — matched as Sundry Debtors (out of ${liveDiagnostics?.coverage?.ledgers || syncResult.ledgers || '?'} total ledgers).`
                              : liveDiagnostics?.usedFallback
                                ? ` — fell back to ledgers with non-zero balances (no group named "Sundry Debtors" matched).`
                                : '.'}
                          </div>
                        ) : liveDiagnostics ? (
                          <div className="text-amber-300/90 space-y-1">
                            <div>
                              Dashboards loaded the snapshot but found 0 customers — none of the {liveDiagnostics?.coverage?.ledgers || syncResult.ledgers || '?'} ledgers matched as Sundry Debtors.
                            </div>
                            {liveDiagnostics.parentsSeen?.length > 0 && (
                              <div className="text-[11px] text-gray-400">
                                Parent groups in feed: {liveDiagnostics.parentsSeen.join(', ') || '(none)'}
                              </div>
                            )}
                            {liveDiagnostics.sampleGroupHops?.length > 0 && (
                              <div className="text-[11px] text-gray-400">
                                Sample chains: {liveDiagnostics.sampleGroupHops.map((c, i) => <div key={i} className="font-mono">{c}</div>)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-gray-400/80">
                            Dashboards are loading the fresh snapshot — counts will appear here once the transformer finishes.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div>✗ Sync failed: {syncResult.error || 'see progress panel above for per-step details.'}</div>
                    {syncResult.collectionErrors && Object.keys(syncResult.collectionErrors).length > 0 && (
                      <div className="text-xs text-red-200/80 pt-1 space-y-0.5">
                        {Object.entries(syncResult.collectionErrors).map(([col, msg]) => (
                          <div key={col}>
                            <span className="font-semibold">{col}</span>: {String(msg)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {liveSnapshot && !isDemo && (
              <div className="flex items-center justify-between text-xs text-gray-400 mt-3 pt-3 border-t border-gray-700/40">
                <span>
                  <span className="text-gray-300">{liveSnapshot.customers.length}</span> dealers cached from {new Date(liveSnapshot.syncedAt).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={handleClearLiveData}
                  disabled={clearing}
                  className="text-red-300/80 hover:text-red-200 underline underline-offset-2 disabled:opacity-40 disabled:cursor-wait"
                >
                  {clearing ? 'Clearing…' : 'Clear'}
                </button>
              </div>
            )}
          </div>

          {/* Data Summary */}
          {summary && (
            <div className="glass-card p-6">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Current Data Summary</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900/50 rounded-lg p-3 flex items-center gap-3">
                  <Users size={18} className="text-indigo-400" />
                  <div>
                    <p className="text-lg font-bold text-white">{summary.customerCount}</p>
                    <p className="text-xs text-gray-500">Dealers</p>
                  </div>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-3 flex items-center gap-3">
                  <Package size={18} className="text-violet-400" />
                  <div>
                    <p className="text-lg font-bold text-white">{summary.skuCount}</p>
                    <p className="text-xs text-gray-500">SKUs</p>
                  </div>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-3 flex items-center gap-3">
                  <Layers size={18} className="text-blue-400" />
                  <div>
                    <p className="text-lg font-bold text-white">{summary.categoryCount}</p>
                    <p className="text-xs text-gray-500">Categories</p>
                  </div>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-3 flex items-center gap-3">
                  <Database size={18} className="text-emerald-400" />
                  <div>
                    <p className="text-lg font-bold text-white">{summary.source?.toUpperCase()}</p>
                    <p className="text-xs text-gray-500">Source</p>
                  </div>
                </div>
              </div>

              {summary.topCustomers?.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-500 mb-2">TOP DEALERS BY REVENUE</p>
                  <div className="space-y-1.5">
                    {summary.topCustomers.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1">
                        <span className="text-gray-300">{c.name}</span>
                        <span className="text-indigo-400 font-medium">{fmt(c.monthlyAvg)}/mo</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Architecture + Data types */}
        <div className="space-y-4">
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4">How It Works</h3>
            <div className="space-y-4">
              {[
                { step: '1', title: 'Tally Prime 7.0 (Cloud)', desc: 'Enter your Tally Host IP and credentials to connect', color: 'bg-emerald-500/20 text-emerald-400', active: true },
                { step: '2', title: 'XML API Requests', desc: 'Dashboard sends TDL XML queries to fetch ledgers, vouchers, stock items', color: 'bg-blue-500/20 text-blue-400', active: true },
                { step: '3', title: 'Data Transform', desc: 'Raw Tally data → structured customers, invoices, payments, inventory', color: 'bg-indigo-500/20 text-indigo-400', active: true },
                { step: '4', title: 'Analytics Engine', desc: 'Computes churn, health, forecasting, suggestions from real data', color: 'bg-violet-500/20 text-violet-400', active: true },
              ].map(s => (
                <div key={s.step} className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg ${s.color} flex items-center justify-center text-sm font-bold flex-shrink-0`}>{s.step}</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{s.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.desc}</p>
                  </div>
                  {s.active && <CheckCircle size={14} className="text-emerald-500/60 mt-0.5" />}
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Data Pulled from Tally</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                'Sundry Debtors (Dealers)',
                'Sales Vouchers',
                'Receipt Vouchers',
                'Stock Items & Groups',
                'Party GSTIN & Address',
                'Outstanding Balances',
                'Credit Limits & Terms',
                'Invoice Line Items',
              ].map(item => (
                <div key={item} className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle size={14} className="text-emerald-500/70 flex-shrink-0" />{item}
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-4 border border-amber-500/20">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-gray-400">
                <p className="font-semibold text-amber-400 mb-1">Environment Variables</p>
                <p>Configure in your <code className="text-gray-300">.env</code> file:</p>
                <pre className="mt-2 bg-gray-900/60 rounded p-2 text-gray-300 overflow-x-auto">
{`TALLY_HOST=your-tally-ip
# TALLY_COMPANY optional — leave blank to use the company you
# pick in the top-bar switcher (auto-detected on every sync).`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
