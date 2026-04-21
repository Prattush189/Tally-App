import { Router } from 'express';
import { customers as mockCustomers, CATEGORIES as MOCK_CATEGORIES, revenueTrends as mockRevenueTrends, cohortData, computeAdvancedAnalytics } from '../data/mockData.js';
import { getDashboardData } from '../tally/dataManager.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

// Helper to get live data (Tally or mock)
async function getData() {
  try {
    const data = await getDashboardData();
    return {
      customers: data.customers || mockCustomers,
      CATEGORIES: data.categories || MOCK_CATEGORIES,
      revenueTrends: data.revenueTrends || mockRevenueTrends,
    };
  } catch {
    return { customers: mockCustomers, CATEGORIES: MOCK_CATEGORIES, revenueTrends: mockRevenueTrends };
  }
}

// GET /api/analytics/overview
router.get('/overview', async (req, res) => {
  const { customers, CATEGORIES, revenueTrends } = await getData();
  const totalAccounts = customers.length;
  const totalRevenue = customers.reduce((s, c) => s + c.monthlyAvg, 0);
  const avgDSO = Math.round(customers.reduce((s, c) => s + c.dso, 0) / customers.length);
  const avgSKUPen = Math.round(customers.reduce((s, c) => s + c.skuPenetration, 0) / customers.length);
  const avgCatPen = Math.round(customers.reduce((s, c) => s + c.catPenetration, 0) / customers.length);
  const highChurn = customers.filter(c => c.churnRisk === 'High').length;
  const highPayment = customers.filter(c => c.paymentRisk === 'High').length;
  const expandable = customers.filter(c => c.expansionScore > 60).length;
  const avgLTV = Math.round(customers.reduce((s, c) => s + c.ltv, 0) / customers.length);

  const segmentBreakdown = ['Enterprise', 'Mid-Market', 'SMB'].map(s => ({
    segment: s,
    count: customers.filter(c => c.segment === s).length,
    revenue: customers.filter(c => c.segment === s).reduce((sum, c) => sum + c.monthlyAvg, 0),
  }));

  const churnDistribution = [
    { name: 'High', value: customers.filter(c => c.churnRisk === 'High').length },
    { name: 'Medium', value: customers.filter(c => c.churnRisk === 'Medium').length },
    { name: 'Low', value: customers.filter(c => c.churnRisk === 'Low').length },
  ];

  const paymentDistribution = [
    { name: 'High', value: customers.filter(c => c.paymentRisk === 'High').length },
    { name: 'Medium', value: customers.filter(c => c.paymentRisk === 'Medium').length },
    { name: 'Low', value: customers.filter(c => c.paymentRisk === 'Low').length },
  ];

  const regionBreakdown = ['North', 'South', 'East', 'West'].map(r => ({
    region: r,
    count: customers.filter(c => c.region === r).length,
    revenue: customers.filter(c => c.region === r).reduce((sum, c) => sum + c.monthlyAvg, 0),
  }));

  res.json({
    totalAccounts, totalRevenue, avgDSO, avgSKUPen, avgCatPen,
    highChurn, highPayment, expandable, avgLTV,
    segmentBreakdown, churnDistribution, paymentDistribution, regionBreakdown,
    revenueTrends, latestNRR: 116, latestGRR: 96,
  });
});

// GET /api/analytics/churn
router.get('/churn', async (req, res) => {
  const { customers } = await getData();
  const churnData = customers.map(c => ({
    id: c.id, name: c.name, segment: c.segment, region: c.region,
    churnRisk: c.churnRisk, churnScore: c.churnScore, churnReasons: c.churnReasons,
    lastOrderDays: c.lastOrderDays, orderFreqDecline: c.orderFreqDecline,
    revenueChange: c.revenueChange, monthlyAvg: c.monthlyAvg,
    actionWindow: c.actionWindow, skuPenetration: c.skuPenetration,
    invoiceHistory: c.invoiceHistory,
  })).sort((a, b) => b.churnScore - a.churnScore);

  const distribution = [
    { name: 'High', value: churnData.filter(c => c.churnRisk === 'High').length, atRiskRevenue: churnData.filter(c => c.churnRisk === 'High').reduce((s, c) => s + c.monthlyAvg, 0) },
    { name: 'Medium', value: churnData.filter(c => c.churnRisk === 'Medium').length, atRiskRevenue: churnData.filter(c => c.churnRisk === 'Medium').reduce((s, c) => s + c.monthlyAvg, 0) },
    { name: 'Low', value: churnData.filter(c => c.churnRisk === 'Low').length, atRiskRevenue: churnData.filter(c => c.churnRisk === 'Low').reduce((s, c) => s + c.monthlyAvg, 0) },
  ];

  // Score distribution for histogram
  const scoreDistribution = [
    { range: '0-20', count: churnData.filter(c => c.churnScore <= 20).length },
    { range: '21-40', count: churnData.filter(c => c.churnScore > 20 && c.churnScore <= 40).length },
    { range: '41-60', count: churnData.filter(c => c.churnScore > 40 && c.churnScore <= 60).length },
    { range: '61-80', count: churnData.filter(c => c.churnScore > 60 && c.churnScore <= 80).length },
    { range: '81-100', count: churnData.filter(c => c.churnScore > 80).length },
  ];

  res.json({ customers: churnData, distribution, scoreDistribution });
});

