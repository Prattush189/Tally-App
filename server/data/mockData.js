import bcrypt from 'bcryptjs';

// ─── USERS ──────────────────────────────────────────────────────────────────
const passwordHash = bcrypt.hashSync('admin123', 10);
const demoHash = bcrypt.hashSync('demo2026', 10);

export const users = [
  { id: 1, email: 'admin@b2bintel.com', password: passwordHash, name: 'Vaibhav Jain', role: 'admin', avatar: 'VJ' },
  { id: 2, email: 'demo@b2bintel.com', password: demoHash, name: 'Demo User', role: 'viewer', avatar: 'DU' },
];

// ─── CATEGORIES & SKUS ─────────────────────────────────────────────────────
export const CATEGORIES = [
  'Electronics', 'Stationery', 'Packaging', 'Chemicals', 'Hardware',
  'Textiles', 'Food & Bev', 'Pharma', 'Auto Parts', 'Plastics', 'Paper', 'Safety Gear'
];

export const SKUS = Array.from({ length: 50 }, (_, i) => ({
  id: `SKU-${String(i + 1).padStart(3, '0')}`,
  name: `Product ${i + 1}`,
  category: CATEGORIES[i % CATEGORIES.length],
  price: Math.round((50 + Math.random() * 500) * 100) / 100,
  avgMonthlyUnits: Math.floor(20 + Math.random() * 200),
  margin: Math.round((15 + Math.random() * 35) * 10) / 10,
}));

// ─── CUSTOMERS ──────────────────────────────────────────────────────────────
const customerNames = [
  'Apex Industries', 'BrightStar Corp', 'ClearView Trading', 'Delta Supplies',
  'EcoTech Solutions', 'FairTrade Pvt Ltd', 'GlobalLink Inc', 'Horizon Distributors',
  'InnovatePro Ltd', 'JetStream Traders', 'Keystone Mfg', 'Landmark Exports',
  'MetroMart Wholesale', 'NovaTech Systems', 'OmniSource Ltd', 'PrimePath Traders',
  'QuantumLeap Inc', 'RapidGrowth Co', 'SilverLine Dist', 'TrueValue Supplies',
  'UltraMax Corp', 'VisionCraft Ltd', 'WavePoint Trading', 'XcelPro Industries',
  'YieldMax Traders', 'ZenithPeak Co', 'AlphaEdge Ltd', 'BetaWorks Inc',
  'CoreSync Pvt Ltd', 'DynaFlow Trading', 'EliteCraft Co', 'FusionHub Ltd',
  'GreenPath Supplies', 'HyperDrive Inc', 'IronClad Mfg', 'JadeStone Exports',
  'KinetX Solutions', 'LumiTech Corp', 'MavenPro Trading', 'NextWave Dist',
  'OptiCore Ltd', 'PulsePoint Inc', 'QuickTrade Co', 'RiseUp Industries',
  'SnapTech Pvt Ltd', 'TerraFirm Supplies', 'UniPro Traders', 'VoltEdge Corp',
  'WarpSpeed Ltd', 'Xenon Dynamics'
];

