import { AlertTriangle } from 'lucide-react';

// Drop-in banner shown above any voucher-driven dashboard when the cloud
// snapshot has no usable invoice / receipt / purchase rows for the
// active company. Voucher feeds come from typed Sales / Purchase /
// Receipt Register fetches against Tally's current period; if Tally
// isn't open, the company isn't loaded, or the period is too narrow to
// contain any rows, every revenue, DSO, churn, forecast or SKU-
// penetration metric collapses to zero. Master-data pages (Overview,
// Dealer Profile, India Map dealer counts, P&L / Balance Sheet /
// Trial Balance) keep working from the ledger / accounting /
// financial-statement collections.
export default function VoucherDataNotice({ pageName }) {
  return (
    <div className="glass-card p-4 border-l-4 border-amber-500/70 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-300 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">
            {pageName ? `${pageName} needs voucher data` : 'This page needs voucher data'} — no invoices in the synced period.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            We pull Sales / Purchase / Receipt Register from whichever period TallyPrime currently has loaded for this company. If that period is empty (e.g. a freshly-opened FY) or the registers errored on the last sync, the metrics below stay at zero. Open a period that contains transactions in Tally and re-sync; for ledger-driven receivables intelligence in the meantime, see <span className="text-indigo-300">Overview</span>, and for balance-sheet / P&amp;L / trial-balance see <span className="text-indigo-300">Advanced Analytics</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
