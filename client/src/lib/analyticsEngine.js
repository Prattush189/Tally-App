// Client-side analytics engine. EVERY handler here requires real Tally data
// passed in via overrides.customers. There is no mock fallback anymore —
// if no live data is available the hooks return `data: null` and dashboards
// render their empty state (App.jsx gates the dashboards behind a synced
// snapshot, so these functions should never run without real customers).

// Aggregate monthly revenue across all customer invoiceHistory entries into
// a chronological `revenueTrends` series. Used by getOverview + getRevenue
// in place of the old fixed-array mock.
function deriveRevenueTrends(customers) {
  const byMonth = new Map();
  for (const c of customers) {
    for (const row of c.invoiceHistory || []) {
      if (!row?.month) continue;
      const e = byMonth.get(row.month) || { month: row.month, revenue: 0, invoiceCount: 0 };
      e.revenue += row.value || 0;
      e.invoiceCount += row.invoiceCount || 0;
      byMonth.set(row.month, e);
    }
  }
  return Array.from(byMonth.values()).map(r => ({ ...r, revenue: Math.round(r.revenue) }));
}

function deriveCategories(customers) {
  const seen = new Set();
  for (const c of customers) {
    (c.purchasedCategories || []).forEach((k) => seen.add(k));
    (c.missedCategories || []).forEach((k) => seen.add(k));
  }
  return Array.from(seen);
}

function ctx(overrides = {}) {
  const customers = overrides.customers || [];
  return {
    customers,
    CATEGORIES: overrides.CATEGORIES || deriveCategories(customers),
    revenueTrends: overrides.revenueTrends || deriveRevenueTrends(customers),
  };
}

// Voucher-driven metrics collapse to zero when Day Book is disabled (Tally
// c0000005 crash on this dataset). Detect that state from the customer
// objects so dashboards can swap to the ledger-only "receivables
// intelligence" layout instead of rendering a sea of ₹0 tiles.
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

// Derive the master-data / ledger-only metric bundle that Overview falls back
// to when no vouchers landed in the snapshot. Every field here is computed
// from CLOSINGBALANCE / CREDITLIMIT / region / GSTIN — fields the ledger
// master collection always carries.
function getLedgerMetrics(customers) {
  const totalDealers = customers.length;
  const withOutstanding = customers.filter(c => (c.outstandingAmount || 0) > 0);
  const totalReceivables = withOutstanding.reduce((s, c) => s + c.outstandingAmount, 0);
  const avgReceivable = withOutstanding.length ? Math.round(totalReceivables / withOutstanding.length) : 0;
  const overLimit = customers.filter(c => c.creditLimit > 0 && c.outstandingAmount > c.creditLimit).length;
  const withGstin = customers.filter(c => c.gstin && String(c.gstin).trim()).length;
  const withCreditTerms = customers.filter(c => c.creditLimit > 0).length;
  const settled = customers.filter(c => (c.outstandingAmount || 0) <= 0).length;

  const REGIONS = ['North', 'South', 'East', 'West'];
  const receivablesByRegion = REGIONS.map(r => {
    const inRegion = customers.filter(c => c.region === r);
    return {
      region: r,
      dealers: inRegion.length,
      receivables: inRegion.reduce((s, c) => s + Math.max(0, c.outstandingAmount || 0), 0),
    };
  });

  const topByOutstanding = [...withOutstanding]
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
    .slice(0, 10)
    .map(c => ({
      id: c.id,
      name: c.name,
      region: c.region,
      outstanding: c.outstandingAmount,
      creditLimit: c.creditLimit,
      utilization: c.creditLimit > 0 ? Math.round((c.outstandingAmount / c.creditLimit) * 100) : null,
    }));

  // Pareto: cumulative % of total receivables vs % of dealers (ranked).
  const sortedDealers = [...withOutstanding].sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  let cumSum = 0;
  const pareto = sortedDealers.map((c, i) => {
    cumSum += c.outstandingAmount;
    return {
      rank: i + 1,
      dealerPct: Math.round(((i + 1) / sortedDealers.length) * 100),
      cumulativePct: totalReceivables > 0 ? Math.round((cumSum / totalReceivables) * 100) : 0,
    };
  });
  // Headline number: what % of receivables is concentrated in the top 20%
  // of dealers? Standard Pareto cut.
  const top20Index = Math.max(0, Math.floor(sortedDealers.length * 0.2) - 1);
  const top20Concentration = pareto[top20Index]?.cumulativePct || 0;

  const outstandingBuckets = [
    { name: 'Settled', count: settled },
    { name: '<₹10k', count: customers.filter(c => c.outstandingAmount > 0 && c.outstandingAmount < 10000).length },
    { name: '₹10k-1L', count: customers.filter(c => c.outstandingAmount >= 10000 && c.outstandingAmount < 100000).length },
    { name: '₹1L-10L', count: customers.filter(c => c.outstandingAmount >= 100000 && c.outstandingAmount < 1000000).length },
    { name: '>₹10L', count: customers.filter(c => c.outstandingAmount >= 1000000).length },
  ];

  return {
    totalDealers,
    totalReceivables,
    avgReceivable,
    overLimit,
    overLimitPct: totalDealers ? Math.round((overLimit / totalDealers) * 100) : 0,
    withGstin,
    gstinPct: totalDealers ? Math.round((withGstin / totalDealers) * 100) : 0,
    withCreditTerms,
    creditTermsPct: totalDealers ? Math.round((withCreditTerms / totalDealers) * 100) : 0,
    settled,
    settledPct: totalDealers ? Math.round((settled / totalDealers) * 100) : 0,
    top20Concentration,
    receivablesByRegion,
    topByOutstanding,
    outstandingBuckets,
  };
}

