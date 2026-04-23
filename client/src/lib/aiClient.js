// Client for the ai-suggest Supabase Edge Function. Builds a compact data
// summary from real Tally customers and asks Gemini for structured
// suggestions grounded with Google Search. The API key never touches the
// browser — it lives as a Supabase secret and is read only inside the
// edge function.

import { supabase, HAS_SUPABASE } from '../utils/supabase';

export const AI_AVAILABLE = HAS_SUPABASE;

// Reduce a live customer array to the data the model actually needs.
// Trimming aggressively keeps the prompt small (important for latency +
// cost) and stops us leaking PII that's irrelevant to the task.
function summarizeCustomers(customers, opts = {}) {
  const { topN = 15 } = opts;
  const list = Array.isArray(customers) ? customers : [];
  const total = list.length;
  const totalRevenue = list.reduce((s, c) => s + (c.monthlyAvg || 0) * 12, 0);

  const churnCounts = { High: 0, Medium: 0, Low: 0 };
  const paymentCounts = { High: 0, Medium: 0, Low: 0 };
  const categoryCount = new Map();
  const regionCount = new Map();

  for (const c of list) {
    churnCounts[c.churnRisk] = (churnCounts[c.churnRisk] || 0) + 1;
    paymentCounts[c.paymentRisk] = (paymentCounts[c.paymentRisk] || 0) + 1;
    for (const cat of c.purchasedCategories || []) categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1);
    if (c.region) regionCount.set(c.region, (regionCount.get(c.region) || 0) + 1);
  }

  const topRevenue = [...list].sort((a, b) => (b.monthlyAvg || 0) - (a.monthlyAvg || 0)).slice(0, topN);
  const topRisk = [...list].sort((a, b) => {
    const score = (c) => (c.churnRisk === 'High' ? 3 : c.churnRisk === 'Medium' ? 2 : 1)
      + (c.paymentRisk === 'High' ? 3 : c.paymentRisk === 'Medium' ? 2 : 1);
    return score(b) - score(a);
  }).slice(0, topN);

  const projectDealer = (c) => ({
    name: c.name,
    segment: c.segment,
    region: c.region,
    city: c.city || null,
    state: c.state || null,
    monthlyAvg: c.monthlyAvg,
    outstanding: c.outstandingAmount,
    dso: c.dso,
    churnRisk: c.churnRisk,
    paymentRisk: c.paymentRisk,
    lastOrderDays: c.lastOrderDays,
    catPenetration: c.catPenetration,
    skuPenetration: c.skuPenetration,
    revenueChange: c.revenueChange,
    purchasedCategories: (c.purchasedCategories || []).slice(0, 6),
  });

  const agingTotals = {
    current: list.reduce((s, c) => s + (c.agingCurrent || 0), 0),
    d30: list.reduce((s, c) => s + (c.aging30 || 0), 0),
    d60: list.reduce((s, c) => s + (c.aging60 || 0), 0),
    d90: list.reduce((s, c) => s + (c.aging90 || 0), 0),
  };

  return {
    totals: {
      dealers: total,
      annualRevenue: Math.round(totalRevenue),
      churnCounts,
      paymentCounts,
      agingTotals,
    },
    topCategories: Array.from(categoryCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
    topRegions: Array.from(regionCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    topByRevenue: topRevenue.map(projectDealer),
    topByRisk: topRisk.map(projectDealer),
  };
}

// Thin wrapper around supabase.functions.invoke('ai-suggest'). Returns the
// same shape the edge function returns: { summary, suggestions, citations,
// model, cached, configured, error, setupHint }.
export async function requestAISuggestions({ task, customers, tenantKey = 'default', forceRefresh = false, extraContext = {} }) {
  if (!AI_AVAILABLE) {
    return {
      configured: false,
      error: 'AI needs Supabase — this deployment does not have VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY configured.',
    };
  }
  const context = { ...summarizeCustomers(customers), ...extraContext };
  const { data, error } = await supabase.functions.invoke('ai-suggest', {
    body: { action: 'suggest', task, context, tenantKey, forceRefresh },
  });
  if (error) {
    return { configured: true, error: error.message || 'AI call failed' };
  }
  return data || {};
}
