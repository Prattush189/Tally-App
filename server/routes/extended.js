import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { customers as mockCustomers } from '../data/mockData.js';
import { getDashboardData } from '../tally/dataManager.js';
import {
  generateMapAnalytics, generateToyCategoryScores, generatePurchaseForecast,
  generateAreaSKUAnalysis, generateDealerSuggestions, generatePaymentReminders,
  generateRevenueSuggestions, generateCustomerHealth, generateInventoryBudget,
  generateMarketingBudget, TOY_CATEGORIES,
} from '../data/extendedData.js';

const router = Router();
router.use(authenticateToken);

// India Map Analytics
router.get('/map', (req, res) => {
  res.json({ states: generateMapAnalytics(), totalStates: 18 });
});

// Toy Category Scores
router.get('/toy-categories', (req, res) => {
  res.json({ categories: generateToyCategoryScores() });
});

// Purchase Forecasting
router.get('/forecast', (req, res) => {
  const forecasts = generatePurchaseForecast();
  const totalForecast = forecasts.reduce((s, f) => s + f.totalForecast, 0);
  res.json({ forecasts, totalForecast, months: 8 });
});

// Area-wise SKU Analysis
router.get('/area-sku', (req, res) => {
  res.json(generateAreaSKUAnalysis());
});

// Contact Priority (recency, frequency, likelihood)
router.get('/contact-priority', (req, res) => {
  const prioritized = customers.map(c => {
    const recencyScore = Math.max(0, 100 - c.lastOrderDays * 2);
    const frequencyScore = Math.min(100, (c.totalOrders / 500) * 100);
    const likelihoodScore = c.churnRisk === 'High' ? 90 : c.churnRisk === 'Medium' ? 60 : 30;
    const valueScore = Math.min(100, (c.monthlyAvg / 200000) * 100);
    const contactScore = Math.round(
      (100 - recencyScore) * 0.3 + likelihoodScore * 0.25 + (100 - frequencyScore) * 0.2 + valueScore * 0.25
    );
    const daysSinceContact = c.lastContacted;
    let contactUrgency = 'Routine';
    if (contactScore > 70 && daysSinceContact > 14) contactUrgency = 'Urgent';
    else if (contactScore > 50 && daysSinceContact > 7) contactUrgency = 'High';
    else if (contactScore > 35) contactUrgency = 'Medium';

    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      monthlyAvg: c.monthlyAvg, lastOrderDays: c.lastOrderDays,
      totalOrders: c.totalOrders, churnRisk: c.churnRisk,
      recencyScore, frequencyScore, likelihoodScore, valueScore,
      contactScore, daysSinceContact, contactUrgency,
      suggestedAction: contactUrgency === 'Urgent' ? 'Call immediately — high risk of churn'
        : contactUrgency === 'High' ? 'Schedule call this week'
        : contactUrgency === 'Medium' ? 'Send product catalog / WhatsApp update'
        : 'Regular check-in next cycle',
    };
  }).sort((a, b) => b.contactScore - a.contactScore);

  res.json({ customers: prioritized });
});

// New Dealer Suggestions (daily 5-10)
router.get('/dealer-suggestions', (req, res) => {
  const all = generateDealerSuggestions();
  const today = new Date().getDate();
  const startIdx = (today % 3) * 10;
  const todayBatch = all.slice(startIdx, startIdx + 10);
  res.json({ today: todayBatch, total: all.length, date: new Date().toLocaleDateString('en-IN') });
});

// Payment Reminders
router.get('/payment-reminders', (req, res) => {
  const reminders = generatePaymentReminders();
  const stats = {
    critical: reminders.filter(r => r.urgency === 'Critical').length,
    high: reminders.filter(r => r.urgency === 'High').length,
    medium: reminders.filter(r => r.urgency === 'Medium').length,
    upcoming: reminders.filter(r => r.urgency === 'Upcoming').length,
    totalPending: reminders.reduce((s, r) => s + r.totalPending, 0),
  };
  res.json({ reminders, stats });
});

