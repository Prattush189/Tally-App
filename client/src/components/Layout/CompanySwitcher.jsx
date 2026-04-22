import { useEffect, useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { getCompanies, setActiveCompany } from '../../lib/tallyClient';
import { useAuth } from '../../context/AuthContext';

// Top-bar dropdown for picking which Tally company the dashboards show.
// Reads the cached list from tally_companies (populated by "Detect
// companies" in the admin settings). Persisting the active company is
// token-gated; anyone without the sync token sees the current choice but
// can't change it — we hide the dropdown entirely in that case.

const SYNC_TOKEN_KEY = 'b2b_tally_sync_token';

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
  }, [isDemo]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!e.target.closest('.__company_switcher')) setOpen(false); };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  const syncToken = localStorage.getItem(SYNC_TOKEN_KEY) || '';
  const canSwitch = Boolean(syncToken);

  async function choose(name) {
    if (!canSwitch || saving) return;
    setSaving(true);
    try {
      await setActiveCompany(syncToken, name);
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
        disabled={!canSwitch}
        title={canSwitch ? 'Switch Tally company' : 'Paste the admin sync token in TallySync → Scheduled Sync to enable switching'}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50 text-sm text-gray-200 hover:border-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Building2 size={14} className="text-indigo-400" />
        <span className="max-w-[16rem] truncate">{active || '(no company selected)'}</span>
        {canSwitch && <ChevronDown size={12} className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />}
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
