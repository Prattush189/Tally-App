import { AlertTriangle } from 'lucide-react';

// Drop-in banner that explains why a dashboard's voucher-driven metrics are
// empty. Rendered above any page whose KPIs / charts depend on sales /
// receipt vouchers — Day Book is currently disabled on this dataset
// (TallyPrime c0000005 crash on the voucher tree), so revenue, DSO, churn,
// SKU penetration, forecasts and similar trend-style numbers all collapse
// to zero. Master-data pages (Overview, Dealer Profile, India Map dealer
// counts, P&L / Balance Sheet / Trial Balance) keep working from the
// ledger / accounting / financial-statement collections that DO sync.
export default function VoucherDataNotice({ pageName }) {
  return (
    <div className="glass-card p-4 border-l-4 border-amber-500/70 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-300 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">
            {pageName ? `${pageName} needs voucher data` : 'This page needs voucher data'} — Day Book is paused on this dataset.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            Sales / receipt vouchers can&apos;t be fetched from this Tally install (c0000005 crash on the voucher tree), so every revenue, DSO, churn, forecast, SKU-penetration or trend metric below is zero. The numbers will fill in automatically once vouchers can be synced again. For ledger-driven receivables intelligence, see <span className="text-indigo-300">Overview</span>; for balance-sheet / P&amp;L / trial-balance, see <span className="text-indigo-300">Advanced Analytics</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
