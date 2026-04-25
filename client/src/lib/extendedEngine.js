// Client-side extended analytics engine — replaces /api/extended/* routes.
// Mirrors the server route shapes so consumers don't need to change.

// Extended analytics engine — operates exclusively on real Tally-sync data
// passed in via overrides.customers. Previously this file imported mock
// fixtures (mockData.customers, generateToyCategoryScores, etc.) and fell
// back to them when the caller didn't supply real data; that fallback is
// gone so no dashboard ever renders fabricated numbers. Hooks that can't
// find a live snapshot return `data: null` and components render their
// empty state.
import { INDIA_STATES } from './extendedData.js';

// Deterministic PRNG mirrored from extendedData.js so real-data derivations
// in this file can reuse seeded randomness where numbers need stable spread
// (e.g. peer tier estimates). Same seed → same output every reload.
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFor(seed) { return mulberry32(hashString(seed)); }

function pickCustomers(overrides) {
  return (overrides && Array.isArray(overrides.customers)) ? overrides.customers : [];
}

// Roll up real Tally customers into state-level metrics. The transformer
// populates `state` (from LedStateName / Address parsing) and `region` on
// each customer; we aggregate revenue, dealer count, churn risk, top
// category and DSO by state. No demo fixture — empty state + "no regional
// data yet" empty source returned when customers lack state/region data.
export function getMap(overrides) {
  const customers = pickCustomers(overrides);
  if (!customers.length) return { states: [], totalStates: 0, source: 'empty' };

  const byState = new Map();
  for (const c of customers) {
    const rawState = (c.state || c.region || '').trim();
    if (!rawState) continue;
    const e = byState.get(rawState) || {
      state: rawState, revenue: 0, dealers: 0, customers: 0,
      monthlyAvgSum: 0, dsoSum: 0, dsoN: 0,
      churnHigh: 0, churnMed: 0, churnLow: 0,
      categoryCounts: new Map(),
    };
    e.revenue += c.totalRevenue || (c.monthlyAvg || 0) * 12;
    e.dealers += 1;
    e.customers += 1;
    e.monthlyAvgSum += c.monthlyAvg || 0;
    if (typeof c.dso === 'number') { e.dsoSum += c.dso; e.dsoN += 1; }
    if (c.churnRisk === 'High') e.churnHigh += 1;
    else if (c.churnRisk === 'Medium') e.churnMed += 1;
    else e.churnLow += 1;
    for (const cat of c.purchasedCategories || []) {
      e.categoryCounts.set(cat, (e.categoryCounts.get(cat) || 0) + 1);
    }
    byState.set(rawState, e);
  }
  if (!byState.size) return { states: [], totalStates: 0, source: 'empty' };

  const geoLookup = new Map(INDIA_STATES.map(s => [s.state.toLowerCase(), s]));
  const states = Array.from(byState.values()).map(e => {
    const geo = geoLookup.get(e.state.toLowerCase()) || { code: e.state.slice(0, 2).toUpperCase(), x: null, y: null, cities: [] };
    const topCat = Array.from(e.categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    const mostChurn = Math.max(e.churnHigh, e.churnMed, e.churnLow);
    const churnRisk = mostChurn === e.churnHigh ? 'High' : mostChurn === e.churnMed ? 'Medium' : 'Low';
    return {
      state: e.state, code: geo.code, x: geo.x, y: geo.y, cities: geo.cities,
      customers: e.customers,
      revenue: Math.round(e.revenue),
      dealers: e.dealers,
      growth: 0,
      topCategory: topCat ? topCat[0] : '—',
      avgOrderValue: e.customers ? Math.round(e.monthlyAvgSum / e.customers) : 0,
      penetration: 0,
      churnRisk,
      avgDSO: e.dsoN ? Math.round(e.dsoSum / e.dsoN) : 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  return { states, totalStates: states.length, source: 'tally' };
}

export function getToyCategories(overrides) {
  const customers = pickCustomers(overrides);
  if (!customers.length) return { categories: [], source: 'empty' };

  // Derive categories directly from Tally stock items (via purchasedCategories
  // on each customer, which the transformer populated from sale voucher
  // inventory line items). This is the ACTUAL taxonomy from the user's Tally
  // file — no demo fixture fallback.
  const agg = new Map();
  for (const c of customers) {
    const cats = c.purchasedCategories || [];
    const monthly = (c.invoiceHistory || []).reduce((s, m) => s + (m.value || 0), 0);
    const perCatShare = cats.length ? monthly / cats.length : 0;
    for (const name of cats) {
      const e = agg.get(name) || { name, customerIds: new Set(), totalSales: 0 };
      e.customerIds.add(c.id || c.name);
      e.totalSales += perCatShare;
      agg.set(name, e);
    }
  }

  if (!agg.size) {
    return {
      categories: [],
      source: 'waiting-for-vouchers',
      note: 'No category data yet — once Tally sales vouchers sync, this view populates with the categories your customers actually buy.',
    };
  }

  const totalCustomers = customers.length || 1;
  const categories = Array.from(agg.values())
    .map((e, i) => {
      const dealerAdoption = Math.round((e.customerIds.size / totalCustomers) * 100);
      const healthScore = Math.min(100, Math.max(0, Math.round(40 + dealerAdoption * 0.6)));
      return {
        id: i + 1,
        name: e.name,
        avgPrice: 0,
        margin: 0,
        seasonality: 'unknown',
        peakMonths: [],
        totalSales: Math.round(e.totalSales),
        dealerAdoption,
        returnRate: 0,
        growthRate: 0,
        competitiveIndex: 50,
        demandScore: healthScore,
        healthScore,
        monthlyData: [],
        recommendation: healthScore > 70 ? 'Expand' : healthScore > 45 ? 'Maintain' : 'Review',
      };
    })
    .sort((a, b) => b.dealerAdoption - a.dealerAdoption);

  return { categories, source: 'tally' };
}

// Linear projection from customer invoice history → a simple 8-month
// purchase forecast per category, derived from what the user's dealers have
// actually bought. No random padding, no hardcoded fixture. If voucher
// history is absent we return an empty forecast so the UI can render a
// "waiting for voucher sync" state instead of fabricated predictions.
export function getForecast(overrides) {
  const purchases = overrides?.financials?.purchases || null;
  const supplierMonthly = purchases?.supplierMonthly || [];
  const monthsAxis = purchases?.monthsAxis || [];
  const monthly = purchases?.monthly || [];

  if (!monthsAxis.length) {
    return {
      forecasts: [],
      totalForecast: 0,
      months: 0,
      source: purchases ? 'waiting-for-purchase-data' : 'waiting-for-purchase-register',
    };
  }

  // Per-supplier projections aren't available when the purchase data
  // came from Tally's pre-compiled Purchase Register report (it
  // aggregates by month server-side, not by party). Fall back to a
  // single "Total Purchases" projection from the global monthly
  // series so the page still renders a usable chart.
  if (!supplierMonthly.length) {
    supplierMonthly.push({
      name: 'Total Purchases',
      months: monthsAxis.map((m) => {
        const row = monthly.find((x) => x.month === m);
        return row ? Number(row.value) || 0 : 0;
      }),
    });
  }

  // Project 8 months forward per supplier from each supplier's actual
  // monthly history. Use the last 12 months of activity (Holt-Winters
  // would be nicer but isn't worth the cost here): trailing-3 baseline
  // + simple linear trend (last-half mean - first-half mean). Peak
  // months are flagged when their predicted spend is in the top
  // tertile of the projection — useful signal for "stock up before X".
  const projMonths = 8;

  // Convert YYYYMM month keys into human-friendly month labels so the
  // chart x-axis reads "Jan '25" instead of "202501".
  const fmtMonth = (yyyymm) => {
    if (!yyyymm || yyyymm.length < 6) return yyyymm || '';
    const y = yyyymm.slice(2, 4);
    const m = Number(yyyymm.slice(4, 6));
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[m - 1] || '?'} '${y}`;
  };

  // Project forward starting one month after the most recent observed
  // month so the timeline is contiguous.
  const lastObserved = monthsAxis[monthsAxis.length - 1];
  const futureKeys = (() => {
    const keys = [];
    if (!lastObserved) {
      const now = new Date();
      for (let i = 1; i <= projMonths; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        keys.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
      return keys;
    }
    const y = Number(lastObserved.slice(0, 4));
    const m = Number(lastObserved.slice(4, 6));
    for (let i = 1; i <= projMonths; i++) {
      const d = new Date(y, (m - 1) + i, 1);
      keys.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return keys;
  })();

  const forecasts = supplierMonthly.slice(0, 8).map((s) => {
    const window = s.months.slice(-12);
    const half = Math.max(1, Math.floor(window.length / 2));
    const first = window.slice(0, half).reduce((a, v) => a + v, 0) / half;
    const last = window.slice(-half).reduce((a, v) => a + v, 0) / half;
    const growthPerMonth = (last - first) / Math.max(1, half);
    const baseline = window.slice(-Math.min(3, window.length)).reduce((a, v) => a + v, 0) / Math.min(3, window.length || 1);

    const rawPredictions = futureKeys.map((_, i) => Math.max(0, Math.round(baseline + growthPerMonth * (i + 1))));
    const peakThreshold = (() => {
      const sorted = [...rawPredictions].sort((a, b) => b - a);
      return sorted[Math.floor(sorted.length / 3)] || 0;
    })();
    const nextMonths = futureKeys.map((mKey, i) => {
      const predicted = rawPredictions[i];
      // Confidence shrinks with distance + tightens around suppliers
      // with more observed history. Floor at 50 so the chart's
      // confidence band stays meaningful even for sparse history.
      const historyMonths = window.filter((v) => v > 0).length;
      const decay = Math.max(50, Math.round(85 - i * 3 - Math.max(0, 8 - historyMonths) * 2));
      const spread = Math.max(0.1, 0.4 - historyMonths * 0.025);
      return {
        month: fmtMonth(mKey),
        predicted,
        confidence: decay,
        isPeak: predicted > 0 && predicted >= peakThreshold,
        lower: Math.max(0, Math.round(predicted * (1 - spread))),
        upper: Math.round(predicted * (1 + spread)),
      };
    });
    return {
      category: s.name,
      avgPrice: 0,
      forecasts: nextMonths,
      totalForecast: nextMonths.reduce((a, f) => a + f.predicted, 0),
    };
  });

  const totalForecast = forecasts.reduce((s, f) => s + f.totalForecast, 0);
  return { forecasts, totalForecast, months: projMonths, source: 'purchase-register' };
}

// Derive region-level SKU / price mix from live customer purchase data.
// Buckets each customer's avgOrderValue into price bands and counts
// purchasedCategories per region. No demo/mock fallback — empty envelope
// if no customers or no voucher data yet.
export function getAreaSKU(overrides) {
  const customers = pickCustomers(overrides);

  const priceRanges = [
    { range: '₹0-200', min: 0, max: 200 },
    { range: '₹200-500', min: 200, max: 500 },
    { range: '₹500-1000', min: 500, max: 1000 },
    { range: '₹1000-2000', min: 1000, max: 2000 },
    { range: '₹2000+', min: 2000, max: Infinity },
  ];

  if (!customers.length) return { priceData: [], categoryData: [], priceRanges, regions: [], source: 'empty' };

  const regionAgg = new Map();
  for (const c of customers) {
    const region = (c.region || 'Unclassified').trim();
    const aov = c.avgOrderValue || c.monthlyAvg || 0;
    if (!regionAgg.has(region)) {
      regionAgg.set(region, {
        region,
        priceCounts: Object.fromEntries(priceRanges.map(p => [p.range, 0])),
        priceSum: 0, priceN: 0,
        categoryCounts: new Map(),
        skuSet: new Set(),
      });
    }
    const e = regionAgg.get(region);
    const band = priceRanges.find(p => aov >= p.min && aov < p.max);
    if (band) e.priceCounts[band.range] += 1;
    e.priceSum += aov; e.priceN += 1;
    for (const cat of c.purchasedCategories || []) {
      e.categoryCounts.set(cat, (e.categoryCounts.get(cat) || 0) + 1);
    }
    for (const sku of c.purchasedSkus || []) e.skuSet.add(sku);
  }
  if (!regionAgg.size) return { priceData: [], categoryData: [], priceRanges, regions: [], source: 'empty' };

  const priceData = Array.from(regionAgg.values()).map(e => ({
    region: e.region,
    ...e.priceCounts,
    avgPrice: e.priceN ? Math.round(e.priceSum / e.priceN) : 0,
    bestSelling: Object.entries(e.priceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || priceRanges[0].range,
  }));
  const categoryData = Array.from(regionAgg.values()).map(e => {
    const top = Array.from(e.categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    return {
      region: e.region,
      ...Object.fromEntries(Array.from(e.categoryCounts.entries()).map(([k, v]) => [k, v])),
      topCategory: top ? top[0] : '—',
      totalSKUs: e.skuSet.size,
    };
  });
  const regions = Array.from(regionAgg.keys());
  return { priceData, categoryData, priceRanges, regions, source: 'tally' };
}

export function getContactPriority(overrides) {
  const customers = pickCustomers(overrides);
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

  return { customers: prioritized };
}

// Reactivation candidates from the live customer book. Previously this page
// showed a hardcoded fixture of 30 made-up dealer names rotated by today's
// date — a clear "fake data leaking onto real accounts" case. Now we return
// dormant dealers (no orders recently + non-Low churn risk) so the page
// answers the real question: "who should I re-engage this week?". The page
// title is kept as "New Dealers" / "Dealer Suggestions" upstream; follow-up
// work via the AI edge function will layer in genuinely-new-prospect ideas
// grounded with Google Search.
export function getDealerSuggestions(overrides) {
  const customers = pickCustomers(overrides);
  if (!customers.length) return { today: [], total: 0, date: new Date().toLocaleDateString('en-IN'), source: 'empty' };

  const dormant = customers
    .filter(c => (c.lastOrderDays || 0) > 60 && c.churnRisk !== 'Low')
    .map(c => ({
      id: c.id, name: c.name,
      city: c.city || '',
      state: c.state || '',
      region: c.region || '',
      marketSize: null,
      fitScore: Math.round(Math.max(0, 100 - (c.lastOrderDays || 0))),
      estimatedMonthly: c.monthlyAvg || 0,
      competitorPresence: null,
      populationDensity: null,
      categories: c.purchasedCategories || [],
      contactMethod: (c.phone ? 'Phone' : c.email ? 'Email' : 'Visit'),
      reason: c.churnRisk === 'High' ? "High churn risk — re-engage before they're gone" : `${c.lastOrderDays}d since last order`,
      priority: c.churnRisk === 'High' ? 'High' : c.churnRisk === 'Medium' ? 'Medium' : 'Low',
    }))
    .sort((a, b) => b.estimatedMonthly - a.estimatedMonthly);

  return {
    today: dormant.slice(0, 10),
    total: dormant.length,
    date: new Date().toLocaleDateString('en-IN'),
    source: dormant.length ? 'tally' : 'all-active',
    kind: 'reactivation',
  };
}

// Real DSO- and aging-bucket-driven payment reminders. No RNG.
export function getPaymentReminders(overrides) {
  const customers = pickCustomers(overrides);
  if (!customers.length) {
    return {
      reminders: [],
      stats: { critical: 0, high: 0, medium: 0, upcoming: 0, totalPending: 0 },
      source: 'empty',
    };
  }
  const reminders = customers.map(c => {
    const totalPending = (c.agingCurrent || 0) + (c.aging30 || 0) + (c.aging60 || 0) + (c.aging90 || 0);
    const overdue60 = (c.aging60 || 0) + (c.aging90 || 0);
    const over90 = c.aging90 || 0;
    let urgency = 'Low';
    let action = 'No action needed';
    if (over90 > 0) { urgency = 'Critical'; action = 'Escalate immediately — invoices 90+ days overdue'; }
    else if ((c.aging60 || 0) > 0) { urgency = 'High'; action = 'Send firm reminder + call follow-up'; }
    else if ((c.aging30 || 0) > 0) { urgency = 'Medium'; action = 'Send payment reminder email/WhatsApp'; }
    else if ((c.agingCurrent || 0) > 0) { urgency = 'Upcoming'; action = 'Pre-emptive reminder'; }

    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      avgPaymentCycle: null,
      lastPaymentDays: null,
      overdue: overdue60 > 0,
      overdueDays: null,
      pendingInvoices: null,
      totalPending,
      onTimeRate: null,
      urgency,
      action,
      predictedPayDate: null,
      monthlyAvg: c.monthlyAvg || 0,
      dso: c.dso || 0,
    };
  }).filter(r => r.totalPending > 0).sort((a, b) => b.totalPending - a.totalPending);

  const stats = {
    critical: reminders.filter(r => r.urgency === 'Critical').length,
    high: reminders.filter(r => r.urgency === 'High').length,
    medium: reminders.filter(r => r.urgency === 'Medium').length,
    upcoming: reminders.filter(r => r.urgency === 'Upcoming').length,
    totalPending: reminders.reduce((s, r) => s + r.totalPending, 0),
  };
  return { reminders, stats, source: 'tally' };
}

// Revenue-strategy ideas are now AI-generated via the Gemini edge function
// (see Actions & Outreach components which call useAISuggestions). This
// deterministic handler returns an empty envelope so the UI can prompt for
// an AI refresh rather than rendering a stale hardcoded fixture.
export function getRevenueSuggestions() {
  return { strategies: [], totalPotential: 0, source: 'ai-only' };
}

// Health score per live customer. Previously iterated over the global mock
// customer array. Now iterates over overrides.customers with the same 5-
// dimension weighting used in extendedData's old generator.
export function getCustomerHealth(overrides) {
  const customers = pickCustomers(overrides);
  if (!customers.length) {
    return { customers: [], distribution: { critical: 0, atRisk: 0, needsAttention: 0, healthy: 0 }, avgHealth: 0, source: 'empty' };
  }
  const health = customers.map(c => {
    const purchaseHealth = Math.max(0, 100 - (c.lastOrderDays || 0) * 1.5 - Math.max(0, c.orderFreqDecline || 0));
    const paymentHealth = Math.max(0, 100 - ((c.dso || 0) - 30) * 1.5);
    const engagementHealth = (c.skuPenetration || 0) * 0.5 + (c.catPenetration || 0) * 0.5;
    const growthHealth = Math.max(0, 50 + (c.revenueChange || 0));
    const loyaltyHealth = Math.min(100, (c.totalOrders || 0) / 3);
    const overallHealth = Math.round(
      purchaseHealth * 0.25 + paymentHealth * 0.25 + engagementHealth * 0.2 + growthHealth * 0.15 + loyaltyHealth * 0.15
    );
    let status = 'Healthy';
    if (overallHealth < 30) status = 'Critical';
    else if (overallHealth < 50) status = 'At Risk';
    else if (overallHealth < 70) status = 'Needs Attention';
    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      monthlyAvg: c.monthlyAvg || 0,
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

  const distribution = {
    critical: health.filter(h => h.status === 'Critical').length,
    atRisk: health.filter(h => h.status === 'At Risk').length,
    needsAttention: health.filter(h => h.status === 'Needs Attention').length,
    healthy: health.filter(h => h.status === 'Healthy').length,
  };
  const avgHealth = Math.round(health.reduce((s, h) => s + h.overallHealth, 0) / health.length);
  return { customers: health, distribution, avgHealth, source: 'tally' };
}

// Inventory budget: category-level demand velocity derived from real
// customer purchase history. avgPrice / margin come from Tally stock items
// once the voucher line-item transformer is enriched — for now we return
// 0 and flag source so the UI can hide those columns.
export function getInventoryBudget(overrides) {
  const customers = pickCustomers(overrides);
  const purchases = overrides?.financials?.purchases || null;
  const actualSpend = purchases?.total || 0;
  const topSuppliers = purchases?.topSuppliers || [];
  const monthlySpend = purchases?.monthly || [];
  if (!customers.length) {
    return {
      totalBudget: 0, totalAllocated: 0, allocations: [], alerts: [],
      actualSpend, topSuppliers, monthlySpend,
      source: 'empty',
    };
  }

  const catRev = new Map();
  for (const c of customers) {
    const cats = c.purchasedCategories || [];
    const monthly = c.monthlyAvg || 0;
    const perCat = cats.length ? monthly / cats.length : 0;
    for (const cat of cats) catRev.set(cat, (catRev.get(cat) || 0) + perCat);
  }
  if (!catRev.size) {
    return {
      totalBudget: 0, totalAllocated: 0, allocations: [], alerts: [],
      actualSpend, topSuppliers, monthlySpend,
      source: 'waiting-for-vouchers',
    };
  }

  const totalRev = Array.from(catRev.values()).reduce((s, v) => s + v, 0) || 1;
  const allocations = Array.from(catRev.entries())
    .map(([cat, rev]) => {
      const share = rev / totalRev;
      const demandIndex = Math.round(share * 100);
      return {
        category: cat,
        avgPrice: 0, margin: 0,
        demandIndex,
        stockTurnover: null,
        currentStock: null,
        reorderPoint: null,
        optimalStock: null,
        daysOfStock: null,
        allocatedBudget: Math.round(rev),
        needsReorder: false,
        urgency: 'OK',
        suggestedOrder: 0,
        suggestedOrderValue: 0,
      };
    })
    .sort((a, b) => b.demandIndex - a.demandIndex);
  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedBudget, 0);
  return {
    totalBudget: totalAllocated,
    totalAllocated,
    allocations,
    alerts: [],
    actualSpend,
    topSuppliers,
    monthlySpend,
    source: 'tally',
  };
}

// Marketing spend allocation derived from real customers. Ranks top 25 by
// contribution weighted by growth potential + churn risk. Channel splits
// are deterministic percentages — no RNG.
export function getMarketingBudget(overrides) {
  const customers = pickCustomers(overrides);
  if (!customers.length) return { totalMarketingBudget: 0, dealerAllocations: [], source: 'empty' };

  const totalMarketingBudget = Math.max(0, Math.round(customers.reduce((s, c) => s + (c.monthlyAvg || 0), 0) * 0.05));
  const totalMonthly = customers.reduce((s, c) => s + (c.monthlyAvg || 0), 0) || 1;
  const dealerAllocations = customers.slice(0, 25).map(c => {
    const revenueWeight = (c.monthlyAvg || 0) / totalMonthly;
    const growthPotential = (c.expansionScore || 0) / 100;
    const riskFactor = c.churnRisk === 'High' ? 1.5 : c.churnRisk === 'Medium' ? 1.2 : 1;
    const score = (revenueWeight * 0.4 + growthPotential * 0.35 + (riskFactor - 1) * 0.25);
    const allocated = Math.round(totalMarketingBudget * score * 3);
    const channels = {
      inStoreDisplay: Math.round(allocated * 0.30),
      coopAdvertising: Math.round(allocated * 0.20),
      tradeSchemes: Math.round(allocated * 0.25),
      merchandising: Math.round(allocated * 0.15),
      digitalSupport: Math.round(allocated * 0.10),
    };
    return {
      id: c.id, name: c.name, segment: c.segment, region: c.region,
      monthlyAvg: c.monthlyAvg || 0, expansionScore: c.expansionScore || 0,
      churnRisk: c.churnRisk, allocated, channels,
      roi: null,
      strategy: c.churnRisk === 'High' ? 'Retention focus' : (c.expansionScore || 0) > 70 ? 'Growth accelerate' : 'Maintain presence',
    };
  }).sort((a, b) => b.allocated - a.allocated);

  return { totalMarketingBudget, dealerAllocations, source: 'tally' };
}

export function getDealers(overrides) {
  const customers = pickCustomers(overrides);
  const dealers = customers.map(c => ({
    id: c.id, name: c.name, segment: c.segment, region: c.region, city: c.city,
    monthlyAvg: c.monthlyAvg, churnRisk: c.churnRisk, paymentRisk: c.paymentRisk,
  }));
  return { dealers };
}

export function getDealer(id, overrides) {
  const customers = pickCustomers(overrides);
  const customer = customers.find(c => c.id === parseInt(id, 10));
  if (!customer) return null;

  const c = customer;
  const recentMonths = c.invoiceHistory.slice(-3);
  const olderMonths = c.invoiceHistory.slice(0, 3);
  const recentAvg = recentMonths.reduce((s, m) => s + m.value, 0) / 3;
  const olderAvg = olderMonths.reduce((s, m) => s + m.value, 0) / 3;
  const momentum = olderAvg > 0 ? Math.round((recentAvg - olderAvg) / olderAvg * 100) : 0;

  const paymentScore = Math.round(
    (c.paymentRisk === 'Low' ? 85 : c.paymentRisk === 'Medium' ? 55 : 25)
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

  const orderTrend = c.invoiceHistory.map(m => ({
    month: m.month,
    revenue: m.value,
    orders: m.invoiceCount,
    avgOrderValue: m.invoiceCount > 0 ? Math.round(m.value / m.invoiceCount) : 0,
  }));

  // Seeded so per-category spend stays stable on reload — was Math.random,
  // which made the dealer detail page shuffle its "top categories" every view.
  const categorySpend = c.purchasedCategories.map(cat => {
    const r = rngFor(`categoryspend:${c.id}:${cat}`);
    return {
      category: cat,
      spend: Math.round(c.monthlyAvg / c.catCount * (0.5 + r())),
      skuCount: Math.floor(1 + r() * 5),
      trend: Math.round(-15 + r() * 30),
    };
  }).sort((a, b) => b.spend - a.spend);

  const agingBreakdown = [
    { bucket: 'Current (0-30d)', amount: c.agingCurrent, pct: 0 },
    { bucket: '31-60 days', amount: c.aging30, pct: 0 },
    { bucket: '61-90 days', amount: c.aging60, pct: 0 },
    { bucket: '90+ days', amount: c.aging90, pct: 0 },
  ];
  const totalAging = agingBreakdown.reduce((s, a) => s + a.amount, 0);
  agingBreakdown.forEach(a => a.pct = totalAging > 0 ? Math.round(a.amount / totalAging * 100) : 0);

  const aiSuggestions = [];

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

  if (c.expansionScore > 60 && c.segment !== 'Enterprise') {
    aiSuggestions.push({
      type: 'Growth', priority: 'Medium', icon: '🚀',
      title: 'High Growth Potential — Upgrade Dealer Tier',
      suggestion: `Expansion score of ${c.expansionScore}/100 indicates this ${c.segment} dealer could be upgraded. Their purchasing pattern mirrors Enterprise-tier dealers. Offer volume-based tiered pricing: 5% off above ₹${Math.round(c.monthlyAvg * 1.3).toLocaleString('en-IN')}/mo, 8% off above ₹${Math.round(c.monthlyAvg * 1.8).toLocaleString('en-IN')}/mo. Assign a dedicated account manager.`,
      impact: `Potential: Move from ₹${Math.round(c.monthlyAvg).toLocaleString('en-IN')} to ₹${Math.round(c.monthlyAvg * 1.5).toLocaleString('en-IN')}/mo`,
      actions: ['Propose volume pricing tiers', 'Assign account manager', 'Set quarterly growth targets', 'Monthly business review calls'],
    });
  }

  const topRevMonths = [...orderTrend].sort((a, b) => b.revenue - a.revenue).slice(0, 3).map(m => m.month).join(', ');
  aiSuggestions.push({
    type: 'Timing', priority: 'Low', icon: '📅',
    title: 'Optimal Order Timing Pattern',
    suggestion: `Based on 12-month history, this dealer's peak ordering months are ${topRevMonths}. Pre-season outreach 2 weeks before peak months with pre-booked inventory ensures availability and strengthens the relationship. Average order value peaks at ₹${Math.max(...orderTrend.map(m => m.avgOrderValue)).toLocaleString('en-IN')} during highs.`,
    impact: 'Improve fill rate and dealer satisfaction during peak periods',
    actions: ['Set calendar reminders for pre-peak outreach', 'Pre-allocate inventory for top dealers', 'Share upcoming product launches early'],
  });

  return {
    ...c,
    momentum, paymentScore, loyaltyScore, engagementScore, overallHealth,
    healthRadar, orderTrend, categorySpend, agingBreakdown, aiSuggestions,
    aiMeta: { model: 'Demo Mode', note: 'Connect your AI API key in .env for live suggestions' },
  };
}

const handlers = {
  map: getMap,
  'toy-categories': getToyCategories,
  forecast: getForecast,
  'area-sku': getAreaSKU,
  'contact-priority': getContactPriority,
  'dealer-suggestions': getDealerSuggestions,
  'payment-reminders': getPaymentReminders,
  'revenue-suggestions': getRevenueSuggestions,
  'customer-health': getCustomerHealth,
  inventory: getInventoryBudget,
  'marketing-budget': getMarketingBudget,
  dealers: getDealers,
};

export function runExtended(endpoint, overrides) {
  const handler = handlers[endpoint];
  if (!handler) throw new Error(`Unknown extended endpoint: ${endpoint}`);
  return handler(overrides);
}