// Revenue Growth Suggestions
router.get('/revenue-suggestions', (req, res) => {
  const strategies = generateRevenueSuggestions();
  const totalPotential = strategies.reduce((s, st) => s + st.estimatedRevenue, 0);
  res.json({ strategies, totalPotential });
});

// Customer Health
router.get('/customer-health', (req, res) => {
  const health = generateCustomerHealth();
  const distribution = {
    critical: health.filter(h => h.status === 'Critical').length,
    atRisk: health.filter(h => h.status === 'At Risk').length,
    needsAttention: health.filter(h => h.status === 'Needs Attention').length,
    healthy: health.filter(h => h.status === 'Healthy').length,
  };
  const avgHealth = Math.round(health.reduce((s, h) => s + h.overallHealth, 0) / health.length);
  res.json({ customers: health, distribution, avgHealth });
});

// Inventory Budget & Alerts
router.get('/inventory', (req, res) => {
  res.json(generateInventoryBudget());
});

// Marketing Budget Allocation
router.get('/marketing-budget', (req, res) => {
  res.json(generateMarketingBudget());
});

// ─── DEALER PROFILE WITH AI SUGGESTIONS ────────────────────────────────────
router.get('/dealer/:id', async (req, res) => {
  let customers;
  try { const d = await getDashboardData(); customers = d.customers || mockCustomers; } catch { customers = mockCustomers; }
  const customer = customers.find(c => c.id === parseInt(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Dealer not found' });

  // Compute per-dealer deep analytics
  const c = customer;
  const recentMonths = c.invoiceHistory.slice(-3);
  const olderMonths = c.invoiceHistory.slice(0, 3);
  const recentAvg = recentMonths.reduce((s, m) => s + m.value, 0) / 3;
  const olderAvg = olderMonths.reduce((s, m) => s + m.value, 0) / 3;
  const momentum = olderAvg > 0 ? Math.round((recentAvg - olderAvg) / olderAvg * 100) : 0;

  const paymentScore = Math.round(
    (c.paymentRisk === 'Low' ? 85 : c.paymentRisk === 'Medium' ? 55 : 25) + (Math.random() * 10 - 5)
  );
  const loyaltyScore = Math.min(100, Math.round(
    (c.totalOrders / 5) + (c.catPenetration * 0.3) + (100 - c.churnScore) * 0.3
  ));
  const engagementScore = Math.min(100, Math.round(
    100 - c.lastOrderDays * 1.5 + c.skuPenetration * 0.3
  ));

  const healthRadar = [
    { dimension: 'Purchase Volume', score: Math.min(100, Math.round(c.monthlyAvg / 2000)) },
    { dimension: 'Payment Discipline', score: paymentScore },
    { dimension: 'Product Adoption', score: c.catPenetration },
    { dimension: 'Order Frequency', score: Math.min(100, Math.round(100 - Math.max(0, c.orderFreqDecline) * 2)) },
    { dimension: 'Loyalty', score: loyaltyScore },
    { dimension: 'Engagement', score: engagementScore },
  ];

  const overallHealth = Math.round(healthRadar.reduce((s, h) => s + h.score, 0) / healthRadar.length);

  // Monthly order counts from invoice history
  const orderTrend = c.invoiceHistory.map(m => ({
    month: m.month,
    revenue: m.value,
    orders: m.invoiceCount,
    avgOrderValue: m.invoiceCount > 0 ? Math.round(m.value / m.invoiceCount) : 0,
  }));

  // Category-level spending breakdown (mock)
  const categorySpend = c.purchasedCategories.map(cat => ({
    category: cat,
    spend: Math.round(c.monthlyAvg / c.catCount * (0.5 + Math.random())),
    skuCount: Math.floor(1 + Math.random() * 5),
    trend: Math.round(-15 + Math.random() * 30),
  })).sort((a, b) => b.spend - a.spend);

  // Payment aging detail
  const agingBreakdown = [
    { bucket: 'Current (0-30d)', amount: c.agingCurrent, pct: 0 },
    { bucket: '31-60 days', amount: c.aging30, pct: 0 },
    { bucket: '61-90 days', amount: c.aging60, pct: 0 },
    { bucket: '90+ days', amount: c.aging90, pct: 0 },
  ];
  const totalAging = agingBreakdown.reduce((s, a) => s + a.amount, 0);
  agingBreakdown.forEach(a => a.pct = totalAging > 0 ? Math.round(a.amount / totalAging * 100) : 0);

  // ─── AI SUGGESTIONS (mock — will use real API later) ────────────────────
  const aiSuggestions = [];

  // Retention suggestions
  if (c.churnRisk === 'High') {
    aiSuggestions.push({
      type: 'Retention', priority: 'Critical', icon: '🚨',
      title: 'Immediate Retention Intervention Needed',
      suggestion: `${c.name} shows ${Math.abs(Math.round(c.revenueChange))}% revenue decline and hasn't ordered in ${c.lastOrderDays} days. Schedule an in-person visit this week with a tailored discount offer of 8-12% on their top 3 purchased categories. Offer extended payment terms (Net 45) for the next 2 orders to rebuild purchasing habit.`,
      impact: `Potential save: ${Math.round(c.monthlyAvg * 12).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })} annual revenue`,
      actions: ['Schedule visit within 3 days', 'Prepare custom discount proposal', 'Offer extended Net 45 terms', 'Follow up weekly for 1 month'],
    });
  } else if (c.churnRisk === 'Medium') {
    aiSuggestions.push({
      type: 'Retention', priority: 'High', icon: '⚠️',
      title: 'Proactive Engagement Recommended',
      suggestion: `Order frequency has declined ${Math.round(c.orderFreqDecline)}% — this dealer may be testing alternatives. Send a personalised product catalogue highlighting new arrivals in their top categories. Consider a loyalty bonus: 5% cashback on orders above ₹${Math.round(c.avgOrderValue * 1.2).toLocaleString('en-IN')}.`,
      impact: `Prevent potential ${Math.round(c.monthlyAvg * 0.3).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}/mo loss`,
      actions: ['Call this week', 'Share new product catalogue', 'Offer loyalty cashback scheme'],
    });
  }

  // Upsell / Cross-sell suggestions
  if (c.missedCategories.length >= 3) {
    const topMissed = c.missedCategories.slice(0, 3);
    const upsellPotential = Math.round(c.monthlyAvg * 0.15 * topMissed.length);
    aiSuggestions.push({
      type: 'Cross-sell', priority: 'High', icon: '📈',
      title: `Expand into ${topMissed.length} Untapped Categories`,
      suggestion: `This dealer buys from only ${c.catCount} of 12 categories (${c.catPenetration}% penetration). Introduce ${topMissed.join(', ')} — dealers with similar profiles who adopted these categories saw 20-35% revenue increase within 3 months. Start with sample packs and introductory pricing.`,
      impact: `Estimated uplift: ₹${upsellPotential.toLocaleString('en-IN')}/month`,
      actions: topMissed.map(cat => `Introduce ${cat} with sample order`).concat(['Set 3-month adoption target']),
    });
  }

  if (c.skuPenetration < 40) {
    aiSuggestions.push({
      type: 'SKU Deepening', priority: 'Medium', icon: '🎯',
      title: 'Increase SKU Range Within Existing Categories',
      suggestion: `Currently buying only ${c.skuCount} of 50 SKUs (${c.skuPenetration}%). Within their active ${c.catCount} categories, there are ${Math.round((50 / 12) * c.catCount - c.skuCount)} additional SKUs they haven't tried. Bundle complementary products with a 5% combo discount to increase basket size.`,
      impact: `Target: Increase SKU count from ${c.skuCount} to ${Math.min(50, c.skuCount + 8)} within 2 months`,
      actions: ['Create bundle offers in active categories', 'Share bestseller list for their region', 'Offer trial quantities at 10% off'],
    });
  }

  // Payment suggestions
  if (c.paymentRisk !== 'Low') {
    aiSuggestions.push({
      type: 'Payment', priority: c.paymentRisk === 'High' ? 'Critical' : 'Medium', icon: '💰',
      title: c.paymentRisk === 'High' ? 'Urgent Payment Recovery Required' : 'Improve Payment Cycle',
      suggestion: c.paymentRisk === 'High'
        ? `Outstanding: ₹${c.outstandingAmount.toLocaleString('en-IN')} with DSO at ${c.dso} days (target: 30 days). ₹${(c.aging60 + c.aging90).toLocaleString('en-IN')} is overdue beyond 60 days. Escalate to senior management, consider placing on credit hold after final notice. Offer a structured 3-installment clearance plan with 2% early settlement discount.`
        : `DSO is ${c.dso} days vs target 30 days. Introduce early payment discount of 2% for payments within 15 days. Shift to partial advance payment model for orders above ₹${Math.round(c.avgOrderValue * 1.5).toLocaleString('en-IN')}.`,
      impact: `Recover ₹${(c.aging60 + c.aging90).toLocaleString('en-IN')} overdue, reduce DSO by ${Math.round(c.dso * 0.3)} days`,
      actions: c.paymentRisk === 'High'
        ? ['Send final notice', 'Call accounts department', 'Propose installment plan', 'Review credit limit']
        : ['Introduce early payment discount', 'Set up payment reminders', 'Review credit terms'],
    });
  }

  // Growth suggestions
  if (c.expansionScore > 60 && c.segment !== 'Enterprise') {
    aiSuggestions.push({
      type: 'Growth', priority: 'Medium', icon: '🚀',
      title: 'High Growth Potential — Upgrade Dealer Tier',
      suggestion: `Expansion score of ${c.expansionScore}/100 indicates this ${c.segment} dealer could be upgraded. Their purchasing pattern mirrors Enterprise-tier dealers. Offer volume-based tiered pricing: 5% off above ₹${Math.round(c.monthlyAvg * 1.3).toLocaleString('en-IN')}/mo, 8% off above ₹${Math.round(c.monthlyAvg * 1.8).toLocaleString('en-IN')}/mo. Assign a dedicated account manager.`,
      impact: `Potential: Move from ₹${Math.round(c.monthlyAvg).toLocaleString('en-IN')} to ₹${Math.round(c.monthlyAvg * 1.5).toLocaleString('en-IN')}/mo`,
      actions: ['Propose volume pricing tiers', 'Assign account manager', 'Set quarterly growth targets', 'Monthly business review calls'],
    });
  }

  // Seasonal / timing suggestion
  aiSuggestions.push({
    type: 'Timing', priority: 'Low', icon: '📅',
    title: 'Optimal Order Timing Pattern',
    suggestion: `Based on 12-month history, this dealer's peak ordering months are ${orderTrend.sort((a,b) => b.revenue - a.revenue).slice(0,3).map(m => m.month).join(', ')}. Pre-season outreach 2 weeks before peak months with pre-booked inventory ensures availability and strengthens the relationship. Average order value peaks at ₹${Math.max(...orderTrend.map(m => m.avgOrderValue)).toLocaleString('en-IN')} during highs.`,
    impact: 'Improve fill rate and dealer satisfaction during peak periods',
    actions: ['Set calendar reminders for pre-peak outreach', 'Pre-allocate inventory for top dealers', 'Share upcoming product launches early'],
  });

  res.json({
    ...c,
    momentum,
    paymentScore,
    loyaltyScore,
    engagementScore,
    overallHealth,
    healthRadar,
    orderTrend: c.invoiceHistory.map(m => ({
      month: m.month, revenue: m.value, orders: m.invoiceCount,
      avgOrderValue: m.invoiceCount > 0 ? Math.round(m.value / m.invoiceCount) : 0,
    })),
    categorySpend,
    agingBreakdown,
    aiSuggestions,
    aiMeta: { model: 'Demo Mode', note: 'Connect your AI API key in .env for live suggestions' },
  });
});

// ─── DEALER LIST (lightweight, for search/picker) ──────────────────────────
router.get('/dealers', async (req, res) => {
  let customers;
  try { const d = await getDashboardData(); customers = d.customers || mockCustomers; } catch { customers = mockCustomers; }
  const list = customers.map(c => ({
    id: c.id, name: c.name, segment: c.segment, region: c.region, city: c.city,
    monthlyAvg: c.monthlyAvg, churnRisk: c.churnRisk, paymentRisk: c.paymentRisk,
  }));
  res.json({ dealers: list });
});

export default router;