function generateCustomers() {
  return customerNames.map((name, i) => {
    const segment = ['Enterprise', 'Mid-Market', 'SMB'][i % 3];
    const region = ['North', 'South', 'East', 'West'][i % 4];
    const city = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Pune', 'Hyderabad', 'Kolkata', 'Ahmedabad'][i % 8];
    const monthlyAvg = segment === 'Enterprise' ? 80000 + Math.random() * 120000
      : segment === 'Mid-Market' ? 30000 + Math.random() * 50000
      : 5000 + Math.random() * 25000;

    const trend = Math.random();
    const churnRisk = trend < 0.15 ? 'High' : trend < 0.4 ? 'Medium' : 'Low';
    const paymentRisk = Math.random() < 0.12 ? 'High' : Math.random() < 0.35 ? 'Medium' : 'Low';
    const dso = paymentRisk === 'High' ? 75 + Math.random() * 40
      : paymentRisk === 'Medium' ? 40 + Math.random() * 35
      : 15 + Math.random() * 25;

    const skuCount = Math.floor(5 + Math.random() * 30);
    const catCount = Math.floor(2 + Math.random() * 8);
    const skuPenetration = Math.round((skuCount / 50) * 100);
    const catPenetration = Math.round((catCount / CATEGORIES.length) * 100);
    const expansionScore = Math.round(20 + Math.random() * 80);

    const lastOrderDays = churnRisk === 'High' ? 30 + Math.floor(Math.random() * 60)
      : churnRisk === 'Medium' ? 10 + Math.floor(Math.random() * 30)
      : Math.floor(Math.random() * 15);

    const orderFreqDecline = churnRisk === 'High' ? 25 + Math.random() * 35
      : churnRisk === 'Medium' ? 5 + Math.random() * 20
      : -5 + Math.random() * 10;

    const revenueChange = churnRisk === 'High' ? -(15 + Math.random() * 30)
      : churnRisk === 'Medium' ? -(5 + Math.random() * 15)
      : -5 + Math.random() * 20;

    const purchasedCategories = CATEGORIES.slice(0, catCount);
    const missedCategories = CATEGORIES.filter(c => !purchasedCategories.includes(c));
    const ltv = Math.round(monthlyAvg * (12 + Math.random() * 36));

    // 12-month invoice history
    const months = ['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr'];
    const invoiceHistory = months.map((month, m) => {
      const base = monthlyAvg * (1 + revenueChange / 100 * (m - 6) / 6);
      return { month, value: Math.round(Math.max(0, base + (Math.random() - 0.5) * base * 0.3)), invoiceCount: Math.floor(2 + Math.random() * 8) };
    });

    // Payment history
    const paymentHistory = months.map((month, m) => ({
      month,
      onTime: Math.round(70 + (paymentRisk === 'Low' ? 20 : paymentRisk === 'Medium' ? 5 : -15) + Math.random() * 10),
      late: Math.round(10 + (paymentRisk === 'High' ? 20 : paymentRisk === 'Medium' ? 10 : 0) + Math.random() * 5),
      dso: Math.round(dso + (Math.random() - 0.5) * 15),
    }));

    const churnReasons = [];
    if (orderFreqDecline > 15) churnReasons.push('Order frequency declining');
    if (lastOrderDays > 30) churnReasons.push(`No orders in ${lastOrderDays} days`);
    if (revenueChange < -15) churnReasons.push(`Invoice value dropping ${Math.abs(Math.round(revenueChange))}%`);
    if (catCount < 3) churnReasons.push('Low category engagement');
    if (skuPenetration < 20) churnReasons.push('Very low SKU adoption');

    // Churn probability score (0-100)
    let churnScore = 0;
    churnScore += Math.min(30, lastOrderDays);
    churnScore += Math.max(0, orderFreqDecline) * 0.8;
    churnScore += Math.max(0, -revenueChange) * 0.6;
    churnScore += (100 - skuPenetration) * 0.1;
    churnScore += (100 - catPenetration) * 0.1;
    churnScore = Math.min(99, Math.max(1, Math.round(churnScore)));

    return {
      id: i + 1, name, segment, region, city,
      gstin: `${22 + (i % 15)}AAAAA${String(i).padStart(4,'0')}A1Z${i % 10}`,
      monthlyAvg: Math.round(monthlyAvg),
      churnRisk, churnScore, churnReasons: churnReasons.length ? churnReasons : ['Stable purchasing pattern'],
      paymentRisk, dso: Math.round(dso),
      agingCurrent: Math.round(monthlyAvg * (0.3 + Math.random() * 0.3)),
      aging30: Math.round(monthlyAvg * Math.random() * 0.25),
      aging60: Math.round(monthlyAvg * Math.random() * 0.15),
      aging90: paymentRisk !== 'Low' ? Math.round(monthlyAvg * Math.random() * 0.1) : 0,
      skuCount, catCount, skuPenetration, catPenetration, expansionScore,
      purchasedCategories, missedCategories,
      lastOrderDays, orderFreqDecline: Math.round(orderFreqDecline * 10) / 10,
      revenueChange: Math.round(revenueChange * 10) / 10,
      ltv, invoiceHistory, paymentHistory,
      actionWindow: churnRisk === 'High' ? 'This week' : churnRisk === 'Medium' ? 'This month' : 'Quarterly review',
      paymentTrend: paymentRisk === 'High' ? 'Worsening' : paymentRisk === 'Medium' ? 'Flat' : 'Improving',
      lastContacted: Math.floor(Math.random() * 45),
      totalOrders: Math.floor(50 + Math.random() * 500),
      avgOrderValue: Math.round(monthlyAvg / (3 + Math.random() * 5)),
      creditLimit: Math.round(monthlyAvg * (2 + Math.random() * 3)),
      outstandingAmount: Math.round(monthlyAvg * (0.5 + Math.random() * 1.5)),
      joinedDate: `20${20 + Math.floor(Math.random() * 5)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2,'0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2,'0')}`,
    };
  });
}

