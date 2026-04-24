import { useState, useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, Wifi, WifiOff, Database, Users, Package, Layers, Eye, Cloud } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import SyncProgress from '../common/SyncProgress';
import { fmt } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import { useTallyData } from '../../context/TallyDataContext';
import {
  TALLY_BACKEND, tallyAvailable, syncFromTally,
  getStatus, getDataSummary, getCompanies, deleteSnapshot,
} from '../../lib/tallyClient';
import { transformTallyLedgers, transformTallyFull } from '../../lib/tallyTransformer';
import { availableRanges, rangeByKey } from '../../utils/dateRange';

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
    if (!raw) return { ip: '', port: '', username: '', password: '', portalUsername: '', portalPassword: '' };
    const parsed = JSON.parse(raw);
    const split = (parsed.ip || parsed.port)
      ? { ip: parsed.ip || '', port: parsed.port || '' }
      : parseHost(parsed.host);
    return {
      ip: split.ip,
      port: split.port,
      username: parsed.username || '',
      password: parsed.password || '',
      // Portal creds are optional. When blank, the edge function falls back
      // to username/password for the hb.exe cp auto-login step. Separate
      // fields are here because the hosted-Tally portal often uses a
      // different login (e.g. `unitsd5`) than the XML server (e.g.
      // `UNITED5`) — without the split the auto-login fails silently.
      portalUsername: parsed.portalUsername || '',
      portalPassword: parsed.portalPassword || '',
    };
  } catch {
    return { ip: '', port: '', username: '', password: '', portalUsername: '', portalPassword: '' };
  }
}

