import { customers, CATEGORIES, SKUS } from './mockData.js';

// ─── INDIA GEO DATA (States + Cities with coordinates for map) ──────────────
export const INDIA_STATES = [
  { state: 'Maharashtra', code: 'MH', x: 280, y: 380, cities: ['Mumbai', 'Pune', 'Nagpur'] },
  { state: 'Delhi', code: 'DL', x: 310, y: 180, cities: ['New Delhi'] },
  { state: 'Karnataka', code: 'KA', x: 270, y: 470, cities: ['Bangalore', 'Mysore'] },
  { state: 'Tamil Nadu', code: 'TN', x: 300, y: 540, cities: ['Chennai', 'Coimbatore'] },
  { state: 'Gujarat', code: 'GJ', x: 215, y: 310, cities: ['Ahmedabad', 'Surat'] },
  { state: 'Rajasthan', code: 'RJ', x: 240, y: 230, cities: ['Jaipur', 'Udaipur'] },
  { state: 'Uttar Pradesh', code: 'UP', x: 360, y: 220, cities: ['Lucknow', 'Varanasi', 'Noida'] },
  { state: 'West Bengal', code: 'WB', x: 460, y: 310, cities: ['Kolkata'] },
  { state: 'Telangana', code: 'TS', x: 310, y: 420, cities: ['Hyderabad'] },
  { state: 'Kerala', code: 'KL', x: 265, y: 560, cities: ['Kochi', 'Trivandrum'] },
  { state: 'Madhya Pradesh', code: 'MP', x: 320, y: 300, cities: ['Bhopal', 'Indore'] },
  { state: 'Punjab', code: 'PB', x: 275, y: 155, cities: ['Chandigarh', 'Ludhiana'] },
  { state: 'Bihar', code: 'BR', x: 430, y: 260, cities: ['Patna'] },
  { state: 'Odisha', code: 'OD', x: 410, y: 370, cities: ['Bhubaneswar'] },
  { state: 'Assam', code: 'AS', x: 530, y: 230, cities: ['Guwahati'] },
  { state: 'Jharkhand', code: 'JH', x: 420, y: 300, cities: ['Ranchi'] },
  { state: 'Haryana', code: 'HR', x: 290, y: 175, cities: ['Gurugram'] },
  { state: 'Chhattisgarh', code: 'CG', x: 370, y: 340, cities: ['Raipur'] },
];

export function generateMapAnalytics() {
  return INDIA_STATES.map(s => {
    const stateCustomers = Math.floor(2 + Math.random() * 15);
    const revenue = Math.round((200000 + Math.random() * 2000000));
    const dealers = Math.floor(1 + Math.random() * 10);
    const growth = Math.round((-15 + Math.random() * 35) * 10) / 10;
    const topCategory = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const avgOrderValue = Math.round(revenue / (stateCustomers * (3 + Math.random() * 5)));
    return {
      ...s, customers: stateCustomers, revenue, dealers, growth, topCategory, avgOrderValue,
      penetration: Math.round(Math.random() * 100),
      churnRisk: Math.random() < 0.2 ? 'High' : Math.random() < 0.5 ? 'Medium' : 'Low',
      avgDSO: Math.round(20 + Math.random() * 50),
    };
  });
}

