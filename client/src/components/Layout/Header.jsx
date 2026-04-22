import { Search, Bell, RefreshCw, Clock } from 'lucide-react';
import { NAV_ITEMS } from './Sidebar';
import { useAuth } from '../../context/AuthContext';
import { loadLiveCustomers } from '../../lib/liveData';
import CompanySwitcher from './CompanySwitcher';

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export default function Header({ active, searchQuery, onSearchChange, onRefresh, syncing }) {
  const { user, isDemo } = useAuth();
  const currentPage = NAV_ITEMS.find(n => n.id === active);
  const live = !isDemo ? loadLiveCustomers(user?.email) : null;
  const lastSync = live?.syncedAt;
  const rangeLabel = live?.totals?.range;
  const statusLabel = isDemo ? 'Demo' : live ? 'Live' : 'No data';
  const dotClass = isDemo ? 'bg-indigo-400' : live ? 'bg-emerald-500' : 'bg-gray-500';

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-gray-800/60 bg-gray-900/40 backdrop-blur flex-shrink-0">
      <div className="flex items-center gap-3">
        {currentPage && <currentPage.icon size={18} className="text-indigo-400" />}
        <h2 className="text-base font-semibold text-white">{currentPage?.label || 'Dashboard'}</h2>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" placeholder="Search customers..."
            value={searchQuery} onChange={e => onSearchChange(e.target.value)}
            className="bg-gray-800/60 border border-gray-700/50 rounded-lg pl-9 pr-4 py-1.5 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-indigo-500 w-56 transition-colors"
          />
        </div>
        <CompanySwitcher />
        <button onClick={onRefresh} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/50 transition-all" title="Refresh data">
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
        </button>
        {lastSync && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400" title={`Last synced at ${new Date(lastSync).toLocaleString()}`}>
            <Clock size={13} className="text-indigo-300" />
            <span>
              {rangeLabel ? `${rangeLabel} · ` : ''}synced {timeAgo(lastSync)}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className={`w-2 h-2 rounded-full ${dotClass}`} />
          <span>{statusLabel}</span>
        </div>
      </div>
    </header>
  );
}