export default function TallySync() {
  const { isDemo, user } = useAuth();
  const { customers: liveCustomers, totals: liveTotals, syncedAt: liveSyncedAt, source: liveSource, refresh: refreshTallyData } = useTallyData();
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
  const [rangeKey, setRangeKey] = useState('all');
  // `snapshotInfo` reflects the latest cloud snapshot's metadata; sourced
  // straight from the shared Tally data context so the TallySync card
  // agrees with every other dashboard about what's currently loaded.
  const snapshotInfo = liveSyncedAt ? { updatedAt: liveSyncedAt, source: liveSource } : null;
  const [activeCompany, setActiveCompany] = useState('');
  const [knownCompanies, setKnownCompanies] = useState([]);

  const available = tallyAvailable();
  const ranges = availableRanges();
  const activeRange = rangeByKey(rangeKey);

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
      setKnownCompanies(r?.companies || []);
      setActiveCompany(r?.activeCompany || '');
    } catch { /* non-fatal */ }
  }

  // Every call to the backend consumes the composed host string rather than
  // the split fields — keeps the tallyClient / edge function contract stable
  // (one "host" field, same as before) while the UI shows them split.
  const backendCreds = () => ({
    host: tallyHost,
    username: config.username,
    password: config.password,
    // Portal creds flow through as dedicated fields so the edge function can
    // use them specifically for the hb.exe cp auto-login. If left blank the
    // edge function falls back to the XML username / password.
    portalUsername: config.portalUsername,
    portalPassword: config.portalPassword,
  });

  // Multi-company sync progress. Each Sync press iterates through every
  // company Tally detected on the first round-trip — each company gets
  // its own edge-function call with its own 150s budget so we don't have
  // to fit 4 companies into one 140s window. The progress header flips
  // between companies as they complete; the data that powers the
  // dashboards comes from whichever company is currently active in the
  // top-bar picker.
  const [progressCompany, setProgressCompany] = useState({ name: '', index: 0, total: 1 });

  // Run sync-full once for a single company (or the default / discovered
  // one if blank). Transforms + persists the result. Returns the raw
  // result plus `dealersStored` so the caller can decide whether to save
  // this company's data as the dashboards' active customer list.
  const syncOneCompany = async (companyName) => {
    const body = { ...backendCreds(), fromDate: activeRange.fromDate, toDate: activeRange.toDate };
    if (activeRange.allData) body.allData = true;
    if (companyName) body.company = companyName;
    let r = null;
    try {
      r = await syncFromTally(body);
      if (r?.success && r?.raw) {
        try {
          const useFull = r.mode === 'full' && r.raw && typeof r.raw === 'object' && 'ledgers' in r.raw;
          const { customers, totals, diagnostics } = useFull
            ? transformTallyFull(r.raw)
            : transformTallyLedgers(r.raw);
          r.dealersStored = customers.length;
          r.diagnostics = { ...(r.diagnostics || {}), ...diagnostics };
          r._customers = customers;
          r._totals = totals;
        } catch (transformErr) {
          r.transformError = transformErr.message;
        }
      }
    } catch (err) {
      r = { success: false, error: err.message };
    }
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

    // 1st pass — no explicit company so the edge function picks up its
    // own active_company and returns the full discoveredCompanies list.
    setProgressCompany({ name: '', index: 1, total: 1 });
    let first = await syncOneCompany('');
    const discovered = first?.discoveredCompanies || [];
    const firstCompany = first?.activeCompany || discovered[0] || '';
    const companiesToSync = discovered.length
      ? discovered
      : (firstCompany ? [firstCompany] : ['']);

    const results = new Map();
    results.set(firstCompany || '(default)', first);

    // 2nd...Nth passes — every company except the one the edge function
    // already synced on the first round-trip.
    for (let i = 0; i < companiesToSync.length; i++) {
      const name = companiesToSync[i];
      if (name === firstCompany) continue;
      setProgressCompany({ name, index: results.size + 1, total: companiesToSync.length });
      const r = await syncOneCompany(name);
      results.set(name, r);
    }

    // Pick the "primary" company for the result panel's headline counts —
    // the one the user has pinned, otherwise the first we synced. The
    // edge function has already written every company's data to
    // tally_snapshots on the server, so dashboards refresh from there
    // below; no per-browser localStorage write needed.
    const preferred = activeCompany || firstCompany || companiesToSync[0];
    const primary = results.get(preferred) || first;

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
      ledgers: 0, salesVouchers: 0, receiptVouchers: 0, stockItems: 0, stockGroups: 0,
      collectionErrors: {},
      dealersStored: primary?.dealersStored || 0,
      diagnostics: primary?.diagnostics,
      discoveredCompanies: discovered,
      activeCompany: firstCompany,
      raw: primary?.raw,
      perCompany: Object.fromEntries(Array.from(results.entries()).map(([name, res]) => ([name, {
        success: Boolean(res?.success),
        ledgers: res?.ledgers || 0,
        salesVouchers: res?.salesVouchers || 0,
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
      agg.receiptVouchers += res?.receiptVouchers || 0;
      agg.stockItems += res?.stockItems || 0;
      agg.stockGroups += res?.stockGroups || 0;
      if (res?.collectionErrors) {
        for (const [k, v] of Object.entries(res.collectionErrors)) {
          if (v && !agg.collectionErrors[k]) agg.collectionErrors[k] = v;
        }
      }
    }

    setSyncResult(agg);
    // Pull the fresh snapshot from Supabase into the context — every dashboard
    // reads from there, so a single refresh here propagates the new data to
    // the whole app. If the live sync itself returned nothing, the cloud row
    // is still the canonical source (it may have been populated by another
    // PC or the cron job), so this also covers the fallback case.
    try { await refreshTallyData(); } catch { /* non-fatal — dashboards will retry */ }
    try {
      const s = await getStatus();
      if (s) setStatus(s);
      const sm = await getDataSummary();
      if (sm) setSummary(sm);
      refreshCompanies();
    } catch { /* non-fatal */ }

    setProgressCompany({ name: '', index: 0, total: 1 });
    setSyncing(false);
    setSyncStartedAt(null);
  };

  // Multi-PC + background-tab recovery: if a sync started on this browser,
  // but the response got throttled (hidden-tab fetch suspend) or a *different*
  // PC ran the sync, we still want THIS tab to pick up the result. Gating on
  // visibility-return, not window-focus (too aggressive — flickers on every
  // alt-tab). Refs (not state) keep in-flight metadata visible without
  // re-subscribing the listener every toggle.
  const MIN_HIDDEN_MS = 15_000;          // ignore brief tab-switches
  const syncingRef = useRef(false);
  const syncStartedAtRef = useRef(null);
  const hiddenSinceRef = useRef(null);
  useEffect(() => { syncingRef.current = syncing; }, [syncing]);
  useEffect(() => { syncStartedAtRef.current = syncStartedAt; }, [syncStartedAt]);

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
      if (longEnough || syncingRef.current) {
        // Re-pull from cloud AND wait so we can populate real record counts
        // in the recovery banner instead of the misleading "No records
        // returned" placeholder. Every dashboard reads via the context, so
        // one refresh propagates.
        const wasSyncing = syncingRef.current;
        refreshTallyData().finally(() => {
          if (wasSyncing) {
            setSyncing(false);
            setSyncStartedAt(null);
            setSyncResult((r) => {
              if (r) return r;
              // Be honest about what the cloud snapshot actually holds.
              // Previously this always claimed `success: true` and surfaced
              // a green "Synced successfully" banner — which was misleading
              // when the edge function had failed mid-run (e.g. compute
              // OOM on a heavy Day Book) and nothing had landed in cloud.
              // Users saw "success" and then "No Tally data synced yet" on
              // dashboards, which looks like the app lied to them. Only
              // claim success when there's real data under this tenant.
              const hasData = Boolean(liveCustomers.length)
                || Number(liveTotals?.ledgers) > 0
                || Number(liveTotals?.salesVouchers) > 0
                || Number(liveTotals?.receiptVouchers) > 0
                || Number(liveTotals?.stockItems) > 0;
              if (hasData) {
                return {
                  success: true,
                  mode: 'full',
                  note: 'Sync finished in the background while this tab was hidden — data loaded from the cloud snapshot.',
                  dealersStored: liveCustomers.length,
                  ledgers: liveTotals?.ledgers,
                  salesVouchers: liveTotals?.salesVouchers,
                  receiptVouchers: liveTotals?.receiptVouchers,
                  paymentVouchers: liveTotals?.paymentVouchers,
                  stockItems: liveTotals?.stockItems,
                  stockGroups: liveTotals?.stockGroups,
                };
              }
              return {
                success: false,
                mode: 'full',
                partial: true,
                error: 'Sync did not return data while this tab was hidden, and the cloud snapshot is still empty. The edge function may have run out of compute or Tally was unreachable — open the browser back on this tab, press Sync again, and watch the progress panel. If it keeps failing, check Supabase Edge Function logs for the tally function.',
                collectionErrors: {},
              };
            });
          }
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
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tally Username</label>
                <input type="text" value={config.username} disabled={isDemo || syncing} onChange={e => setConfig(c => ({ ...c, username: e.target.value }))}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="Enter Tally username" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tally Password</label>
                <input type="password" value={config.password} disabled={isDemo || syncing} onChange={e => setConfig(c => ({ ...c, password: e.target.value }))}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="Enter Tally password" />
              </div>
              {/* Portal login credentials. Optional — leave blank to reuse
                  the Tally username/password above. Hosted-Tally portals
                  often use a different login (e.g. "unitsd5") than the XML
                  server (e.g. "UNITED5"); if yours does, fill both pairs
                  here or auto-login will fail. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Portal Username <span className="text-gray-600">(for auto-login)</span></label>
                  <input type="text" value={config.portalUsername} disabled={isDemo || syncing} onChange={e => setConfig(c => ({ ...c, portalUsername: e.target.value }))}
                    className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder={config.username || 'e.g. unitsd5'} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Portal Password</label>
                  <input type="password" value={config.portalPassword} disabled={isDemo || syncing} onChange={e => setConfig(c => ({ ...c, portalPassword: e.target.value }))}
                    className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="Optional — portal login password" />
                </div>
              </div>
              <p className="text-[11px] text-gray-500 -mt-2">
                Optional. The hosted-Tally portal login (<code className="text-gray-300">/cgi-bin/hb.exe</code>) often takes different credentials than the XML server on <code className="text-gray-300">:{config.port || '9007'}</code>. Leave blank to reuse the Tally credentials above.
              </p>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date range</label>
                <select
                  value={rangeKey}
                  disabled={isDemo || syncing}
                  onChange={e => setRangeKey(e.target.value)}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {ranges.map(r => (
                    <option key={r.key || r.label} value={r.key || r.label}>{r.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Picks which financial year's balances Tally returns (ClosingBalance is as-of the end date). Re-sync any time to pull a different range.
                </p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Companies</p>
                <p className="text-sm text-white">
                  {knownCompanies.length > 0
                    ? `All ${knownCompanies.length} detected compan${knownCompanies.length === 1 ? 'y' : 'ies'} will be synced on every click.`
                    : 'Companies will be auto-detected on the first Sync and then synced together.'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {activeRange.fromDate
                    ? `${activeRange.label}: ${activeRange.fromDate} → ${activeRange.toDate}`
                    : 'All available data (Tally default range)'}
                </p>
                <p className="text-[11px] text-indigo-300/80 mt-1">
                  Use the top-bar company picker to choose which one's data the dashboards show.
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
              />
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
                          syncResult.salesVouchers ? `${syncResult.salesVouchers} sales vouchers` : null,
                          syncResult.receiptVouchers ? `${syncResult.receiptVouchers} receipt vouchers` : null,
                          syncResult.vouchers ? `${syncResult.vouchers} vouchers` : null,
                          syncResult.stockItems ? `${syncResult.stockItems} stock items` : null,
                          syncResult.stockGroups ? `${syncResult.stockGroups} stock groups` : null,
                          syncResult.groups ? `${syncResult.groups} groups` : null,
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
                            Detected {syncResult.discoveredCompanies.length} company{syncResult.discoveredCompanies.length === 1 ? '' : 'ies'}: {syncResult.discoveredCompanies.join(', ')}. Active: <b>{syncResult.activeCompany || '(none)'}</b>.
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
                    {syncResult.diagnostics && syncResult.dealersStored != null && (
                      <div className="text-xs text-amber-300/80 pt-1 space-y-1">
                        <div>
                          {syncResult.diagnostics.filterMatched
                            ? `Matched ${syncResult.dealersStored} Sundry Debtor ledgers out of ${syncResult.ledgers || '?'} total.`
                            : syncResult.diagnostics.usedFallback
                              ? `No "Sundry Debtors" group matched — falling back to ledgers with non-zero balances (${syncResult.dealersStored}).`
                              : 'No ledgers matched and no balances found — dashboards will stay empty.'}
                        </div>
                        {syncResult.diagnostics.parentsSeen?.length > 0 && (
                          <div className="text-[11px] text-gray-400">
                            Parent groups in feed: {syncResult.diagnostics.parentsSeen.join(', ') || '(none)'}
                          </div>
                        )}
                        {syncResult.diagnostics.accountingGroupCount != null && (
                          <div className="text-[11px] text-gray-400">
                            Accounting groups fetched: <span className={syncResult.diagnostics.accountingGroupCount > 0 ? 'text-emerald-300' : 'text-red-300'}>{syncResult.diagnostics.accountingGroupCount}</span>
                            {' · '}
                            parent map entries: <span className={syncResult.diagnostics.groupMapSize > 0 ? 'text-emerald-300' : 'text-red-300'}>{syncResult.diagnostics.groupMapSize}</span>
                          </div>
                        )}
                        {syncResult.diagnostics.sampleGroupHops?.length > 0 && (
                          <div className="text-[11px] text-gray-400">
                            Sample chains: {syncResult.diagnostics.sampleGroupHops.map((c, i) => <div key={i} className="font-mono">{c}</div>)}
                          </div>
                        )}
                        {syncResult.diagnostics.sampleKeys?.length > 0 && (
                          <div className="text-[11px] text-gray-400">
                            Fields on first ledger: {syncResult.diagnostics.sampleKeys.join(', ')}
                          </div>
                        )}
                        {syncResult.diagnostics.sampleLedger && (
                          <div className="text-[11px] text-gray-400 font-mono">
                            Sample (resolved): {JSON.stringify(syncResult.diagnostics.sampleLedger)}
                          </div>
                        )}
                        {syncResult.diagnostics.sampleRaw && Object.keys(syncResult.diagnostics.sampleRaw).length > 0 && (
                          <div className="text-[11px] text-gray-400 font-mono break-all">
                            Sample (raw keys): {JSON.stringify(syncResult.diagnostics.sampleRaw).slice(0, 600)}
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
