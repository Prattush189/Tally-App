// Tally client — routes Tally calls to the configured backend.
// Priority: Supabase Edge Function ("tally") > Express REST backend > unavailable.

import api, { HAS_BACKEND } from '../utils/api';
import { HAS_SUPABASE, supabase } from '../utils/supabase';

export const TALLY_BACKEND =
  HAS_SUPABASE ? 'supabase' :
  HAS_BACKEND ? 'express' :
  'none';

export function tallyAvailable() {
  return TALLY_BACKEND !== 'none';
}

async function readErrorBody(error) {
  // supabase-js puts the Response on error.context when a function returns non-2xx.
  // We try to parse it as JSON to surface the real error message.
  const ctx = error?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      try {
        const text = await ctx.text();
        if (text) return text;
      } catch { /* ignore */ }
    }
  }
  return error?.message || 'Tally function failed';
}

async function supabaseInvoke(action, config = {}) {
  const { data, error } = await supabase.functions.invoke('tally', {
    body: { action, ...config },
  });
  if (error) {
    throw new Error(await readErrorBody(error));
  }
  return data;
}

// Dedicated portal-login probe. Hits hb.exe cp with just the portal
// credentials — useful for debugging when the XML endpoint is down but
// you want to verify the portal session can be revived.
export async function testPortalLogin(config = {}) {
  if (TALLY_BACKEND !== 'supabase') {
    throw new Error('Portal login test requires the Supabase backend.');
  }
  const data = await supabaseInvoke('portal-login', config);
  return {
    connected: Boolean(data?.connected),
    status: data?.status,
    error: data?.error,
    bodySample: data?.bodySample,
    portalBase: data?.portalBase,
    diagnostics: data?.diagnostics,
  };
}

export async function testConnection(config = {}) {
  if (TALLY_BACKEND === 'supabase') {
    const data = await supabaseInvoke('test', config);
    return {
      connected: Boolean(data?.connected),
      response: data?.data,
      error: data?.error,
      diagnostics: data?.diagnostics || null,
    };
  }
  if (TALLY_BACKEND === 'express') {
    const r = await api.post('/tally/test', config);
    return r.data;
  }
  throw new Error('Tally is not available on this deployment. Configure Supabase (VITE_SUPABASE_URL) or a dedicated backend (VITE_API_URL).');
}