// GET /api/analytics/payment
router.get('/payment', async (req, res) => {
  const { customers } = await getData();
  const agingBuckets = [
    { bucket: '0-30 days', amount: customers.reduce((s, c) => s + c.agingCurrent, 0) },
    { bucket: '31-60 days', amount: customers.reduce((s, c) => s + c.aging30, 0) },
    { bucket: '61-90 days', amount: customers.reduce((s, c) => s + c.aging60, 0) },
    { bucket: '90+ days', amount: customers.reduce((s, c) => s + c.aging90, 0) },
  ];

  const dsoBySegment = ['Enterprise', 'Mid-Market', 'SMB'].map(s => ({
    segment: s,
    dso: Math.round(customers.filter(c => c.segment === s).reduce((sum, c) => sum + c.dso, 0) / customers.filter(c => c.segment === s).length),
  }));

  const dsoByRegion = ['North', 'South', 'East', 'West'].map(r => ({
    region: r,
    dso: Math.round(customers.filter(c => c.region === r).reduce((sum, c) => sum + c.dso, 0) / customers.filter(c => c.region === r).length),
  }));

  const paymentCustomers = customers.map(c => ({
    id: c.id, name: c.name, segment: c.segment, region: c.region,
    paymentRisk: c.paymentRisk, dso: c.dso, paymentTrend: c.paymentTrend,
    agingCurrent: c.agingCurrent, aging30: c.aging30, aging60: c.aging60, aging90: c.aging90,
    outstandingAmount: c.outstandingAmount, creditLimit: c.creditLimit,
    monthlyAvg: c.monthlyAvg, paymentHistory: c.paymentHistory,
  })).sort((a, b) => b.dso - a.dso);

  const totalOutstanding = customers.reduce((s, c) => s + c.outstandingAmount, 0);
  const totalOverdue60 = customers.reduce((s, c) => s + c.aging60 + c.aging90, 0);

  res.json({ agingBuckets, dsoBySegment, dsoByRegion, customers: paymentCustomers, totalOutstanding, totalOverdue60 });
});

// GET /api/analytics/growth
router.get('/growth', async (req, res) => {
  const { customers, CATEGORIES } = await getData();
  const catAdoption = CATEGORIES.map(cat => ({
    category: cat,
    buyers: customers.filter(c => c.purchasedCategories.includes(cat)).length,
    penetration: Math.round(customers.filter(c => c.purchasedCategories.includes(cat)).length / customers.length * 100),
    avgRevenue: Math.round(customers.filter(c => c.purchasedCategories.includes(cat)).reduce((s, c) => s + c.monthlyAvg, 0) / (customers.filter(c => c.purchasedCategories.includes(cat)).length || 1)),
  })).sort((a, b) => b.buyers - a.buyers);

  const growthCustomers = customers.map(c => ({
    id: c.id, name: c.name, segment: c.segment,
    skuCount: c.skuCount, catCount: c.catCount,
    skuPenetration: c.skuPenetration, catPenetration: c.catPenetration,
    expansionScore: c.expansionScore, purchasedCategories: c.purchasedCategories,
    missedCategories: c.missedCategories, monthlyAvg: c.monthlyAvg,
  })).sort((a, b) => b.expansionScore - a.expansionScore);

  res.json({ catAdoption, customers: growthCustomers, totalSKUs: 50, totalCategories: CATEGORIES.length });
});

// GET /api/analytics/opportunities
router.get('/opportunities', async (req, res) => {
  const { customers, CATEGORIES } = await getData();
  const opportunities = customers
    .filter(c => c.missedCategories.length >= 3 && c.expansionScore > 50)
    .map(c => {
      const topMissed = c.missedCategories.slice(0, 4);
      const potentialRevenue = Math.round(c.monthlyAvg * 0.15 * topMissed.length);
      const score = c.expansionScore + (c.segment === 'Enterprise' ? 15 : c.segment === 'Mid-Market' ? 8 : 0);
      return { id: c.id, name: c.name, segment: c.segment, region: c.region, monthlyAvg: c.monthlyAvg, topMissed, potentialRevenue, expansionScore: c.expansionScore, score, skuPenetration: c.skuPenetration, catPenetration: c.catPenetration };
    })
    .sort((a, b) => b.score - a.score);

  const byCat = CATEGORIES.map(cat => ({
    category: cat,
    opportunities: customers.filter(c => c.missedCategories.includes(cat) && c.expansionScore > 50).length,
    potentialRevenue: customers.filter(c => c.missedCategories.includes(cat) && c.expansionScore > 50).reduce((s, c) => s + Math.round(c.monthlyAvg * 0.15), 0),
  })).sort((a, b) => b.opportunities - a.opportunities);

  const totalPotential = opportunities.reduce((s, o) => s + o.potentialRevenue, 0);

  res.json({ opportunities, byCat, totalPotential });
});

