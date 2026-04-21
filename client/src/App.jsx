import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
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

const ACTIVE_PAGE_KEY = 'b2b_active_page';

function DashboardApp() {
  const { user } = useAuth();
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
    setTimeout(() => setSyncing(false), 1500);
  };

  const renderModule = () => {
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
          {renderModule()}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DashboardApp />
    </AuthProvider>
  );
}
