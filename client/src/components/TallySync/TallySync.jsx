import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, Wifi, WifiOff, Database, Users, Package, Layers, Eye } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import { fmt } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import {
  TALLY_BACKEND, tallyAvailable, testConnection, syncFromTally,
  getStatus, getDataSummary,
} from '../../lib/tallyClient';

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
  const { isDemo } = useAuth();
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [config, setConfig] = useState(loadTallyConfig);

  const available = tallyAvailable();

  useEffect(() => {
    try { localStorage.setItem(TALLY_CONFIG_KEY, JSON.stringify(config)); }
    catch { /* quota / private mode */ }
  }, [config]);

  useEffect(() => {
    if (!available) return;
    getStatus().then(setStatus).catch(() => {});
    getDataSummary().then(setSummary).catch(() => {});
  }, [available]);

  const handleTest = async () => {
    if (isDemo) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection(config));
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
      const r = await syncFromTally(config);
      setSyncResult(r);
      const s = await getStatus();
      if (s) setStatus(s);
      const sm = await getDataSummary();
      if (sm) setSummary(sm);
    } catch (err) {
      setSyncResult({ success: false, error: err.message });
    }
    setSyncing(false);
  };

  const isConnected = status?.connected;

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
                {isConnected ? 'Connected to Tally Prime' : 'Using Demo Data'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {isConnected
                  ? `Live data from Tally · Last sync: ${status?.lastAttempt ? new Date(status.lastAttempt).toLocaleString() : 'N/A'}`
                  : status?.lastError || 'Tally server not reachable — showing mock data'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
              {(status?.source || 'mock').toUpperCase()}
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
                <label className="block text-xs text-gray-500 mb-1">Tally Host IP</label>
                <input type="text" value={config.host} disabled={isDemo} onChange={e => setConfig(c => ({ ...c, host: e.target.value }))}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="Enter Tally Host IP" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tally Username</label>
                <input type="text" value={config.username} disabled={isDemo} onChange={e => setConfig(c => ({ ...c, username: e.target.value }))}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="Enter Tally username" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tally Password</label>
                <input type="password" value={config.password} disabled={isDemo} onChange={e => setConfig(c => ({ ...c, password: e.target.value }))}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="Enter Tally password" />
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Company</p>
                <p className="text-sm text-white">UNITED AGENCIES DISTRIBUTORS LLP</p>
                <p className="text-xs text-gray-500 mt-0.5">Financial Year: from 1-Apr-25</p>
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

            <div className="flex gap-3">
              <button onClick={handleTest} disabled={testing || isDemo}
                title={isDemo ? 'Disabled for the demo account' : ''}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${testing ? 'border-gray-600 text-gray-500' : 'border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10'}`}>
                <Wifi size={14} className={testing ? 'animate-pulse' : ''} />
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button onClick={handleSync} disabled={syncing || isDemo}
                title={isDemo ? 'Disabled for the demo account' : ''}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${syncing ? 'bg-indigo-500/50 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-500'} text-white`}>
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>

            {/* Test Result */}
            {testResult && (
              <div className={`p-3 rounded-lg border text-sm ${testResult.connected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                {testResult.connected ? '✓ Tally server is reachable' : `✗ ${testResult.error}`}
              </div>
            )}

            {/* Sync Result */}
            {syncResult && (
              <div className={`p-3 rounded-lg border text-sm ${syncResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                {syncResult.success
                  ? `✓ Synced: ${syncResult.customers} dealers, ${syncResult.skus} SKUs, ${syncResult.categories} categories`
                  : `✗ Sync failed: ${syncResult.error}`}
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
TALLY_COMPANY=UNITED AGENCIES DISTRIBUTORS LLP`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
