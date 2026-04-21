import { useEffect, useState } from 'react';
import { Cloud, Play, Save, ShieldCheck, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { getSyncStatus, saveSyncConfig, triggerSyncNow } from '../../lib/tallyClient';

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

  const handleTrigger = async () => {
    if (!syncToken) { setMsg({ error: 'Sync token required' }); return; }
    setTriggering(true); setMsg(null);
    try {
      const r = await triggerSyncNow(syncToken);
      setMsg({ ok: r?.message || 'Sync queued. Check back in ~2 min.' });
    } catch (err) {
      setMsg({ error: err.message });
    } finally { setTriggering(false); }
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
          <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-4 text-xs text-gray-300 space-y-1">
            <p className="font-semibold text-cyan-300 flex items-center gap-2"><ShieldCheck size={14} /> How this works</p>
            <p>
              A scheduled GitHub Actions run logs into your Tally portal with these creds every hour, pulls the 5 collections, and pushes a snapshot to Supabase. Your browser never touches Tally directly. Edit any field below and click Save; the next run picks it up automatically.
            </p>
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
                disabled={triggering || !syncToken || !configured}
                title={!configured ? 'Save configuration first' : 'Dispatches a GitHub Actions run immediately'}
                className={`flex-1 min-w-[10rem] py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${triggering ? 'bg-cyan-500/50 cursor-wait' : 'bg-cyan-600 hover:bg-cyan-500'} text-white`}
              >
                <Play size={14} />{triggering ? 'Triggering...' : 'Trigger Sync Now'}
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