function computeAdvancedAnalytics(customers) {
  // Minimal advanced-analytics bundle derived from real customers. Mirrors
  // the shape the old mockData.computeAdvancedAnalytics returned so the
  // AdvancedAnalytics component keeps working without a mock dependency.
  const total = customers.length || 1;
  const avg = (fn) => Math.round(customers.reduce((s, c) => s + (fn(c) || 0), 0) / total);
  const skuAdoption = avg(c => c.skuPenetration);
  const catAdoption = avg(c => c.catPenetration);
  const churnRate = Math.round(customers.filter(c => c.churnRisk === 'High').length / total * 100);
  const avgLTV = avg(c => c.ltv);
  const avgDSO = avg(c => c.dso);
  const segmentSplit = ['Enterprise', 'Mid-Market', 'SMB'].map(s => ({
    segment: s, count: customers.filter(c => c.segment === s).length,
  }));
  return { skuAdoption, catAdoption, churnRate, avgLTV, avgDSO, segmentSplit };
}

export function getOverview(overrides) {
  const { customers, revenueTrends } = ctx(overrides);
  const ledgerOnly = !hasVoucherData(customers);
  const ledgerMetrics = getLedgerMetrics(customers);
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

  const churnDistribution = ['High', 'Medium', 'Low'].map(name => ({
    name, value: customers.filter(c => c.churnRisk === name).length,
  }));

  const paymentDistribution = ['High', 'Medium', 'Low'].map(name => ({
    name, value: customers.filter(c => c.paymentRisk === name).length,
  }));

  const regionBreakdown = ['North', 'South', 'East', 'West'].map(r => ({
    region: r,
    count: customers.filter(c => c.region === r).length,
    revenue: customers.filter(c => c.region === r).reduce((sum, c) => sum + c.monthlyAvg, 0),
  }));

  return {
    totalAccounts, totalRevenue, avgDSO, avgSKUPen, avgCatPen,
    highChurn, highPayment, expandable, avgLTV,
    segmentBreakdown, churnDistribution, paymentDistribution, regionBreakdown,
    revenueTrends,
    ledgerOnly,
    ledger: ledgerMetrics,
  };
}

export function getChurn(overrides) {
  const { customers } = ctx(overrides);
  const churnData = customers.map(c => ({
    id: c.id, name: c.name, segment: c.segment, region: c.region,
    churnRisk: c.churnRisk, churnScore: c.churnScore, churnReasons: c.churnReasons,
    lastOrderDays: c.lastOrderDays, orderFreqDecline: c.orderFreqDecline,
    revenueChange: c.revenueChange, monthlyAvg: c.monthlyAvg,
    actionWindow: c.actionWindow, skuPenetration: c.skuPenetration,
    invoiceHistory: c.invoiceHistory,
  })).sort((a, b) => b.churnScore - a.churnScore);

  const distribution = ['High', 'Medium', 'Low'].map(name => ({
    name,
    value: churnData.filter(c => c.churnRisk === name).length,
    atRiskRevenue: churnData.filter(c => c.churnRisk === name).reduce((s, c) => s + c.monthlyAvg, 0),
  }));

  const scoreDistribution = [
    { range: '0-20', count: churnData.filter(c => c.churnScore <= 20).length },
    { range: '21-40', count: churnData.filter(c => c.churnScore > 20 && c.churnScore <= 40).length },
    { range: '41-60', count: churnData.filter(c => c.churnScore > 40 && c.churnScore <= 60).length },
    { range: '61-80', count: churnData.filter(c => c.churnScore > 60 && c.churnScore <= 80).length },
    { range: '81-100', count: churnData.filter(c => c.churnScore > 80).length },
  ];

  return { customers: churnData, distribution, scoreDistribution };
}