// ─── TOY CATEGORIES (more specific than generic categories) ─────────────────
export const TOY_CATEGORIES = [
  { id: 1, name: 'Action Figures', avgPrice: 450, margin: 32, seasonality: 'year-round', peakMonths: ['Oct', 'Nov', 'Dec'] },
  { id: 2, name: 'Board Games', avgPrice: 650, margin: 38, seasonality: 'winter', peakMonths: ['Nov', 'Dec', 'Jan'] },
  { id: 3, name: 'Building Blocks', avgPrice: 800, margin: 35, seasonality: 'year-round', peakMonths: ['Oct', 'Dec', 'Mar'] },
  { id: 4, name: 'Dolls & Accessories', avgPrice: 550, margin: 30, seasonality: 'year-round', peakMonths: ['Oct', 'Nov', 'Mar'] },
  { id: 5, name: 'Educational Toys', avgPrice: 380, margin: 42, seasonality: 'back-to-school', peakMonths: ['Jun', 'Jul', 'Aug'] },
  { id: 6, name: 'Electronic Toys', avgPrice: 1200, margin: 28, seasonality: 'festive', peakMonths: ['Oct', 'Nov', 'Dec'] },
  { id: 7, name: 'Outdoor & Sports', avgPrice: 700, margin: 33, seasonality: 'summer', peakMonths: ['Mar', 'Apr', 'May'] },
  { id: 8, name: 'Plush Toys', avgPrice: 320, margin: 45, seasonality: 'year-round', peakMonths: ['Feb', 'Oct', 'Dec'] },
  { id: 9, name: 'Puzzles', avgPrice: 280, margin: 48, seasonality: 'winter', peakMonths: ['Nov', 'Dec', 'Jan'] },
  { id: 10, name: 'RC & Vehicles', avgPrice: 950, margin: 25, seasonality: 'festive', peakMonths: ['Oct', 'Nov', 'Dec'] },
  { id: 11, name: 'Art & Craft', avgPrice: 250, margin: 50, seasonality: 'back-to-school', peakMonths: ['Jun', 'Jul', 'Mar'] },
  { id: 12, name: 'Baby & Toddler', avgPrice: 420, margin: 36, seasonality: 'year-round', peakMonths: ['Jan', 'Apr', 'Sep'] },
];

export function generateToyCategoryScores() {
  return TOY_CATEGORIES.map(cat => {
    const totalSales = Math.round(50000 + Math.random() * 500000);
    const dealerAdoption = Math.round(30 + Math.random() * 70);
    const returnRate = Math.round((1 + Math.random() * 8) * 10) / 10;
    const growthRate = Math.round((-10 + Math.random() * 40) * 10) / 10;
    const competitiveIndex = Math.round(40 + Math.random() * 60);
    const demandScore = Math.round(cat.margin * 0.3 + dealerAdoption * 0.25 + (100 - returnRate * 10) * 0.2 + growthRate * 0.15 + competitiveIndex * 0.1);
    const healthScore = Math.min(100, Math.max(0, demandScore));

    // Monthly breakdown
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthlyData = months.map(m => {
      const isPeak = cat.peakMonths.includes(m);
      const base = totalSales / 12;
      return { month: m, sales: Math.round(base * (isPeak ? 1.5 + Math.random() * 0.5 : 0.6 + Math.random() * 0.4)), isPeak };
    });

    return {
      ...cat, totalSales, dealerAdoption, returnRate, growthRate, competitiveIndex,
      demandScore, healthScore, monthlyData,
      recommendation: healthScore > 70 ? 'Expand' : healthScore > 45 ? 'Maintain' : 'Review',
    };
  });
}

// ─── PURCHASE FORECASTING ───────────────────────────────────────────────────
export function generatePurchaseForecast() {
  const months = ['May 26','Jun 26','Jul 26','Aug 26','Sep 26','Oct 26','Nov 26','Dec 26'];
  return TOY_CATEGORIES.map(cat => {
    const forecasts = months.map((m, i) => {
      const monthName = m.split(' ')[0];
      const isPeak = cat.peakMonths.includes(monthName);
      const base = 30000 + Math.random() * 100000;
      const predicted = Math.round(base * (isPeak ? 1.8 : 0.9) * (1 + i * 0.02));
      const confidence = Math.round(75 + Math.random() * 20);
      return { month: m, predicted, confidence, isPeak, lower: Math.round(predicted * 0.8), upper: Math.round(predicted * 1.2) };
    });
    return { category: cat.name, avgPrice: cat.avgPrice, forecasts, totalForecast: forecasts.reduce((s, f) => s + f.predicted, 0) };
  });
}

