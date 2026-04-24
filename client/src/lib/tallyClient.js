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