export function getPayment(overrides) {
  const { customers } = ctx(overrides);
  const agingBuckets = [
    { bucket: '0-30 days', amount: customers.reduce((s, c) => s + c.agingCurrent, 0) },
    { bucket: '31-60 days', amount: customers.reduce((s, c) => s + c.aging30, 0) },
    { bucket: '61-90 days', amount: customers.reduce((s, c) => s + c.aging60, 0) },
    { bucket: '90+ days', amount: customers.reduce((s, c) => s + c.aging90, 0) },
  ];

  const dsoBySegment = ['Enterprise', 'Mid-Market', 'SMB'].map(s => {
    const group = customers.filter(c => c.segment === s);
    return { segment: s, dso: Math.round(group.reduce((sum, c) => sum + c.dso, 0) / (group.length || 1)) };
  });

  const dsoByRegion = ['North', 'South', 'East', 'West'].map(r => {
    const group = customers.filter(c => c.region === r);
    return { region: r, dso: Math.round(group.reduce((sum, c) => sum + c.dso, 0) / (group.length || 1)) };
  });

  const paymentCustomers = customers.map(c => ({
    id: c.id, name: c.name, segment: c.segment, region: c.region,
    paymentRisk: c.paymentRisk, dso: c.dso, paymentTrend: c.paymentTrend,
    agingCurrent: c.agingCurrent, aging30: c.aging30, aging60: c.aging60, aging90: c.aging90,
    outstandingAmount: c.outstandingAmount, creditLimit: c.creditLimit,
    monthlyAvg: c.monthlyAvg, paymentHistory: c.paymentHistory,
  })).sort((a, b) => b.dso - a.dso);

  const totalOutstanding = customers.reduce((s, c) => s + c.outstandingAmount, 0);
  const totalOverdue60 = customers.reduce((s, c) => s + c.aging60 + c.aging90, 0);

  return { agingBuckets, dsoBySegment, dsoByRegion, customers: paymentCustomers, totalOutstanding, totalOverdue60 };
}

export function getGrowth(overrides) {
  const { customers, CATEGORIES } = ctx(overrides);
  const catAdoption = CATEGORIES.map(cat => {
    const buyers = customers.filter(c => c.purchasedCategories.includes(cat));
    return {
      category: cat,
      buyers: buyers.length,
      penetration: Math.round(buyers.length / customers.length * 100),
      avgRevenue: Math.round(buyers.reduce((s, c) => s + c.monthlyAvg, 0) / (buyers.length || 1)),
    };
  }).sort((a, b) => b.buyers - a.buyers);

  const growthCustomers = customers.map(c => ({
    id: c.id, name: c.name, segment: c.segment,
    skuCount: c.skuCount, catCount: c.catCount,
    skuPenetration: c.skuPenetration, catPenetration: c.catPenetration,
    expansionScore: c.expansionScore, purchasedCategories: c.purchasedCategories,
    missedCategories: c.missedCategories, monthlyAvg: c.monthlyAvg,
  })).sort((a, b) => b.expansionScore - a.expansionScore);

  return { catAdoption, customers: growthCustomers, totalSKUs: 50, totalCategories: CATEGORIES.length };
}

export function getOpportunities(overrides) {
  const { customers, CATEGORIES } = ctx(overrides);
  const opportunities = customers
    .filter(c => c.missedCategories.length >= 3 && c.expansionScore > 50)
    .map(c => {
      const topMissed = c.missedCategories.slice(0, 4);
      const potentialRevenue = Math.round(c.monthlyAvg * 0.15 * topMissed.length);
      const score = c.expansionScore + (c.segment === 'Enterprise' ? 15 : c.segment === 'Mid-Market' ? 8 : 0);
      return {
        id: c.id, name: c.name, segment: c.segment, region: c.region,
        monthlyAvg: c.monthlyAvg, topMissed, potentialRevenue,
        expansionScore: c.expansionScore, score,
        skuPenetration: c.skuPenetration, catPenetration: c.catPenetration,
      };
    })
    .sort((a, b) => b.score - a.score);

  const byCat = CATEGORIES.map(cat => {
    const pool = customers.filter(c => c.missedCategories.includes(cat) && c.expansionScore > 50);
    return {
      category: cat,
      opportunities: pool.length,
      potentialRevenue: pool.reduce((s, c) => s + Math.round(c.monthlyAvg * 0.15), 0),
    };
  }).sort((a, b) => b.opportunities - a.opportunities);

  const totalPotential = opportunities.reduce((s, o) => s + o.potentialRevenue, 0);
  return { opportunities, byCat, totalPotential };
}

