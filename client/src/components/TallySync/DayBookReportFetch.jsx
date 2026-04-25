import { useEffect, useState } from 'react';
import { CalendarRange, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { fetchDayBookReport } from '../../lib/tallyClient';

// User-driven Day Book report fetch. Lets the user pick a from / to range
// and pulls Tally's built-in Day Book report for that window — a different
// XML code path from the custom Voucher COLLECTION that crashes with
// c0000005 on this dataset. Result lands under the `dayBookReport`
// snapshot key; the transformer reads it alongside the other voucher
// fallbacks (salesRegister, receiptRegister, manualVouchers).
//
// The native HTML `<input type="date">` returns YYYY-MM-DD; we strip the
// dashes to YYYYMMDD which is Tally's wire format.
function toTallyDate(iso) {
  return (iso || '').replace(/-/g, '');
}

// Default the picker to the current FY (April → March in Indian
// accounting). Means the first click pulls a meaningful window without
// the user having to know what to type. They can widen / narrow as
// needed afterwards.
function defaultFinancialYear(now = new Date()) {
  const y = now.getFullYear();
  const month = now.getMonth(); // 0-11
  const startYear = month >= 3 ? y : y - 1;
  const endYear = startYear + 1;
  return {
    from: `${startYear}-04-01`,
    to: `${endYear}-03-31`,
  };
}

export default function DayBookReportFetch({ company, host, onFetched }) {
  const fy = defaultFinancialYear();
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  // Keep the picker in sync if the active company changes — the dates are
  // the user's choice, but a stale result panel from a prior company is
  // confusing once they switch.
  useEffect(() => { setResult(null); }, [company]);

  const rangeDays = (() => {
    if (!from || !to) return 0;
    const d1 = new Date(from);
    const d2 = new Date(to);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
    return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
  })();
  const rangeWarning = rangeDays > 90;

  const handleFetch = async () => {
    if (!company) {
      setResult({ success: false, error: 'No company is active — open one in Tally and run a sync first.' });
      return;
    }
    if (!host) {
      setResult({ success: false, error: 'Tally host not configured — fill in the IP and port at the top of this page first.' });
      return;
    }
    if (!from || !to) {
      setResult({ success: false, error: 'Pick a from and to date.' });
      return;
    }
    if (toTallyDate(from) > toTallyDate(to)) {
      setResult({ success: false, error: 'From date must be on or before To date.' });
      return;
    }
    setBusy(true);
    setResult(null);
    const r = await fetchDayBookReport({
      from: toTallyDate(from),
      to: toTallyDate(to),
      company,
      config: { host },
    });
    setResult(r);
    setBusy(false);
    if (r.success) onFetched?.(r);
  };

  return (
    <div className="glass-card p-5 space-y-3">
      <div className="flex items-start gap-3">
        <CalendarRange size={20} className="text-indigo-300 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-white">Day Book report fetch (alternate XML path)</h3>
          <p className="text-xs text-gray-400 leading-relaxed">
            Pulls Tally&apos;s built-in <span className="text-gray-300">Day Book</span> report for a date range you choose — same code path the GUI Day Book view uses, different iterator from the custom voucher COLLECTION that crashes with c0000005. Start with a tight window (one month at a time is safe) so each call stays under the Edge Function&apos;s 150 MB cap.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={busy}
            className="bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={busy}
            className="bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={handleFetch}
          disabled={busy || !company}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-wait text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all"
        >
          <Download size={14} />
          {busy ? 'Fetching…' : 'Fetch Day Book'}
        </button>
        {rangeDays > 0 && (
          <span className={`text-xs ${rangeWarning ? 'text-amber-300' : 'text-gray-500'}`}>
            {rangeDays.toLocaleString()} day{rangeDays === 1 ? '' : 's'}
            {rangeWarning ? ' — wide ranges risk hitting the 150 MB memory cap; chunk by month if it errors' : ''}
          </span>
        )}
      </div>

      {!company && (
        <p className="text-xs text-amber-300/80">
          No active company detected. Open a company in Tally and click Sync first — that picks the company name the report query needs.
        </p>
      )}

      {result && result.success && (
        <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
          <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            {result.count?.toLocaleString() || '0'} voucher{result.count === 1 ? '' : 's'} fetched for {from} → {to}. Refresh the dashboards to see revenue / aging / DSO populate.
          </span>
        </div>
      )}
      {result && !result.success && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{result.error || 'Fetch failed.'}</span>
        </div>
      )}
    </div>
  );
}