// GET /api/analytics/revenue
router.get('/revenue', async (req, res) => {
  const { customers, revenueTrends } = await getData();
  const totalLTV = customers.reduce((s, c) => s + c.ltv, 0);
  const avgLTV = Math.round(totalLTV / customers.length);
  const expanding = customers.filter(c => c.revenueChange > 5).length;
  const stable = customers.filter(c => c.revenueChange >= -5 && c.revenueChange <= 5).length;
  const contracting = customers.filter(c => c.revenueChange < -5).length;

  res.json({ revenueTrends, cohortData, avgLTV, totalLTV, expanding, stable, contracting, latestNRR: 116, latestGRR: 96 });
});

// GET /api/analytics/proactive
router.get('/proactive', async (req, res) => {
  const { customers } = await getData();
  const reminders = customers.map(c => {
    const triggers = [];
    if (c.lastOrderDays > 25) triggers.push({ type: 'retention', msg: `No order in ${c.lastOrderDays} days (overdue vs usual cycle)` });
    if (c.orderFreqDecline > 15) triggers.push({ type: 'retention', msg: `Order frequency declining ${c.orderFreqDecline}%` });
    if (c.revenueChange < -10) triggers.push({ type: 'maintenance', msg: `Invoice value dropped ${Math.abs(Math.round(c.revenueChange))}%` });
    if (c.paymentRisk === 'High') triggers.push({ type: 'payment', msg: `Payment risk HIGH — DSO ${c.dso} days` });
    if (c.expansionScore > 70 && c.catPenetration < 50) triggers.push({ type: 'expansion', msg: `High expansion potential (${c.expansionScore}), low category coverage (${c.catPenetration}%)` });
    if (c.segment === 'Enterprise' && c.lastContacted > 20) triggers.push({ type: 'maintenance', msg: `High-value account not contacted in ${c.lastContacted} days` });
    const urgency = triggers.length * 10 + (c.churnRisk === 'High' ? 30 : c.churnRisk === 'Medium' ? 15 : 0) + (c.monthlyAvg > 100000 ? 20 : 0);
    return { id: c.id, name: c.name, segment: c.segment, region: c.region, churnRisk: c.churnRisk, monthlyAvg: c.monthlyAvg, actionWindow: c.actionWindow, triggers, urgency };
  }).filter(c => c.triggers.length > 0).sort((a, b) => b.urgency - a.urgency);

  const stats = {
    total: reminders.length,
    retention: reminders.filter(r => r.triggers.some(t => t.type === 'retention')).length,
    payment: reminders.filter(r => r.triggers.some(t => t.type === 'payment')).length,
    expansion: reminders.filter(r => r.triggers.some(t => t.type === 'expansion')).length,
    maintenance: reminders.filter(r => r.triggers.some(t => t.type === 'maintenance')).length,
  };

  res.json({ reminders, stats });
});

// GET /api/analytics/action-focus
router.get('/action-focus', async (req, res) => {
  const { customers } = await getData();
  const priorityList = customers.map(c => {
    let score = 0;
    if (c.churnRisk === 'High') score += 40;
    if (c.churnRisk === 'Medium') score += 20;
    if (c.paymentRisk === 'High') score += 30;
    if (c.paymentRisk === 'Medium') score += 15;
    if (c.expansionScore > 70) score += 15;
    if (c.segment === 'Enterprise') score += 10;
    score += Math.max(0, c.lastOrderDays - 15);
    const reasons = [];
    if (c.churnRisk === 'High') reasons.push('High churn risk');
    if (c.paymentRisk === 'High') reasons.push('Payment overdue');
    if (c.expansionScore > 70 && c.catPenetration < 50) reasons.push('Expansion opportunity');
    if (c.revenueChange < -15) reasons.push('Revenue declining');
    if (c.lastOrderDays > 30) reasons.push(`Inactive ${c.lastOrderDays}d`);
    return { id: c.id, name: c.name, segment: c.segment, region: c.region, churnRisk: c.churnRisk, paymentRisk: c.paymentRisk, monthlyAvg: c.monthlyAvg, actionWindow: c.actionWindow, expansionScore: c.expansionScore, priorityScore: score, reasons };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  res.json({ priorityList: priorityList.slice(0, 20) });
});

// GET /api/analytics/advanced
router.get('/advanced', async (req, res) => {
  const { customers } = await getData();
  const analytics = computeAdvancedAnalytics(customers);
  res.json(analytics);
});

export default router;