export function getRevenue(overrides) {
  const { customers, revenueTrends } = ctx(overrides);
  const totalLTV = customers.reduce((s, c) => s + c.ltv, 0);
  const avgLTV = customers.length ? Math.round(totalLTV / customers.length) : 0;
  const expanding = customers.filter(c => c.revenueChange > 5).length;
  const stable = customers.filter(c => c.revenueChange >= -5 && c.revenueChange <= 5).length;
  const contracting = customers.filter(c => c.revenueChange < -5).length;
  // cohortData used to come from a mock fixture. It's an empty array when we
  // have no way to bucket customers by onboarding cohort from Tally (no
  // onboarded_at field on ledgers); components check length before rendering.
  return { revenueTrends, cohortData: [], avgLTV, totalLTV, expanding, stable, contracting };
}

export function getProactive(overrides) {
  const { customers } = ctx(overrides);
  const reminders = customers.map(c => {
    const triggers = [];
    if (c.lastOrderDays > 25) triggers.push({ type: 'retention', msg: `No order in ${c.lastOrderDays} days (overdue vs usual cycle)` });
    if (c.orderFreqDecline > 15) triggers.push({ type: 'retention', msg: `Order frequency declining ${c.orderFreqDecline}%` });
    if (c.revenueChange < -10) triggers.push({ type: 'maintenance', msg: `Invoice value dropped ${Math.abs(Math.round(c.revenueChange))}%` });
    if (c.paymentRisk === 'High') triggers.push({ type: 'payment', msg: `Payment risk HIGH — DSO ${c.dso} days` });
    if (c.expansionScore > 70 && c.catPenetration < 50) triggers.push({ type: 'expansion', msg: `High expansion potential (${c.expansionScore}), low category coverage (${c.catPenetration}%)` });
    if (c.segment === 'Enterprise' && c.lastContacted > 20) triggers.push({ type: 'maintenance', msg: `High-value account not contacted in ${c.lastContacted} days` });
    const urgency = triggers.length * 10 + (c.churnRisk === 'High' ? 30 : c.churnRisk === 'Medium' ? 15 : 0) + (c.monthlyAvg > 100000 ? 20 : 0);
    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      churnRisk: c.churnRisk, monthlyAvg: c.monthlyAvg,
      actionWindow: c.actionWindow, triggers, urgency,
    };
  }).filter(c => c.triggers.length > 0).sort((a, b) => b.urgency - a.urgency);

  const stats = {
    total: reminders.length,
    retention: reminders.filter(r => r.triggers.some(t => t.type === 'retention')).length,
    payment: reminders.filter(r => r.triggers.some(t => t.type === 'payment')).length,
    expansion: reminders.filter(r => r.triggers.some(t => t.type === 'expansion')).length,
    maintenance: reminders.filter(r => r.triggers.some(t => t.type === 'maintenance')).length,
  };
  return { reminders, stats };
}

export function getActionFocus(overrides) {
  const { customers } = ctx(overrides);
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
    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      churnRisk: c.churnRisk, paymentRisk: c.paymentRisk,
      monthlyAvg: c.monthlyAvg, actionWindow: c.actionWindow,
      expansionScore: c.expansionScore, priorityScore: score, reasons,
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  return { priorityList: priorityList.slice(0, 20) };
}

export function getAdvanced(overrides) {
  const { customers } = ctx(overrides);
  return computeAdvancedAnalytics(customers);
}

const handlers = {
  overview: getOverview,
  churn: getChurn,
  payment: getPayment,
  growth: getGrowth,
  opportunities: getOpportunities,
  revenue: getRevenue,
  proactive: getProactive,
  'action-focus': getActionFocus,
  advanced: getAdvanced,
};

export function runAnalytics(endpoint, overrides) {
  const handler = handlers[endpoint];
  if (!handler) throw new Error(`Unknown analytics endpoint: ${endpoint}`);
  return handler(overrides);
}
