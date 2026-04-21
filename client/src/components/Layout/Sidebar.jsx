import { Activity, BarChart3, AlertTriangle, ShieldAlert, TrendingUp, Zap, DollarSign, Bell, Target, RefreshCw, ChevronRight, Brain, LogOut, Map, CalendarRange, Star, Layers, Phone, UserPlus, Clock, Lightbulb, Heart, Package, Megaphone, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const NAV_SECTIONS = [
  { title: 'Core Analytics', items: [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'dealer-profile', label: 'Dealer Analytics', icon: User },
    { id: 'churn', label: 'Churn Detection', icon: AlertTriangle },
    { id: 'payment', label: 'Payment Health', icon: ShieldAlert },
    { id: 'growth', label: 'Growth Engine', icon: TrendingUp },
    { id: 'opportunity', label: 'Opportunities', icon: Zap },
    { id: 'revenue', label: 'Revenue Metrics', icon: DollarSign },
  ]},
  { title: 'Intelligence', items: [
    { id: 'india-map', label: 'India Map', icon: Map },
    { id: 'forecast', label: 'Purchase Forecast', icon: CalendarRange },
    { id: 'toy-categories', label: 'Toy Categories', icon: Star },
    { id: 'area-sku', label: 'Area SKU Analysis', icon: Layers },
    { id: 'customer-health', label: 'Customer Health', icon: Heart },
    { id: 'advanced', label: 'Advanced Analytics', icon: Brain },
  ]},
  { title: 'Actions & Outreach', items: [
    { id: 'contact-priority', label: 'Contact Priority', icon: Phone },
    { id: 'dealer-suggestions', label: 'New Dealers', icon: UserPlus },
    { id: 'payment-reminders', label: 'Payment Reminders', icon: Clock },
    { id: 'revenue-suggestions', label: 'Revenue Ideas', icon: Lightbulb },
    { id: 'proactive', label: 'Proactive System', icon: Bell },
    { id: 'action', label: 'Action Focus', icon: Target },
  ]},
  { title: 'Operations', items: [
    { id: 'inventory', label: 'Inventory Budget', icon: Package },
    { id: 'marketing-budget', label: 'Marketing Budget', icon: Megaphone },
    { id: 'tally', label: 'Tally Sync', icon: RefreshCw },
  ]},
];

const NAV_ITEMS = NAV_SECTIONS.flatMap(s => s.items);

export default function Sidebar({ active, onNavigate, collapsed, onToggle }) {
  const { user, logout } = useAuth();

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} flex-shrink-0 bg-gray-900/80 backdrop-blur border-r border-gray-800/60 flex flex-col transition-all duration-300`}>
      {/* Logo */}
      <div className="p-4 border-b border-gray-800/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <Activity size={20} className="text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white truncate">B2B Intelligence</h1>
              <p className="text-xs text-gray-500 truncate">Invoice-Driven Analytics</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 px-2 overflow-y-auto">
        {NAV_SECTIONS.map(section => (
          <div key={section.title} className="mb-1">
            {!collapsed && <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">{section.title}</p>}
            {collapsed && <div className="border-t border-gray-800/40 my-1.5" />}
            <div className="space-y-0.5">
              {section.items.map(item => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id} onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                      isActive ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 border border-transparent'
                    }`}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon size={16} className="flex-shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User & Collapse */}
      <div className="border-t border-gray-800/60 p-3 space-y-2">
        {!collapsed && user && (
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300 flex-shrink-0">
              {user.avatar}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white truncate">{user.name}</p>
              <p className="text-xs text-gray-500 truncate">{user.role}</p>
            </div>
            <button onClick={logout} className="text-gray-500 hover:text-red-400 transition-colors" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        )}
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-all"
        >
          <ChevronRight size={14} className={`transition-transform ${!collapsed ? 'rotate-180' : ''}`} />
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}

export { NAV_ITEMS };