export const customers = generateCustomers();

// ─── REVENUE TRENDS ─────────────────────────────────────────────────────────
export const revenueTrends = [
  { month: "May '25", revenue: 2850000, nrr: 104, grr: 91, newCustomers: 3, churnedCustomers: 1 },
  { month: "Jun '25", revenue: 2980000, nrr: 106, grr: 92, newCustomers: 2, churnedCustomers: 0 },
  { month: "Jul '25", revenue: 3050000, nrr: 107, grr: 91, newCustomers: 4, churnedCustomers: 2 },
  { month: "Aug '25", revenue: 3120000, nrr: 108, grr: 93, newCustomers: 1, churnedCustomers: 1 },
  { month: "Sep '25", revenue: 3000000, nrr: 105, grr: 90, newCustomers: 2, churnedCustomers: 3 },
  { month: "Oct '25", revenue: 3200000, nrr: 108, grr: 92, newCustomers: 3, churnedCustomers: 1 },
  { month: "Nov '25", revenue: 3350000, nrr: 110, grr: 93, newCustomers: 5, churnedCustomers: 2 },
  { month: "Dec '25", revenue: 3450000, nrr: 112, grr: 94, newCustomers: 2, churnedCustomers: 1 },
  { month: "Jan '26", revenue: 3100000, nrr: 105, grr: 90, newCustomers: 1, churnedCustomers: 2 },
  { month: "Feb '26", revenue: 3380000, nrr: 110, grr: 93, newCustomers: 3, churnedCustomers: 1 },
  { month: "Mar '26", revenue: 3520000, nrr: 114, grr: 95, newCustomers: 4, churnedCustomers: 0 },
  { month: "Apr '26", revenue: 3680000, nrr: 116, grr: 96, newCustomers: 3, churnedCustomers: 1 },
];

// ─── COHORT DATA ────────────────────────────────────────────────────────────
export const cohortData = [
  { cohort: 'Q1 2024', month1: 100, month3: 95, month6: 88, month9: 82, month12: 78, expanded: 22, contracted: 8 },
  { cohort: 'Q2 2024', month1: 100, month3: 93, month6: 86, month9: 80, month12: 75, expanded: 18, contracted: 12 },
  { cohort: 'Q3 2024', month1: 100, month3: 96, month6: 91, month9: 85, month12: 81, expanded: 25, contracted: 10 },
  { cohort: 'Q4 2024', month1: 100, month3: 94, month6: 89, month9: 83, month12: 79, expanded: 20, contracted: 15 },
  { cohort: 'Q1 2025', month1: 100, month3: 97, month6: 92, month9: 87, month12: null, expanded: 28, contracted: 7 },
  { cohort: 'Q2 2025', month1: 100, month3: 95, month6: 90, month9: null, month12: null, expanded: 24, contracted: 9 },
  { cohort: 'Q3 2025', month1: 100, month3: 94, month6: null, month9: null, month12: null, expanded: 20, contracted: 11 },
  { cohort: 'Q4 2025', month1: 100, month3: 96, month6: null, month9: null, month12: null, expanded: 26, contracted: 8 },
  { cohort: 'Q1 2026', month1: 100, month3: null, month6: null, month9: null, month12: null, expanded: 30, contracted: 5 },
];