// ─── AREA-WISE SKU ANALYSIS ─────────────────────────────────────────────────
export function generateAreaSKUAnalysis() {
  const regions = ['North', 'South', 'East', 'West'];
  const priceRanges = [
    { range: '₹0-200', min: 0, max: 200 },
    { range: '₹200-500', min: 200, max: 500 },
    { range: '₹500-1000', min: 500, max: 1000 },
    { range: '₹1000-2000', min: 1000, max: 2000 },
    { range: '₹2000+', min: 2000, max: 10000 },
  ];

  const priceData = regions.map(region => ({
    region,
    ...Object.fromEntries(priceRanges.map(p => [p.range, Math.floor(5 + Math.random() * 30)])),
    avgPrice: Math.round(300 + Math.random() * 800),
    bestSelling: priceRanges[Math.floor(Math.random() * 3)].range,
  }));

  const categoryData = regions.map(region => ({
    region,
    ...Object.fromEntries(TOY_CATEGORIES.map(c => [c.name, Math.round(Math.random() * 100)])),
    topCategory: TOY_CATEGORIES[Math.floor(Math.random() * TOY_CATEGORIES.length)].name,
    totalSKUs: Math.floor(20 + Math.random() * 40),
  }));

  return { priceData, categoryData, priceRanges, regions };
}

// ─── NEW DEALER SUGGESTIONS ────────────────────────────────────────────────
export function generateDealerSuggestions() {
  const cities = [
    { city: 'Indore', state: 'Madhya Pradesh', region: 'Central' },
    { city: 'Jaipur', state: 'Rajasthan', region: 'North' },
    { city: 'Bhopal', state: 'Madhya Pradesh', region: 'Central' },
    { city: 'Lucknow', state: 'Uttar Pradesh', region: 'North' },
    { city: 'Surat', state: 'Gujarat', region: 'West' },
    { city: 'Coimbatore', state: 'Tamil Nadu', region: 'South' },
    { city: 'Visakhapatnam', state: 'Andhra Pradesh', region: 'South' },
    { city: 'Nagpur', state: 'Maharashtra', region: 'West' },
    { city: 'Patna', state: 'Bihar', region: 'East' },
    { city: 'Ranchi', state: 'Jharkhand', region: 'East' },
    { city: 'Chandigarh', state: 'Punjab', region: 'North' },
    { city: 'Bhubaneswar', state: 'Odisha', region: 'East' },
    { city: 'Dehradun', state: 'Uttarakhand', region: 'North' },
    { city: 'Guwahati', state: 'Assam', region: 'East' },
    { city: 'Vadodara', state: 'Gujarat', region: 'West' },
    { city: 'Mysore', state: 'Karnataka', region: 'South' },
    { city: 'Kochi', state: 'Kerala', region: 'South' },
    { city: 'Varanasi', state: 'Uttar Pradesh', region: 'North' },
    { city: 'Agra', state: 'Uttar Pradesh', region: 'North' },
    { city: 'Nashik', state: 'Maharashtra', region: 'West' },
  ];

  const dealerNames = [
    'Shree Toy Mart', 'Rajesh Distributors', 'Kids Paradise Store', 'Toy Galaxy Trading',
    'Fun Factory Wholesale', 'Happy Kids Supplies', 'Playworld Distributors', 'Tiny Tots Trading Co',
    'Smart Play Wholesale', 'Joy Land Traders', 'Little Stars Dist.', 'Mega Toy House',
    'Super Fun Supplies', 'Bright Minds Trading', 'Kiddo World Store', 'Play Zone Wholesale',
    'Wonder Toys Dist.', 'Dream Play Trading', 'Star Kids Supplies', 'Magic Box Wholesale',
    'Rainbow Toy Mart', 'Golden Toys Hub', 'Kiddies Corner', 'Funville Distributors',
    'ToyTown Wholesale', 'Playtime Partners', 'CheerUp Toys Dist.', 'SmileMart Trading',
    'Whizkid Supplies', 'JoyRide Wholesale',
  ];

  // Generate 30 prospects, show 10 per day
  return dealerNames.map((name, i) => {
    const cityData = cities[i % cities.length];
    const marketSize = Math.round(500000 + Math.random() * 3000000);
    const fitScore = Math.round(50 + Math.random() * 50);
    const estimatedMonthly = Math.round(20000 + Math.random() * 100000);
    const competitorPresence = Math.floor(1 + Math.random() * 5);
    const populationDensity = Math.round(5000 + Math.random() * 25000);
    const categories = TOY_CATEGORIES.slice(0, 3 + Math.floor(Math.random() * 5)).map(c => c.name);

    return {
      id: i + 1, name, ...cityData, marketSize, fitScore, estimatedMonthly,
      competitorPresence, populationDensity, categories,
      contactMethod: ['Phone', 'Visit', 'Email', 'WhatsApp'][Math.floor(Math.random() * 4)],
      reason: fitScore > 80 ? 'High-potential untapped market' : fitScore > 65 ? 'Growing toy demand in area' : 'Strategic location gap',
      priority: fitScore > 80 ? 'High' : fitScore > 65 ? 'Medium' : 'Low',
    };
  });
}

