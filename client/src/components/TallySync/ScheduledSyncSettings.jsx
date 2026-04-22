import { useEffect, useState } from 'react';
import { Cloud, Play, Save, ChevronDown, ChevronRight, AlertTriangle, Chrome, Check, ExternalLink } from 'lucide-react';
import { getSyncStatus, saveSyncConfig, triggerSyncNow } from '../../lib/tallyClient';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/supabase';

// Cache the admin sync token in localStorage so the admin doesn't have to
// paste it every time. XSS exposure is acceptable in this single-tenant
// internal tool — the token only gates cred reads and snapshot writes, not
// any customer-facing surface.
const SYNC_TOKEN_KEY = 'b2b_tally_sync_token';

function formatAgo(iso) {
  if (!iso) return null;
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return 'just now';
  const min = Math.round(delta / 60_000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

// Minute-of-hour the scheduled workflow cron fires — matches tally-scheduled-sync.yml.
const CRON_MINUTE = 7;

function formatNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(CRON_MINUTE, 0, 0);
  if (next <= now) next.setHours(next.getHours() + 1);
  const min = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60_000));
  return `in ${min} min (${next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
}

export default function ScheduledSyncSettings() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(null);
  const [syncToken, setSyncToken] = useState(() => localStorage.getItem(SYNC_TOKEN_KEY) || '');
  const [form, setForm] = useState({
    portalUrl: '',
    portalUser: '',
    portalPass: '',
    company: '',
  });
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [msg, setMsg] = useState(null);
  // Extension bridge state. Extension's content script posts a 'ready'
  // message on load, then a 'configSaved' ack after we push config to it.
  const [extState, setExtState] = useState({ present: false, version: null, savedAt: null });
  const [extPushing, setExtPushing] = useState(false);

  async function refreshStatus() {
    const s = await getSyncStatus();
    setStatus(s);
    if (s?.configPreview) {
      setForm((f) => ({
        ...f,
        portalUrl: f.portalUrl || s.configPreview.portalUrl || '',
        portalUser: f.portalUser || s.configPreview.portalUser || '',
        company: f.company || s.configPreview.company || '',
      }));
    }
  }

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 60_000);
    return () => clearInterval(t);
  }, []);

  // Extension bridge — listens for 'ready' and 'configSaved' posts from
  // extension/bridge.js content script (only runs if the extension is
  // installed on this origin).
  useEffect(() => {
    const handler = (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.source !== 'tally-extension') return;
      if (d.event === 'ready' || d.event === 'pong') {
        setExtState((s) => ({ ...s, present: true, version: d.version }));
      }
      if (d.event === 'configSaved') {
        setExtState((s) => ({ ...s, present: true, savedAt: new Date().toISOString() }));
        setExtPushing(false);
      }
    };
    window.addEventListener('message', handler);
    // Ping in case the extension loaded before this effect attached.
    window.postMessage({ source: 'tally-dashboard', type: 'ping' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const pushConfigToExtension = () => {
    if (!extState.present) return;
    setExtPushing(true);
    window.postMessage({
      source: 'tally-dashboard',
      type: 'setConfig',
      config: {
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        syncToken,
        company: form.company || status?.configPreview?.company || '',
        tenantKey: 'default',
      },
    }, '*');
    // Safety timeout in case the extension never acks
    setTimeout(() => setExtPushing(false), 5000);
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (!syncToken) { setMsg({ error: 'Sync token required' }); return; }
    setSaving(true); setMsg(null);
    try {
      await saveSyncConfig(syncToken, form);
      localStorage.setItem(SYNC_TOKEN_KEY, syncToken);
      setMsg({ ok: 'Configuration saved. Scheduled sync will use these creds on the next run.' });
      await refreshStatus();
    } catch (err) {
      setMsg({ error: err.message });
    } finally { setSaving(false); }
  };

  // "Sync Now" opens the Tally portal in a new tab. If the extension is
  // installed, its content script auto-runs the sync the moment it sees
  // Tally responding on :9007 (after the user logs in + clicks TallyPrime).
  // No headless workflow dispatch — that path requires AI vision, which
  // isn't wired in yet.
  const handleTrigger = () => {
    const url = form.portalUrl || status?.configPreview?.portalUrl || 'http://103.76.213.243/';
    window.open(url, '_blank', 'noopener');
    setMsg({ ok: extState.present
      ? 'Portal opened in a new tab. Log in and click TallyPrime — the extension will auto-sync once Tally starts responding.'
      : 'Portal opened in a new tab. Install the Chrome extension (see extension/README.md) for one-click sync. Without it you\'ll need to run `npm run sync:headed` locally.' });
  };

  const snap = status?.snapshot;
  const configured = status?.configured;

  return (
    <div className="glass-card p-6 space-y-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <Cloud size={18} className="text-cyan-400" />
          <div>
            <h3 className="text-lg font-semibold text-white">Scheduled Sync (Cloud)</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {configured
                ? `Hourly sync is active — last snapshot ${formatAgo(snap?.updatedAt) || 'never'} · next run ${formatNextRun()}`
                : 'Not configured yet — fill the form below to enable hourly automated syncs.'}
            </p>
          </div>
        </div>
        {expanded ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
      </button>

      {!expanded && snap && (
        <div className="text-xs text-gray-400 border-t border-gray-700/40 pt-3 flex flex-wrap gap-3">
          {Object.entries(snap.counts || {}).map(([k, v]) => (
            <span key={k}><span className="text-gray-300">{v}</span> {k}</span>
          ))}
          {snap.hasErrors && <span className="text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> collection errors</span>}
        </div>
      )}

      {expanded && (
        <div className="space-y-4 pt-2">
          {/* Extension status card — one-click configure if installed */}
          {extState.present ? (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 text-xs text-gray-300 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Chrome size={16} className="text-emerald-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-emerald-300">Chrome extension detected{extState.version ? ` (v${extState.version})` : ''}</p>
                    <p className="text-gray-300 mt-0.5">Push this app's Supabase creds + sync token to the extension so you don't have to paste them in its popup.</p>
                    {extState.savedAt && (
                      <p className="text-emerald-400/80 mt-1 flex items-center gap-1"><Check size={12} /> Config synced to extension at {new Date(extState.savedAt).toLocaleTimeString()}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={pushConfigToExtension}
                  disabled={extPushing || !syncToken}
                  title={!syncToken ? 'Paste the sync token below first' : 'Send supabase URL + anon key + sync token + company to the extension'}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-40 disabled:cursor-not-allowed ${extPushing ? 'border-gray-600 text-gray-500' : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10'}`}
                >
                  {extPushing ? 'Pushing…' : 'Configure extension'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                Next step: open <a href="http://103.76.213.243/" target="_blank" rel="noreferrer" className="text-emerald-300 underline underline-offset-2 inline-flex items-center gap-1">the Tally portal <ExternalLink size={10} /></a>, log in, click TallyPrime, then click the <b>↻ Sync to Dashboard</b> button the extension injects.
              </p>
            </div>
          ) : (
            <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-4 text-xs text-gray-300 space-y-1">
              <p className="font-semibold text-gray-200 flex items-center gap-2"><Chrome size={14} /> Chrome extension not detected</p>
              <p>
                Install the <code className="text-cyan-300">extension/</code> folder as an unpacked Chrome extension (one-time). See <code className="text-cyan-300">extension/README.md</code>. Once installed and this page reloaded, a "Configure extension" button will appear here to push config automatically.
              </p>
            </div>
          )}

          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 text-xs text-gray-300 space-y-2">
            <p className="font-semibold text-amber-300 flex items-center gap-2"><AlertTriangle size={14} /> How syncs happen today</p>
            <p>
              Browsers block cross-origin fetches to the Tally server from this web app — so the sync has to originate from something with elevated permissions. The cleanest option:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li><b className="text-cyan-300">Chrome extension (recommended):</b> install once from the <code className="text-cyan-300">extension/</code> folder, and a <i>Sync to Dashboard</i> button appears on the Tally portal page. Click TallyPrime + click Sync → data flows.</li>
              <li><b>Local CLI fallback:</b> <code className="text-cyan-300">npm run sync:headed</code> from <code className="text-cyan-300">tools/tally-sync-local/</code> — opens a browser, you click TallyPrime, it uploads.</li>
              <li><b>Scheduled cron (parked):</b> the workflow is wired up but dormant until AI vision can click TallyPrime headlessly. The creds you save below will drive it automatically once vision lands.</li>
            </ul>
          </div>

          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Admin sync token</label>
              <input
                type="password"
                autoComplete="off"
                value={syncToken}
                onChange={(e) => setSyncToken(e.target.value)}
                placeholder="Same value as LOCAL_SYNC_TOKEN in Supabase secrets"
                className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Gates cred saves + manual triggers. Set once in Supabase via <code className="text-cyan-300">supabase secrets set LOCAL_SYNC_TOKEN=...</code>, then paste here — we cache it in localStorage.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Portal URL</label>
                <input
                  type="text"
                  value={form.portalUrl}
                  onChange={(e) => setForm((f) => ({ ...f, portalUrl: e.target.value }))}
                  placeholder="http://103.76.213.243"
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tally company (inside portal)</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  placeholder="UNITED AGENCIES DISTRIBUTORS LLP"
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Portal username</label>
                <input
                  type="text"
                  value={form.portalUser}
                  onChange={(e) => setForm((f) => ({ ...f, portalUser: e.target.value }))}
                  placeholder="united5"
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Portal password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.portalPass}
                  onChange={(e) => setForm((f) => ({ ...f, portalPass: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                disabled={saving || !syncToken}
                className={`flex-1 min-w-[10rem] py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border disabled:opacity-40 disabled:cursor-not-allowed ${saving ? 'border-gray-600 text-gray-500' : 'border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10'}`}
              >
                <Save size={14} />{saving ? 'Saving...' : 'Save Configuration'}
              </button>
              <button
                type="button"
                onClick={handleTrigger}
                disabled={!configured}
                title={!configured ? 'Save configuration first' : 'Opens the Tally portal in a new tab — extension auto-syncs when TallyPrime launches'}
                className="flex-1 min-w-[10rem] py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                <ExternalLink size={14} />Open Portal → Sync
              </button>
            </div>

            {msg && (
              <div className={`p-3 rounded-lg text-sm border ${msg.ok ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-300'}`}>
                {msg.ok || `✗ ${msg.error}`}
              </div>
            )}
          </form>

          {snap && (
            <div className="border-t border-gray-700/40 pt-3 space-y-1.5">
              <p className="text-xs font-semibold text-gray-400">Latest snapshot</p>
              <div className="text-xs text-gray-400 flex flex-wrap gap-3">
                <span>Updated: {snap.updatedAt ? new Date(snap.updatedAt).toLocaleString() : '—'}</span>
                <span>Source: {snap.source || '—'}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-gray-300">
                {Object.entries(snap.counts || {}).map(([k, v]) => (
                  <span key={k}><span className="text-white font-semibold">{v}</span> {k}</span>
                ))}
              </div>
              {snap.hasErrors && snap.errors && (
                <div className="text-xs text-amber-300/80 space-y-0.5 pt-1">
                  {Object.entries(snap.errors).map(([col, m]) => (
                    <div key={col}><span className="font-semibold">{col}</span>: {String(m)}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