// ─── ADVANCED ANALYTICS ─────────────────────────────────────────────────────
export function computeAdvancedAnalytics(customerList) {
  const segments = ['Enterprise', 'Mid-Market', 'SMB'];
  const regions = ['North', 'South', 'East', 'West'];

  // RFM Scoring
  const rfmScores = customerList.map(c => {
    const recency = Math.max(0, 100 - c.lastOrderDays * 2);
    const frequency = Math.min(100, c.totalOrders / 5);
    const monetary = Math.min(100, c.monthlyAvg / 2000);
    const rfmScore = Math.round((recency * 0.35 + frequency * 0.3 + monetary * 0.35));
    let rfmSegment = 'At Risk';
    if (rfmScore > 75) rfmSegment = 'Champions';
    else if (rfmScore > 55) rfmSegment = 'Loyal';
    else if (rfmScore > 40) rfmSegment = 'Potential';
    else if (rfmScore > 25) rfmSegment = 'Needs Attention';
    return { ...c, recencyScore: recency, frequencyScore: frequency, monetaryScore: monetary, rfmScore, rfmSegment };
  });

  // Segment health
  const segmentHealth = segments.map(seg => {
    const segCustomers = customerList.filter(c => c.segment === seg);
    return {
      segment: seg,
      count: segCustomers.length,
      avgRevenue: Math.round(segCustomers.reduce((s, c) => s + c.monthlyAvg, 0) / segCustomers.length),
      avgDSO: Math.round(segCustomers.reduce((s, c) => s + c.dso, 0) / segCustomers.length),
      avgChurnScore: Math.round(segCustomers.reduce((s, c) => s + c.churnScore, 0) / segCustomers.length),
      avgPenetration: Math.round(segCustomers.reduce((s, c) => s + c.skuPenetration, 0) / segCustomers.length),
      highRisk: segCustomers.filter(c => c.churnRisk === 'High').length,
      totalRevenue: segCustomers.reduce((s, c) => s + c.monthlyAvg, 0),
    };
  });

  // Regional breakdown
  const regionHealth = regions.map(reg => {
    const regCustomers = customerList.filter(c => c.region === reg);
    return {
      region: reg,
      count: regCustomers.length,
      avgRevenue: Math.round(regCustomers.reduce((s, c) => s + c.monthlyAvg, 0) / regCustomers.length),
      avgDSO: Math.round(regCustomers.reduce((s, c) => s + c.dso, 0) / regCustomers.length),
      churnRate: Math.round(regCustomers.filter(c => c.churnRisk === 'High').length / regCustomers.length * 100),
      totalRevenue: regCustomers.reduce((s, c) => s + c.monthlyAvg, 0),
    };
  });

  // Revenue concentration (Pareto)
  const sortedByRev = [...customerList].sort((a, b) => b.monthlyAvg - a.monthlyAvg);
  const totalRev = sortedByRev.reduce((s, c) => s + c.monthlyAvg, 0);
  let cumulative = 0;
  const paretoData = sortedByRev.map((c, i) => {
    cumulative += c.monthlyAvg;
    return { name: c.name, revenue: c.monthlyAvg, cumulativePercent: Math.round(cumulative / totalRev * 100), rank: i + 1 };
  });

  // Customer health matrix (churn vs payment risk)
  const healthMatrix = [
    { churnRisk: 'High', payHigh: customerList.filter(c => c.churnRisk === 'High' && c.paymentRisk === 'High').length, payMed: customerList.filter(c => c.churnRisk === 'High' && c.paymentRisk === 'Medium').length, payLow: customerList.filter(c => c.churnRisk === 'High' && c.paymentRisk === 'Low').length },
    { churnRisk: 'Medium', payHigh: customerList.filter(c => c.churnRisk === 'Medium' && c.paymentRisk === 'High').length, payMed: customerList.filter(c => c.churnRisk === 'Medium' && c.paymentRisk === 'Medium').length, payLow: customerList.filter(c => c.churnRisk === 'Medium' && c.paymentRisk === 'Low').length },
    { churnRisk: 'Low', payHigh: customerList.filter(c => c.churnRisk === 'Low' && c.paymentRisk === 'High').length, payMed: customerList.filter(c => c.churnRisk === 'Low' && c.paymentRisk === 'Medium').length, payLow: customerList.filter(c => c.churnRisk === 'Low' && c.paymentRisk === 'Low').length },
  ];

  // Correlation data: penetration vs revenue
  const correlationData = customerList.map(c => ({
    name: c.name, skuPenetration: c.skuPenetration, catPenetration: c.catPenetration,
    monthlyRevenue: c.monthlyAvg, churnScore: c.churnScore, dso: c.dso, segment: c.segment,
  }));

  // RFM distribution
  const rfmDist = ['Champions', 'Loyal', 'Potential', 'Needs Attention', 'At Risk'].map(seg => ({
    segment: seg, count: rfmScores.filter(c => c.rfmSegment === seg).length,
    avgRevenue: Math.round((rfmScores.filter(c => c.rfmSegment === seg).reduce((s, c) => s + c.monthlyAvg, 0) || 0) / (rfmScores.filter(c => c.rfmSegment === seg).length || 1)),
  }));

  return { rfmScores, segmentHealth, regionHealth, paretoData, healthMatrix, correlationData, rfmDist };
}
