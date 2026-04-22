import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, Wifi, WifiOff, Database, Users, Package, Layers, Eye, Cloud } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import { fmt } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import {
  TALLY_BACKEND, tallyAvailable, testConnection, syncFromTally,
  getStatus, getDataSummary, loadFromSnapshot, getCompanies,
} from '../../lib/tallyClient';
import { transformTallyLedgers, transformTallyFull } from '../../lib/tallyTransformer';
import { saveLiveCustomers, loadLiveCustomers, clearLiveCustomers } from '../../lib/liveData';
import { availableRanges, rangeByKey } from '../../utils/dateRange';

const TALLY_CONFIG_KEY = 'b2b_tally_config';

function loadTallyConfig() {
  try {
    const raw = localStorage.getItem(TALLY_CONFIG_KEY);
    if (!raw) return { host: '', username: '', password: '' };
    const parsed = JSON.parse(raw);
    return {
      host: parsed.host || '',
      username: parsed.username || '',
      password: parsed.password || '',
    };
  } catch {
    return { host: '', username: '', password: '' };
  }
}

export default function TallySync() {
  const { isDemo, user } = useAuth();
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [config, setConfig] = useState(loadTallyConfig);
  const [rangeKey, setRangeKey] = useState('all');
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotInfo, setSnapshotInfo] = useState(null);
  const [activeCompany, setActiveCompany] = useState('');
  const [knownCompanies, setKnownCompanies] = useState([]);

  const available = tallyAvailable();
  const ranges = availableRanges();
  const activeRange = rangeByKey(rangeKey);

  useEffect(() => {
    try { localStorage.setItem(TALLY_CONFIG_KEY, JSON.stringify(config)); }
    catch { /* quota / private mode */ }
  }, [config]);

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

  const handleTest = async () => {
    if (isDemo) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection({ ...config, fromDate: activeRange.fromDate, toDate: activeRange.toDate }));
    } catch (err) {
      setTestResult({ connected: false, error: err.message });
    }
    setTesting(false);
  };

  const handleSync = async () => {
    if (isDemo) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await syncFromTally({ ...config, fromDate: activeRange.fromDate, toDate: activeRange.toDate });
      // Transform raw Tally data → dashboard customer shape and persist.
      // Dashboards read from liveData on the next render so numbers reflect the sync.
      if (r?.success && r?.raw) {
        try {
          const useFull = r.mode === 'full' && r.raw && typeof r.raw === 'object' && 'ledgers' in r.raw;
          const { customers, totals, diagnostics } = useFull
            ? transformTallyFull(r.raw)
            : transformTallyLedgers(r.raw);
          r.dealersStored = customers.length;
          r.diagnostics = diagnostics;
          if (customers.length) {
            saveLiveCustomers(user?.email, customers, {
              ...totals,
              range: activeRange.label || 'All data',
              fromDate: activeRange.fromDate,
              toDate: activeRange.toDate,
            });
          }
        } catch (transformErr) {
          r.transformError = transformErr.message;
        }
      }
      setSyncResult(r);
      const s = await getStatus();
      if (s) setStatus(s);
      const sm = await getDataSummary();
      if (sm) setSummary(sm);
      refreshCompanies();
    } catch (err) {
      setSyncResult({ success: false, error: err.message });
    }
    setSyncing(false);
  };

  // Pull the most recent snapshot written by the local Playwright sync tool
  // and feed it through the existing transformer so dashboards hydrate without
  // needing Tally reachable from the browser.
  const handleLoadSnapshot = async () => {
    if (isDemo) return;
    setLoadingSnapshot(true);
    try {
      const r = await loadFromSnapshot();
      if (r?.success && r?.raw) {
        try {
          const { customers, totals, diagnostics } = transformTallyFull(r.raw);
          r.dealersStored = customers.length;
          r.diagnostics = diagnostics;
          if (customers.length) {
            saveLiveCustomers(user?.email, customers, {
              ...totals,
              range: activeRange.label || 'All data',
              fromDate: activeRange.fromDate,
              toDate: activeRange.toDate,
              source: `snapshot (${r.source})`,
              syncedAt: r.updatedAt,
            });
          }
        } catch (transformErr) {
          r.transformError = transformErr.message;
        }
      }
      setSyncResult(r);
      setSnapshotInfo(r?.success ? { updatedAt: r.updatedAt, source: r.source } : null);
    } catch (err) {
      setSyncResult({ success: false, error: err.message });
    }
    setLoadingSnapshot(false);
  };

  // Auto-load the latest snapshot on first mount. If the local sync tool has
  // posted one, dashboards come up with real numbers without the user needing
  // to press anything. Skipped when there's already a local cache (to avoid
  // clobbering whatever dashboards rendered with) and for demo accounts.
  useEffect(() => {
    if (!available || isDemo) return;
    if (loadLiveCustomers(user?.email)) return;
    handleLoadSnapshot();

  }, [available, isDemo, user?.email]);

  const handleClearLiveData = () => {
    if (isDemo) return;
    clearLiveCustomers(user?.email);
    setSyncResult({ success: true, cleared: true });
  };

  const liveSnapshot = !isDemo ? loadLiveCustomers(user?.email) : null;

  // A saved live snapshot counts as "connected" regardless of backend, since
  // the whole point of the banner is "do the dashboards have real data".
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
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tally Host or URL</label>
                <input type="text" value={config.host} disabled={isDemo || testing || syncing} onChange={e => setConfig(c => ({ ...c, host: e.target.value }))}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="1.2.3.4:9000  or  https://tally.example.com" />
                <p className="text-[11px] text-gray-500 mt-1">Paste the same URL you use in your browser to reach Tally. Http/https both supported.</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tally Username</label>
                <input type="text" value={config.username} disabled={isDemo || testing || syncing} onChange={e => setConfig(c => ({ ...c, username: e.target.value }))}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="Enter Tally username" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tally Password</label>
                <input type="password" value={config.password} disabled={isDemo || testing || syncing} onChange={e => setConfig(c => ({ ...c, password: e.target.value }))}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="Enter Tally password" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date range</label>
                <select
                  value={rangeKey}
                  disabled={isDemo || testing || syncing}
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
                <p className="text-xs text-gray-500 mb-1">Company {knownCompanies.length > 1 ? `(of ${knownCompanies.length} in Tally)` : ''}</p>
                <p className="text-sm text-white">
                  {activeCompany || (knownCompanies[0]) || 'No company selected yet — click Sync Now to auto-detect from Tally'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {activeRange.fromDate
                    ? `${activeRange.label}: ${activeRange.fromDate} → ${activeRange.toDate}`
                    : 'All available data (Tally default range)'}
                </p>
                {knownCompanies.length > 1 && (
                  <p className="text-[11px] text-indigo-300/80 mt-1">Switch company from the top-bar dropdown.</p>
                )}
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

            <div className="flex flex-wrap gap-3">
              <button onClick={handleTest} disabled={testing || isDemo}
                title={isDemo ? 'Disabled for the demo account' : ''}
                className={`flex-1 min-w-[10rem] py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${testing ? 'border-gray-600 text-gray-500' : 'border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10'}`}>
                <Wifi size={14} className={testing ? 'animate-pulse' : ''} />
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button onClick={handleLoadSnapshot} disabled={loadingSnapshot || isDemo}
                title={isDemo ? 'Disabled for the demo account' : 'Load the most recent snapshot pushed by the local sync tool'}
                className={`flex-1 min-w-[10rem] py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${loadingSnapshot ? 'border-gray-600 text-gray-500' : 'border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10'}`}>
                <Cloud size={14} className={loadingSnapshot ? 'animate-pulse' : ''} />
                {loadingSnapshot ? 'Loading...' : 'Load Cloud Snapshot'}
              </button>
              <button onClick={handleSync} disabled={syncing || isDemo}
                title={isDemo ? 'Disabled for the demo account' : 'Fetch live from Tally — needs the Edge Function to reach Tally directly'}
                className={`flex-1 min-w-[10rem] py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${syncing ? 'bg-indigo-500/50 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-500'} text-white`}>
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing...' : 'Sync Now (Live)'}
              </button>
            </div>

            {snapshotInfo?.updatedAt && (
              <div className="text-xs text-cyan-300/80 flex items-center gap-2">
                <Cloud size={12} /> Snapshot from {new Date(snapshotInfo.updatedAt).toLocaleString()}
                {snapshotInfo.source ? ` · via ${snapshotInfo.source}` : ''}
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <div className={`p-3 rounded-lg border text-sm ${testResult.connected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                {testResult.connected ? '✓ Tally server is reachable' : `✗ ${testResult.error}`}
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
                    <div>{syncResult.cleared ? '✓ Local Tally data cleared' : '✓ Synced successfully from Tally'}</div>
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
                ) : `✗ Sync failed: ${syncResult.error}`}
              </div>
            )}
            {liveSnapshot && !isDemo && (
              <div className="flex items-center justify-between text-xs text-gray-400 mt-3 pt-3 border-t border-gray-700/40">
                <span>
                  <span className="text-gray-300">{liveSnapshot.customers.length}</span> dealers cached from {new Date(liveSnapshot.syncedAt).toLocaleString()}
                </span>
                <button type="button" onClick={handleClearLiveData} className="text-red-300/80 hover:text-red-200 underline underline-offset-2">
                  Clear
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
