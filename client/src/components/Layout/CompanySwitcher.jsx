import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { getCompanies, setActiveCompany } from '../../lib/tallyClient';
import { useAuth } from '../../context/AuthContext';
import { canonicalCompanyName, groupCompaniesByCanonical } from '../../utils/companyName';

// Top-bar dropdown for picking which Tally company the dashboards show.
// Reads the cached list from tally_companies (populated automatically at
// the start of every sync run — no manual "Detect" step). Tally tends to
// hold one "company" per financial year for the same business
// (e.g. "ACME LLP - (from 1-Apr-25)" + "ACME LLP - (from 1-Apr-26)"); we
// dedup by the canonical name (suffix stripped) and stitch every FY's
// data into one logical company in storage, so the dropdown shows the
// canonical entries once.

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

  // Group raw Tally names by canonical, sorted by canonical name. Each
  // group's `members` list shows the underlying FY-tagged entries so a
  // power user can still see which FYs Tally exposed for that business.
  const grouped = useMemo(() => groupCompaniesByCanonical(companies), [companies]);
  const activeCanonical = canonicalCompanyName(active);

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

  async function choose(canonical) {
    if (saving || canonical === activeCanonical) { setOpen(false); return; }
    setSaving(true);
    try {
      // Store canonical name as the active company. The edge function's
      // get-snapshot reads by this key, and every per-FY sync writes to
      // the canonical row, so picking the canonical surfaces the
      // stitched multi-FY view automatically.
      await setActiveCompany('', canonical);
      setActive(canonical);
      setOpen(false);
      window.location.reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Couldn't switch company: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (isDemo || !grouped.length) return null;

  return (
    <div className="__company_switcher relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Switch Tally company — each canonical entry stitches every per-FY data file together"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50 text-sm text-gray-200 hover:border-indigo-500/40"
      >
        <Building2 size={14} className="text-indigo-400" />
        <span className="max-w-[16rem] truncate">{activeCanonical || '(pick a company)'}</span>
        <ChevronDown size={12} className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-700/60 rounded-lg shadow-xl min-w-[22rem] max-h-96 overflow-auto z-50">
          {grouped.map(({ canonical, members }) => (
            <button
              key={canonical}
              type="button"
              onClick={() => choose(canonical)}
              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-indigo-500/10"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{canonical}</span>
                {canonical === activeCanonical && <Check size={14} className="text-emerald-400 flex-shrink-0" />}
              </div>
              {members.length > 1 && (
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {members.length} FY files: {members.map((m) => m.fy?.label || '?').filter(Boolean).join(' · ')}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