export async function syncFromTally(config = {}) {
  if (TALLY_BACKEND === 'supabase') {
    // Manual "Sync Now" presses should always pull fresh data — skipFresh=true
    // is the scheduled-cron optimization and is surprising when a user has
    // clicked a button and expects new numbers. Caller can override by
    // passing skipFresh: true in config.
    const body = { skipFresh: false, ...config };
    // Try the full pull first — one call returns ledgers + sales + receipts +
    // stock items + stock groups. If the Edge Function itself fails (timeout,
    // network, etc.) fall back to the lean ledger-only sync so dashboards
    // still get a signal. Per-collection failures come back inside `errors`
    // on a successful response; we surface them without blocking.
    try {
      const data = await supabaseInvoke('sync-full', body);
      const counts = data?.counts || {};
      const bundle = data?.data || {};
      const errors = data?.errors || {};
      // Cache discovered companies in localStorage as a fallback for the
      // top-bar switcher: if tally_companies migration hasn't been applied,
      // the get-companies action returns empty, but this cache lets the
      // switcher still populate. Sync response is the source of truth
      // after every run.
      if (Array.isArray(data?.discoveredCompanies) && data.discoveredCompanies.length) {
        try {
          localStorage.setItem('b2b_tally_companies_cache', JSON.stringify({
            companies: data.discoveredCompanies,
            activeCompany: data.activeCompany || data.discoveredCompanies[0],
            at: Date.now(),
          }));
        } catch { /* quota / private mode */ }
      }
      // Detect the "Tally isn't running right now" pattern: every collection
      // we actually tried to fetch this run aborted (no one had an active
      // TallyPrime RemoteApp session so :9007 didn't route anywhere). We
      // flag it so the UI can render an actionable banner instead of a wall
      // of "signal has been aborted" messages.
      const fetched = data?.fetched || [];
      const abortedAll = fetched.length > 0
        && fetched.every((key) => /aborted|connection closed|network error/i.test(String(errors[key] || '')));
      const success = Boolean(data?.connected);
      // Edge function doesn't always set a top-level `error` when sync-full
      // only partially fails — all collections might have their own entries
      // in `errors` while the aggregate field stays null. Synthesize one so
      // the UI never ends up rendering "Sync failed: undefined".
      let resolvedError = data?.error || null;
      if (!success && !resolvedError) {
        if (abortedAll) {
          resolvedError = 'Every live query timed out — the Tally RemoteApp session is probably not active on :9007.';
        } else if (data?.discoveryError) {
          resolvedError = `Could not reach Tally: ${data.discoveryError}`;
        } else {
          const firstErr = Object.entries(errors).find(([, v]) => v)?.[1];
          if (firstErr) {
            resolvedError = `Sync failed: ${firstErr}${Object.keys(errors).length > 1 ? ` (+${Object.keys(errors).length - 1} more)` : ''}`;
          } else {
            resolvedError = 'Sync did not return any data. Check that Tally is running and the credentials are correct.';
          }
        }
      }
      return {
        success,
        error: resolvedError,
        partial: false,
        mode: 'full',
        tallyNotRunning: abortedAll,
        ledgers: counts.ledgers || 0,
        salesVouchers: counts.salesVouchers || 0,
        receiptVouchers: counts.receiptVouchers || 0,
        paymentVouchers: counts.paymentVouchers || 0,
        journalVouchers: counts.journalVouchers || 0,
        contraVouchers: counts.contraVouchers || 0,
        dayBook: counts.dayBook || 0,
        stockItems: counts.stockItems || 0,
        stockGroups: counts.stockGroups || 0,
        profitLoss: counts.profitLoss || 0,
        balanceSheet: counts.balanceSheet || 0,
        trialBalance: counts.trialBalance || 0,
        edgeBuildId: data?.edgeBuildId || null,
        collectionErrors: errors,
        raw: bundle,
        discoveredCompanies: data?.discoveredCompanies || [],
        activeCompany: data?.activeCompany,
        discoveryError: data?.discoveryError,
        discoveryRawSample: data?.discoveryRawSample,
        fetched: data?.fetched || [],
        diagnostics: data?.diagnostics || null,
      };
    } catch (fullErr) {
      // sync-full itself threw (client/network level — supabase-js couldn't
      // reach the edge function, or the edge function returned a non-2xx).
      // Don't silently fall back to the lean 'sync' action: it usually fails
      // the same way and the fallback error ("The signal has been aborted")
      // was confusing the user with no per-step context. Instead we return
      // a single well-formed error object so handleSync's snapshot-fallback
      // path kicks in cleanly.
      const raw = fullErr instanceof Error ? fullErr.message : String(fullErr);
      const aborted = /aborted|network error|fetch failed|timeout/i.test(raw);
      const error = aborted
        ? 'Sync request timed out before the edge function could finish. Usually means the Tally RemoteApp session on :9007 is not active, or the portal auto-login took too long. Check the Tally / Portal credentials and try again.'
        : `Edge function call failed: ${raw}`;
      return {
        success: false,
        error,
        partial: true,
        mode: 'full',
        fullError: raw,
        collectionErrors: {},
        tallyNotRunning: aborted,
      };
    }
  }
  if (TALLY_BACKEND === 'express') {
    const r = await api.post('/tally/sync', config);
    return r.data;
  }
  throw new Error('Tally is not available on this deployment.');
}

// Company discovery only — the edge function probes Tally's "List of
// Companies" report, persists the result to tally_companies, and
// resolves the active_company. No collection fetches happen here, so
// it always returns quickly (~2-5 s). This is the entry point for the
// client-driven per-phase sync: fire sync-discover, then chain a
// sync-collection call per phase with a cooldown in between (see
// syncAllPhases).
export async function syncDiscover(config = {}) {
  if (TALLY_BACKEND !== 'supabase') {
    throw new Error('sync-discover requires the Supabase backend.');
  }
  const data = await supabaseInvoke('sync-discover', config);
  if (Array.isArray(data?.discoveredCompanies) && data.discoveredCompanies.length) {
    try {
      localStorage.setItem('b2b_tally_companies_cache', JSON.stringify({
        companies: data.discoveredCompanies,
        activeCompany: data.activeCompany || data.discoveredCompanies[0],
        at: Date.now(),
      }));
    } catch { /* quota / private mode */ }
  }
  return {
    connected: Boolean(data?.connected),
    activeCompany: data?.activeCompany || '',
    discoveredCompanies: data?.discoveredCompanies || [],
    discoveryError: data?.discoveryError || null,
    discoveryRawSample: data?.discoveryRawSample || null,
    usedCachedCompanies: Boolean(data?.usedCachedCompanies),
    diagnostics: data?.diagnostics || null,
    edgeBuildId: data?.edgeBuildId || null,
  };
}

