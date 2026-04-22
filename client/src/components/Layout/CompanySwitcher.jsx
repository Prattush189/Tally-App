import { useEffect, useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { getCompanies, setActiveCompany } from '../../lib/tallyClient';
import { useAuth } from '../../context/AuthContext';

// Top-bar dropdown for picking which Tally company the dashboards show.
// Reads the cached list from tally_companies (populated automatically at
// the start of every sync-full run — no manual "Detect" step). Switching
// is anon-safe now; anyone with the app open can change the active
// company and everyone else's dashboards follow on next load.

export default function CompanySwitcher() {
  const { isDemo } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [active, setActive] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const res = await getCompanies();
    setCompanies(res.companies || []);
    setActive(res.activeCompany || '');
  }

  useEffect(() => {
    if (isDemo) return;
    refresh();
    // Re-poll every minute so a sync that discovers new companies surfaces
    // without a page reload.
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [isDemo]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!e.target.closest('.__company_switcher')) setOpen(false); };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  async function choose(name) {
    if (saving || name === active) { setOpen(false); return; }
    setSaving(true);
    try {
      // set-active-company is no longer token-gated; anon key is enough.
      await setActiveCompany('', name);
      setActive(name);
      setOpen(false);
      // Reload so every dashboard fetches the new active company.
      window.location.reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Couldn't switch company: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (isDemo || !companies.length) return null;

  return (
    <div className="__company_switcher relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Switch Tally company — each company has its own snapshot"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50 text-sm text-gray-200 hover:border-indigo-500/40"
      >
        <Building2 size={14} className="text-indigo-400" />
        <span className="max-w-[16rem] truncate">{active || '(pick a company)'}</span>
        <ChevronDown size={12} className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-700/60 rounded-lg shadow-xl min-w-[20rem] max-h-80 overflow-auto z-50">
          {companies.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => choose(name)}
              className="w-full flex items-center justify-between text-left px-3 py-2 text-sm text-gray-200 hover:bg-indigo-500/10"
            >
              <span className="truncate">{name}</span>
              {name === active && <Check size={14} className="text-emerald-400 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
