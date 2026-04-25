import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FiltersProvider } from './context/FiltersContext';
import { TallyDataProvider, useTallyData } from './context/TallyDataContext';
import LoginPage from './components/Auth/LoginPage';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import Overview from './components/Dashboard/Overview';
import ChurnDetection from './components/ChurnDetection/ChurnDetection';
import PaymentHealth from './components/PaymentHealth/PaymentHealth';
import GrowthEngine from './components/GrowthEngine/GrowthEngine';
import OpportunityIntelligence from './components/OpportunityIntelligence/OpportunityIntelligence';
import RevenueMetrics from './components/RevenueMetrics/RevenueMetrics';
import ProactiveSystem from './components/ProactiveSystem/ProactiveSystem';
import ActionFocus from './components/ActionFocus/ActionFocus';
import AdvancedAnalytics from './components/AdvancedAnalytics/AdvancedAnalytics';
import TallySync from './components/TallySync/TallySync';
import IndiaMap from './components/IndiaMap/IndiaMap';
import PurchaseForecast from './components/PurchaseForecast/PurchaseForecast';
import ToyCategoryScore from './components/ToyCategoryScore/ToyCategoryScore';
import AreaSKU from './components/AreaSKU/AreaSKU';
import ContactPriority from './components/ContactPriority/ContactPriority';
import DealerSuggestions from './components/DealerSuggestions/DealerSuggestions';
import PaymentReminders from './components/PaymentReminders/PaymentReminders';
import RevenueSuggestions from './components/RevenueSuggestions/RevenueSuggestions';
import CustomerHealth from './components/CustomerHealth/CustomerHealth';
import InventoryBudget from './components/InventoryBudget/InventoryBudget';
import MarketingBudget from './components/MarketingBudget/MarketingBudget';
import DealerProfile from './components/DealerProfile/DealerProfile';
import NoDataNotice from './components/common/NoDataNotice';
import LoadingSpinner from './components/common/LoadingSpinner';
import VoucherDataNotice from './components/common/VoucherDataNotice';

const ACTIVE_PAGE_KEY = 'b2b_active_page';

// Pages whose primary metrics come from sales / receipt vouchers. When the
// snapshot has no voucher data (Day Book disabled), each of these renders
// the VoucherDataNotice above its body so the user knows why every revenue
// / DSO / churn / SKU / forecast tile collapses to zero.
const VOUCHER_PAGES = new Set([
  'churn', 'payment', 'growth', 'opportunity', 'revenue',
  'forecast', 'toy-categories', 'area-sku', 'customer-health',
  'contact-priority', 'dealer-suggestions', 'payment-reminders',
  'revenue-suggestions', 'proactive', 'action',
  'inventory', 'marketing-budget',
]);

const PAGE_LABELS = {
  churn: 'Churn Detection',
  payment: 'Payment Health',
  growth: 'Growth Engine',
  opportunity: 'Opportunities',
  revenue: 'Revenue Metrics',
  forecast: 'Purchase Forecast',
  'toy-categories': 'Toy Categories',
  'area-sku': 'Area SKU Analysis',
  'customer-health': 'Customer Health',
  'contact-priority': 'Contact Priority',
  'dealer-suggestions': 'New Dealers',
  'payment-reminders': 'Payment Reminders',
  'revenue-suggestions': 'Revenue Ideas',
  proactive: 'Proactive System',
  action: 'Action Focus',
  inventory: 'Inventory Budget',
  'marketing-budget': 'Marketing Budget',
};

function hasVoucherData(customers) {
  for (const c of customers) {
    if (c.totalOrders > 0) return true;
    const hist = c.invoiceHistory;
    if (Array.isArray(hist)) {
      for (const m of hist) if ((m?.value || 0) > 0 || (m?.invoiceCount || 0) > 0) return true;
    }
  }
  return false;
}

function DashboardApp() {
  const { user } = useAuth();
  // Snapshot comes from Supabase now — no localStorage cache. `hasLiveData`
  // flips true as soon as the cloud snapshot lands, so dashboards unlock
  // automatically (no per-browser storage quota, no staleness between tabs).
  const { customers, loading: tallyLoading, refresh: refreshTally } = useTallyData();
  const hasLiveData = customers.length > 0;
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem(ACTIVE_PAGE_KEY) || 'overview'; }
    catch { return 'overview'; }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_PAGE_KEY, active); } catch { /* quota / private mode */ }
  }, [active]);

  if (!user) return <LoginPage />;

  const handleRefresh = () => {
    setSyncing(true);
    refreshTally().finally(() => setSyncing(false));
  };

  const ledgerOnly = hasLiveData && !hasVoucherData(customers);
  const showVoucherNotice = ledgerOnly && VOUCHER_PAGES.has(active);

  const renderModule = () => {
    // Tally Sync is always accessible — it's how users wire up their data.
    // While the first cloud fetch is in flight show a spinner instead of the
    // empty-state notice, so the Overview page doesn't flash "no data synced"
    // for the ~500 ms the snapshot takes to land.
    if (active !== 'tally' && !hasLiveData) {
      if (tallyLoading) return <LoadingSpinner message="Loading your Tally snapshot..." />;
      return <NoDataNotice onNavigate={setActive} />;
    }
    switch (active) {
      case 'overview': return <Overview />;
      case 'churn': return <ChurnDetection />;
      case 'payment': return <PaymentHealth />;
      case 'growth': return <GrowthEngine />;
      case 'opportunity': return <OpportunityIntelligence />;
      case 'revenue': return <RevenueMetrics />;
      case 'proactive': return <ProactiveSystem />;
      case 'action': return <ActionFocus />;
      case 'advanced': return <AdvancedAnalytics />;
      case 'tally': return <TallySync />;
      case 'india-map': return <IndiaMap />;
      case 'forecast': return <PurchaseForecast />;
      case 'toy-categories': return <ToyCategoryScore />;
      case 'area-sku': return <AreaSKU />;
      case 'contact-priority': return <ContactPriority />;
      case 'dealer-suggestions': return <DealerSuggestions />;
      case 'payment-reminders': return <PaymentReminders />;
      case 'revenue-suggestions': return <RevenueSuggestions />;
      case 'customer-health': return <CustomerHealth />;
      case 'inventory': return <InventoryBudget />;
      case 'marketing-budget': return <MarketingBudget />;
      case 'dealer-profile': return <DealerProfile />;
      default: return <Overview />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <Sidebar active={active} onNavigate={setActive} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(s => !s)} />
      <main className="flex-1 flex flex-col min-w-0">
        <Header active={active} searchQuery={searchQuery} onSearchChange={setSearchQuery} onRefresh={handleRefresh} syncing={syncing} />
        <div className="flex-1 overflow-y-auto p-6">
          {showVoucherNotice && <VoucherDataNotice pageName={PAGE_LABELS[active]} />}
          {renderModule()}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TallyDataProvider>
        <FiltersProvider>
          <DashboardApp />
        </FiltersProvider>
      </TallyDataProvider>
    </AuthProvider>
  );
}