// ─── PAYMENT REMINDERS ──────────────────────────────────────────────────────
export function generatePaymentReminders() {
  return customers.map(c => {
    const avgPaymentCycle = Math.round(20 + Math.random() * 40);
    const lastPaymentDays = Math.floor(Math.random() * 60);
    const overdue = lastPaymentDays > avgPaymentCycle;
    const overdueDays = Math.max(0, lastPaymentDays - avgPaymentCycle);
    const pendingInvoices = Math.floor(1 + Math.random() * 5);
    const totalPending = Math.round(c.monthlyAvg * (0.3 + Math.random() * 1.2));
    const onTimeRate = Math.round(55 + Math.random() * 40);
    const predictedPayDate = new Date();
    predictedPayDate.setDate(predictedPayDate.getDate() + Math.max(0, avgPaymentCycle - lastPaymentDays) + Math.floor(Math.random() * 7));

    let urgency = 'Low';
    let action = 'No action needed';
    if (overdueDays > 20) { urgency = 'Critical'; action = 'Escalate immediately — significantly overdue'; }
    else if (overdueDays > 10) { urgency = 'High'; action = 'Send firm reminder + call follow-up'; }
    else if (overdueDays > 0) { urgency = 'Medium'; action = 'Send payment reminder email/WhatsApp'; }
    else if (avgPaymentCycle - lastPaymentDays < 5) { urgency = 'Upcoming'; action = 'Pre-emptive reminder — payment due soon'; }

    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      avgPaymentCycle, lastPaymentDays, overdue, overdueDays,
      pendingInvoices, totalPending, onTimeRate, urgency, action,
      predictedPayDate: predictedPayDate.toLocaleDateString('en-IN'),
      monthlyAvg: c.monthlyAvg, dso: c.dso,
    };
  }).sort((a, b) => b.overdueDays - a.overdueDays);
}