// Fetch + persist ONE named collection via the edge function's
// sync-collection action. Runs in a fresh isolate with its own 150 s
// wall clock and 150 MB compute budget, which is how heavy Day Book
// years (dayBook_2023, dayBook_2024, ...) each get their own ceiling
// instead of competing for sync-full's single pool. Returns the raw
// response object so callers can inspect { count, error, edgeBuildId,
// diagnostics } per-year and decide whether to keep marching or
// surface a failure.
export async function syncCollection({ key, company, config = {} }) {
  if (TALLY_BACKEND !== 'supabase') {
    throw new Error('Per-collection sync requires the Supabase backend.');
  }
  if (!key) throw new Error('syncCollection: missing collection key.');
  if (!company) throw new Error('syncCollection: missing company name.');
  return supabaseInvoke('sync-collection', {
    key,
    company,
    allData: config.allData === true,
    fromDate: config.fromDate,
    toDate: config.toDate,
    host: config.host,
    username: config.username,
    password: config.password,
    portalUsername: config.portalUsername,
    portalPassword: config.portalPassword,
  });
}

// Ordered list of non-Day-Book phases every sync walks. Kept in one place so
// SyncProgress, handleSync and any scheduler stay in lockstep.
export const CORE_SYNC_PHASES = [
  'ledgers',
  'accountingGroups',
  'stockItems',
  'stockGroups',
  'profitLoss',
  'balanceSheet',
  'trialBalance',
];

// Build the per-year Day Book phase keys for the requested date window.
// Mirrors dayBookYearChunks() on the edge function. "All data" expands to
// the 5-year window the edge function uses; a sub-90-day window collapses
// to the single legacy "dayBook" key so the cached snapshot stays
// byte-compatible with older runs.
export function dayBookPhaseKeys({ allData, fromDate, toDate } = {}) {
  const today = new Date();
  if (allData) {
    const startYear = today.getFullYear() - 4;
    const endYear = today.getFullYear();
    const keys = [];
    for (let y = startYear; y <= endYear; y++) keys.push(`dayBook_${y}`);
    return keys;
  }
  const fY = fromDate && /^\d{4}/.test(fromDate) ? Number(fromDate.slice(0, 4)) : NaN;
  const tY = toDate && /^\d{4}/.test(toDate) ? Number(toDate.slice(0, 4)) : NaN;
  if (!Number.isFinite(fY) || !Number.isFinite(tY) || fY === tY) {
    // Sub-year window → single legacy chunk so cached snapshots stay compatible.
    return ['dayBook'];
  }
  const keys = [];
  for (let y = fY; y <= tY; y++) keys.push(`dayBook_${y}`);
  return keys;
}

// Sleep helper used for the inter-phase cooldown and retry backoff. Wrapped
// so callers can abort a long wait early if the user clicks "Stop" (not yet
// wired, but keeps the door open).
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return; }
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
    }
  });
}

// Classify an error message as "Tally tunnel / RemoteApp just dropped the
// socket" — those are the cases where waiting a bit and retrying often
// succeeds because Tally itself was momentarily unresponsive (including
// the c0000005 memory-access-violation crash pattern, which causes the
// XML service to briefly reject connections until the Tally UI's error
// dialog is dismissed).
function isRetriableSyncError(msg) {
  if (!msg) return false;
  const s = String(msg);
  return /reset by peer|ECONNRESET|connection reset|connection closed|connection refused|network error|fetch failed|signal has been aborted|aborted/i.test(s);
}

