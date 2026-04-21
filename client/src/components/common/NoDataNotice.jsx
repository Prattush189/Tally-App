import { Database, LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { DEMO_EMAIL } from '../../utils/demo';

// Rendered for real (non-demo) users on every dashboard page. We deliberately
// don't populate their dashboards with mock numbers — seeing fake data on a
// real account is misleading. When the live Tally pipeline lands, this
// component is replaced by real charts.
export default function NoDataNotice({ onNavigate }) {
  const { loginAsDemo, logout, user } = useAuth();
  const email = user?.email || '';

  const handleTryDemo = async () => {
    await logout();
    try { await loginAsDemo(); } catch { /* handled in login page */ }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="glass-card max-w-xl p-8 text-center space-y-5">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/20">
          <Database size={24} className="text-indigo-300" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">No data yet for <span className="text-indigo-300">{email}</span></h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Your account is live on Supabase, but no invoice data has been ingested yet.
            Connect your Tally Prime server to start pulling real dealer, invoice, and payment data into the dashboards.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('tally')}
              className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
            >
              Connect Tally
            </button>
          )}
          <button
            type="button"
            onClick={handleTryDemo}
            className="inline-flex items-center justify-center gap-2 border border-gray-600/60 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-gray-200 text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
          >
            <LogIn size={15} /> Explore with demo account
          </button>
        </div>
        <p className="text-xs text-gray-500 pt-2">
          Demo credentials (shown on the login page) unlock sample data across all 22 modules.
        </p>
      </div>
    </div>
  );
}