// ─── REVENUE GROWTH SUGGESTIONS ─────────────────────────────────────────────
export function generateRevenueSuggestions() {
  const strategies = [
    { id: 1, title: 'Expand in South India', type: 'Geographic', impact: 'High', effort: 'Medium', estimatedRevenue: 850000, description: 'South India shows 35% lower dealer penetration but 28% higher avg order value. Target Chennai, Bangalore, Hyderabad with regional distribution partnerships.', metrics: { currentDealers: 8, potentialDealers: 22, avgOrderValue: 45000 } },
    { id: 2, title: 'Push Educational Toys Category', type: 'Category', impact: 'High', effort: 'Low', estimatedRevenue: 620000, description: 'Educational toys have 42% margin (highest) but only 35% dealer adoption. Back-to-school season (Jun-Aug) creates natural demand spike.', metrics: { currentAdoption: 35, targetAdoption: 70, margin: 42 } },
    { id: 3, title: 'Bundle Strategy for Low-Penetration Dealers', type: 'Product', impact: 'Medium', effort: 'Low', estimatedRevenue: 380000, description: '18 dealers buy from fewer than 3 categories. Create starter bundles mixing popular + new categories at 10% discount to drive cross-sell.', metrics: { targetDealers: 18, avgCategoryIncrease: 2.5, bundleDiscount: 10 } },
    { id: 4, title: 'Festival Season Pre-booking Program', type: 'Seasonal', impact: 'High', effort: 'Medium', estimatedRevenue: 1200000, description: 'Oct-Dec accounts for 40% of annual revenue. Launch pre-booking in Aug-Sep with 5% early bird discount + guaranteed stock availability.', metrics: { lastYearFestive: 3500000, prebookTarget: 60, earlyDiscount: 5 } },
    { id: 5, title: 'Premium Tier for Top 10 Dealers', type: 'Retention', impact: 'Medium', effort: 'Low', estimatedRevenue: 450000, description: 'Top 10 dealers contribute 45% of revenue. Create VIP tier with volume rebates, priority shipping, and exclusive product previews.', metrics: { topDealerRevenue: 4500000, retentionBoost: 15, rebatePercent: 3 } },
    { id: 6, title: 'WhatsApp Commerce for Reorders', type: 'Digital', impact: 'Medium', effort: 'Medium', estimatedRevenue: 280000, description: 'Reduce reorder friction with WhatsApp catalog + quick reorder buttons. Data shows 60% of orders are repeats of previous SKU mix.', metrics: { repeatOrderRate: 60, timeToReorder: '3 days → 1 hour', expectedLift: 12 } },
    { id: 7, title: 'Target Tier-2 Cities', type: 'Geographic', impact: 'High', effort: 'High', estimatedRevenue: 950000, description: 'Tier-2 cities like Indore, Bhopal, Coimbatore have growing middle class and minimal organized toy distribution. First mover advantage.', metrics: { citiesIdentified: 12, avgMarketSize: 1500000, competitorPresence: 'Low' } },
    { id: 8, title: 'Art & Craft + Back-to-School Campaign', type: 'Seasonal', impact: 'Medium', effort: 'Low', estimatedRevenue: 320000, description: 'Art & Craft category has 50% margin (highest) and natural back-to-school demand. Partner with schools for bulk orders.', metrics: { margin: 50, schoolPartners: 0, targetSchools: 50 } },
  ];

  return strategies;
}

// ─── CUSTOMER HEALTH ────────────────────────────────────────────────────────
export function generateCustomerHealth() {
  return customers.map(c => {
    // 5-dimension health score
    const purchaseHealth = Math.max(0, 100 - c.lastOrderDays * 1.5 - Math.max(0, c.orderFreqDecline));
    const paymentHealth = Math.max(0, 100 - (c.dso - 30) * 1.5);
    const engagementHealth = c.skuPenetration * 0.5 + c.catPenetration * 0.5;
    const growthHealth = Math.max(0, 50 + c.revenueChange);
    const loyaltyHealth = Math.min(100, c.totalOrders / 3);
    const overallHealth = Math.round(purchaseHealth * 0.25 + paymentHealth * 0.25 + engagementHealth * 0.2 + growthHealth * 0.15 + loyaltyHealth * 0.15);

    let status = 'Healthy';
    if (overallHealth < 30) status = 'Critical';
    else if (overallHealth < 50) status = 'At Risk';
    else if (overallHealth < 70) status = 'Needs Attention';

    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      monthlyAvg: c.monthlyAvg,
      purchaseHealth: Math.round(purchaseHealth),
      paymentHealth: Math.round(paymentHealth),
      engagementHealth: Math.round(engagementHealth),
      growthHealth: Math.round(growthHealth),
      loyaltyHealth: Math.round(loyaltyHealth),
      overallHealth, status,
      radarData: [
        { dimension: 'Purchase', score: Math.round(purchaseHealth) },
        { dimension: 'Payment', score: Math.round(paymentHealth) },
        { dimension: 'Engagement', score: Math.round(engagementHealth) },
        { dimension: 'Growth', score: Math.round(growthHealth) },
        { dimension: 'Loyalty', score: Math.round(loyaltyHealth) },
      ],
    };
  }).sort((a, b) => a.overallHealth - b.overallHealth);
}

