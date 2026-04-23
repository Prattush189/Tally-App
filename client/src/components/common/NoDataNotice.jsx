import { Database } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// Rendered on every dashboard page when no live Tally snapshot exists.
// Previously had a "Continue as Demo" shortcut that pretended the demo
// account had data; that's been removed — demo accounts now hit this same
// notice until they sync their own Tally, matching the no-mock policy.
export default function NoDataNotice({ onNavigate }) {
  const { user } = useAuth();
  const email = user?.email || '';

  return (
    <div className="flex items-center justify-center h-full">
      <div className="glass-card max-w-xl p-8 text-center space-y-5">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/20">
          <Database size={24} className="text-indigo-300" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">No Tally data synced yet {email && <>for <span className="text-indigo-300">{email}</span></>}</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Every dashboard reads from your live Tally sync — no sample data is bundled. Connect your Tally Prime server below and click <b>Sync Now</b> to populate ledgers, vouchers, stock items, and the six AI-powered Actions &amp; Outreach pages.
          </p>
        </div>
        <div className="flex justify-center pt-2">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('tally')}
              className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
            >
              Connect Tally
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