// Run a single phase with up to `maxAttempts` tries. Retries only on the
// retriable-class errors above, waits `retryWaitMs` between attempts so
// Tally's socket / RemoteApp session can recover (and, for the crash
// pattern, so the user has a moment to dismiss the "Internal Error" dialog
// before we hit Tally again). Non-retriable errors bubble out immediately
// — auth/4xx/5xx responses don't get better on retry.
async function runPhaseWithRetry({ key, company, config, maxAttempts, retryWaitMs, onAttempt }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      onAttempt?.({ key, attempt, maxAttempts });
      const res = await syncCollection({ key, company, config });
      if (res?.error && isRetriableSyncError(res.error) && attempt < maxAttempts) {
        lastErr = new Error(res.error);
        await wait(retryWaitMs);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRetriableSyncError(msg) || attempt >= maxAttempts) throw err;
      await wait(retryWaitMs);
    }
  }
  throw lastErr;
}

// Orchestrate a full multi-phase sync from the client. Replaces the
// monolithic sync-full call with a sequence of per-phase sync-collection
// invocations separated by `cooldownMs` (default 12 s). Each invocation
// gets its OWN Edge Function isolate with a fresh 150 s / 150 MB budget,
// so a phase that fails (e.g. a Tally memory-access-violation crash that
// resets the TCP connection for Day Book 2021) no longer cascades into
// skipping every remaining phase — each subsequent phase is tried
// independently with its own retry. The cooldown between calls also
// gives the Tally RemoteApp tunnel time to recover between hits, which is
// the root cause the user identified.
//
// `onPhase(evt)` is fired for lifecycle transitions so the UI can drive a
// real per-phase progress indicator instead of guessing with a timer.
// Events: { type: 'discover-start' | 'discover-done' | 'phase-start' |
// 'phase-done' | 'cooldown-start' | 'cooldown-done' | 'done', ...data }.
export async function syncAllPhases({
  config = {},
  company: explicitCompany,
  allData,
  fromDate,
  toDate,
  cooldownMs = 12000,
  maxAttemptsPerPhase = 2,
  retryWaitMs = 15000,
  signal,
  onPhase,
} = {}) {
  if (TALLY_BACKEND !== 'supabase') {
    throw new Error('Client-chained sync requires the Supabase backend.');
  }

  const phaseConfig = {
    ...config,
    allData: Boolean(allData),
    fromDate,
    toDate,
  };

  // 1) Company discovery — cheap probe, single invocation. When the
  //    caller already has a company name (manual override), discovery
  //    is optional: we still try it for the diagnostics / tally_companies
  //    cache, but a failure no longer blocks the run. Hosted-Tally
  //    setups frequently refuse the "List of Companies" report until a
  //    company is open in the UI, yet individual report queries work
  //    fine once SVCURRENTCOMPANY is explicit — that's the whole reason
  //    the manual override exists.
  onPhase?.({ type: 'discover-start' });
  let discovery = {
    connected: false,
    activeCompany: explicitCompany || '',
    discoveredCompanies: [],
    discoveryError: null,
    discoveryRawSample: null,
    usedCachedCompanies: false,
    diagnostics: null,
    edgeBuildId: null,
  };
  try {
    discovery = await syncDiscover({ ...config, company: explicitCompany });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    discovery.discoveryError = msg;
    if (!explicitCompany) {
      onPhase?.({ type: 'discover-done', error: msg });
      return {
        success: false,
        error: `Could not reach Tally: ${msg}`,
        partial: true,
        discoveredCompanies: [],
        activeCompany: '',
        diagnostics: null,
        collectionErrors: { discover: msg },
        phaseResults: {},
      };
    }
  }
  onPhase?.({ type: 'discover-done', discovery });

  const activeCompany = explicitCompany || discovery.activeCompany || discovery.discoveredCompanies[0] || '';
  if (!discovery.connected && !activeCompany) {
    return {
      success: false,
      error: discovery.discoveryError || 'Tally did not return any companies — is Tally running inside the RemoteApp session?',
      partial: true,
      discoveredCompanies: discovery.discoveredCompanies,
      activeCompany: '',
      diagnostics: discovery.diagnostics,
      discoveryError: discovery.discoveryError,
      discoveryRawSample: discovery.discoveryRawSample,
      collectionErrors: { discover: discovery.discoveryError || 'no companies' },
      phaseResults: {},
      edgeBuildId: discovery.edgeBuildId,
    };
  }

  // 2) Build the phase list. Core phases first, then per-year Day Book.
  const dayBookKeys = dayBookPhaseKeys({ allData, fromDate, toDate });
  const phaseKeys = [...CORE_SYNC_PHASES, ...dayBookKeys];

  // 3) Walk each phase serially with a cooldown between calls. A failure
  //    on one phase no longer blocks the next — we record the error and
  //    keep going, which is the whole point of moving off sync-full.
  const phaseResults = {};
  const collectionErrors = {};
  const counts = {};
  let lastDiagnostics = discovery.diagnostics;
  let anyConnected = false;
  for (let i = 0; i < phaseKeys.length; i++) {
    if (signal?.aborted) break;
    const key = phaseKeys[i];
    onPhase?.({ type: 'phase-start', key, index: i, total: phaseKeys.length });
    try {
      const res = await runPhaseWithRetry({
        key,
        company: activeCompany,
        config: phaseConfig,
        maxAttempts: maxAttemptsPerPhase,
        retryWaitMs,
        onAttempt: (evt) => onPhase?.({ type: 'phase-attempt', ...evt }),
      });
      phaseResults[key] = res;
      if (res?.diagnostics) lastDiagnostics = res.diagnostics;
      if (res?.connected) anyConnected = true;
      if (res?.error) collectionErrors[key] = res.error;
      counts[key] = res?.count ?? 0;
      onPhase?.({ type: 'phase-done', key, index: i, total: phaseKeys.length, count: counts[key], error: res?.error || null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      collectionErrors[key] = msg;
      counts[key] = 0;
      phaseResults[key] = { error: msg };
      onPhase?.({ type: 'phase-done', key, index: i, total: phaseKeys.length, count: 0, error: msg });
    }
    if (i < phaseKeys.length - 1) {
      onPhase?.({ type: 'cooldown-start', ms: cooldownMs });
      try { await wait(cooldownMs, signal); } catch { break; }
      onPhase?.({ type: 'cooldown-done' });
    }
  }

  // Roll up per-year Day Book counts into a single aggregate so the UI's
  // headline numbers match what sync-full used to surface.
  const dayBookTotal = dayBookKeys.reduce((sum, k) => sum + (counts[k] || 0), 0);
  counts.dayBook = (counts.dayBook || 0) + dayBookTotal;

  const success = anyConnected && Object.values(phaseResults).some((r) => r?.connected);
  onPhase?.({ type: 'done', success });
  return {
    success,
    error: success ? null : firstMeaningfulError(collectionErrors) || 'Sync completed with errors — see per-phase details.',
    partial: Object.keys(collectionErrors).length > 0,
    mode: 'client-chained',
    discoveredCompanies: discovery.discoveredCompanies,
    activeCompany,
    discoveryError: discovery.discoveryError,
    discoveryRawSample: discovery.discoveryRawSample,
    usedCachedCompanies: discovery.usedCachedCompanies,
    diagnostics: lastDiagnostics,
    edgeBuildId: discovery.edgeBuildId,
    counts,
    collectionErrors,
    phaseResults,
    fetched: phaseKeys.filter((k) => !collectionErrors[k]),
  };
}

function firstMeaningfulError(errors) {
  for (const [k, v] of Object.entries(errors || {})) {
    if (v && typeof v === 'string') return `${k}: ${v}`;
  }
  return null;
}

// Fetch status (is sync configured, when was the last snapshot, what are the
// counts) — anon-key gated, no secrets returned. Safe to call on page load.
export async function getSyncStatus(tenantKey = 'default') {
  if (TALLY_BACKEND !== 'supabase') return null;
  try {
    const data = await supabaseInvoke('get-status', { tenantKey });
    return data;
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Save portal + Tally creds to the tally_portal_config table. Admin-gated
// via LOCAL_SYNC_TOKEN — the admin pastes this once; after a successful
// save we stash it in localStorage so subsequent actions don't re-prompt.
export async function saveSyncConfig(syncToken, config, tenantKey = 'default') {
  return supabaseInvoke('save-config', { syncToken, tenantKey, ...config });
}

// Queue a fresh sync run via GitHub workflow_dispatch. Returns quickly —
// the actual run takes ~2 min. Dashboards repoll get-snapshot on a timer
// to show the fresh data when it lands.
export async function triggerSyncNow(syncToken, tenantKey = 'default') {
  return supabaseInvoke('trigger-sync', { syncToken, tenantKey });
}

// List of Tally companies the current sync can see. Prefers the server cache
// (tally_companies table); falls back to the localStorage cache populated by
// the last syncFromTally() response, so the switcher still works when the
// migration hasn't been applied yet.
export async function getCompanies(tenantKey = 'default') {
  if (TALLY_BACKEND !== 'supabase') return { companies: [], activeCompany: '' };
  try {
    const r = await supabaseInvoke('get-companies', { tenantKey });
    if (r?.companies?.length) return r;
  } catch { /* fall through to localStorage */ }
  try {
    const raw = localStorage.getItem('b2b_tally_companies_cache');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.companies) && parsed.companies.length) {
        return {
          companies: parsed.companies,
          activeCompany: parsed.activeCompany || parsed.companies[0],
          source: 'local-cache',
        };
      }
    }
  } catch { /* ignore */ }
  return { companies: [], activeCompany: '' };
}

// Probe Tally's 'List of Companies' and cache the result. Normally called
// automatically at the start of every sync-full, so manual callers are rare.
export async function listCompaniesFromTally(_unused, tenantKey = 'default') {
  return supabaseInvoke('list-companies', { tenantKey });
}

// Persist which company dashboards read from. Anon-safe — every app user
// can switch and all their teammates follow on next page load.
export async function setActiveCompany(_unused, companyName, tenantKey = 'default') {
  return supabaseInvoke('set-active-company', { tenantKey, company: companyName });
}

// Load the most recent snapshot stored by the local Playwright sync tool.
// Returns the same shape as a successful syncFromTally() so TallySync can
// feed the result into transformTallyFull without branching.
export async function loadFromSnapshot(tenantKey = 'default', company) {
  if (TALLY_BACKEND !== 'supabase') return null;
  try {
    // Omitting company lets the edge function fall back to
    // tally_companies.active_company — the single source of truth for
    // which snapshot dashboards read.
    const body = { tenantKey };
    if (company) body.company = company;
    const data = await supabaseInvoke('get-snapshot', body);
    if (!data?.connected) return { success: false, error: data?.error || 'No snapshot available' };
    const counts = data?.counts || {};
    return {
      success: true,
      mode: 'snapshot',
      source: data.source,
      updatedAt: data.updatedAt,
      ledgers: counts.ledgers || 0,
      salesVouchers: counts.salesVouchers || 0,
      receiptVouchers: counts.receiptVouchers || 0,
      stockItems: counts.stockItems || 0,
      stockGroups: counts.stockGroups || 0,
      collectionErrors: data?.errors || {},
      raw: data?.data || {},
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Nuke the current cloud snapshot for this tenant (+ active company).
// The dashboards' next refresh will pull an empty row → hasLiveData flips
// false → NoDataNotice. Meant for the "Clear" button on the TallySync
// card when a stale / bad sync is stuck in tally_snapshots.
export async function deleteSnapshot(tenantKey = 'default', company) {
  if (TALLY_BACKEND !== 'supabase') return { success: false, error: 'Snapshot delete requires the Supabase backend.' };
  try {
    const body = { tenantKey };
    if (company) body.company = company;
    const data = await supabaseInvoke('delete-snapshot', body);
    // The edge function can return `{connected: false, error: '...'}` with a
    // 200 status when the service role key is missing or the action hasn't
    // deployed. Propagate that error to the caller — otherwise the Clear
    // button silently falls into the "Failed to clear snapshot" fallback
    // with no indication of the underlying cause.
    if (data?.deleted) return { success: true, data };
    return {
      success: false,
      error: data?.error || 'delete-snapshot returned no confirmation (edge function may not be deployed yet — check the EDGE_BUILD_ID in the last sync result).',
      data,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getStatus() {
  if (TALLY_BACKEND === 'express') {
    try { return (await api.get('/tally/status')).data; } catch { return null; }
  }
  // Supabase: return stateless placeholder. Full status requires persisting sync metadata.
  return { connected: false, source: 'mock', lastAttempt: null, lastError: null };
}

export async function getDataSummary() {
  if (TALLY_BACKEND === 'express') {
    try { return (await api.get('/tally/data-summary')).data; } catch { return null; }
  }
  return null;
}