// ─── INVENTORY BUDGET ───────────────────────────────────────────────────────
export function generateInventoryBudget() {
  const totalBudget = 5000000; // ₹50L monthly
  const allocations = TOY_CATEGORIES.map(cat => {
    const demandIndex = Math.round(40 + Math.random() * 60);
    const stockTurnover = Math.round((3 + Math.random() * 9) * 10) / 10;
    const currentStock = Math.floor(100 + Math.random() * 500);
    const reorderPoint = Math.floor(currentStock * (0.2 + Math.random() * 0.3));
    const optimalStock = Math.floor(currentStock * (1.2 + Math.random() * 0.5));
    const daysOfStock = Math.floor(10 + Math.random() * 45);
    const allocatedBudget = Math.round(totalBudget * (demandIndex / 700) * (1 + Math.random() * 0.3));
    const needsReorder = currentStock <= reorderPoint;
    const urgency = needsReorder ? (currentStock < reorderPoint * 0.5 ? 'Critical' : 'Soon') : 'OK';

    return {
      category: cat.name, avgPrice: cat.avgPrice, margin: cat.margin,
      demandIndex, stockTurnover, currentStock, reorderPoint, optimalStock,
      daysOfStock, allocatedBudget, needsReorder, urgency,
      suggestedOrder: needsReorder ? optimalStock - currentStock : 0,
      suggestedOrderValue: needsReorder ? (optimalStock - currentStock) * cat.avgPrice : 0,
    };
  });

  const alerts = allocations.filter(a => a.needsReorder).sort((a, b) => a.daysOfStock - b.daysOfStock);
  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedBudget, 0);

  return { totalBudget, totalAllocated, allocations, alerts };
}

// ─── MARKETING BUDGET ───────────────────────────────────────────────────────
export function generateMarketingBudget() {
  const totalMarketingBudget = 1500000; // ₹15L monthly

  const dealerAllocations = customers.slice(0, 25).map(c => {
    const revenueWeight = c.monthlyAvg / customers.reduce((s, cu) => s + cu.monthlyAvg, 0);
    const growthPotential = c.expansionScore / 100;
    const riskFactor = c.churnRisk === 'High' ? 1.5 : c.churnRisk === 'Medium' ? 1.2 : 1;
    const score = (revenueWeight * 0.4 + growthPotential * 0.35 + (riskFactor - 1) * 0.25);
    const allocated = Math.round(totalMarketingBudget * score * 3);

    const channels = {
      inStoreDisplay: Math.round(allocated * (0.25 + Math.random() * 0.15)),
      coopAdvertising: Math.round(allocated * (0.15 + Math.random() * 0.1)),
      tradeSchemes: Math.round(allocated * (0.2 + Math.random() * 0.1)),
      merchandising: Math.round(allocated * (0.15 + Math.random() * 0.1)),
      digitalSupport: Math.round(allocated * (0.1 + Math.random() * 0.1)),
    };

    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      monthlyAvg: c.monthlyAvg, expansionScore: c.expansionScore,
      churnRisk: c.churnRisk, allocated, channels,
      roi: Math.round((2 + Math.random() * 6) * 10) / 10,
      strategy: c.churnRisk === 'High' ? 'Retention focus' : c.expansionScore > 70 ? 'Growth accelerate' : 'Maintain presence',
    };
  }).sort((a, b) => b.allocated - a.allocated);

  return { totalMarketingBudget, dealerAllocations };
}
