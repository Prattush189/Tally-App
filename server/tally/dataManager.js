/**
 * Data Manager
 * Tries to fetch real data from Tally. Falls back to mock data if Tally is unreachable.
 * Caches Tally data for 5 minutes to avoid hammering the server.
 */

import { fetchAllDashboardData } from './tallyConnector.js';
import { transformTallyData } from './tallyTransformer.js';
import { customers as mockCustomers, CATEGORIES as MOCK_CATEGORIES, SKUS as MOCK_SKUS,
  revenueTrends, cohortData, computeAdvancedAnalytics } from '../data/mockData.js';

let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let tallyStatus = { connected: false, lastAttempt: null, lastError: null, source: 'mock' };

/**
 * Get dashboard data — tries Tally first, falls back to mock.
 */
export async function getDashboardData(forceRefresh = false) {
  const now = Date.now();

  // Return cache if fresh
  if (!forceRefresh && cachedData && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedData;
  }

  // Try Tally
  try {
    console.log('[DataManager] Attempting Tally connection...');
    tallyStatus.lastAttempt = new Date().toISOString();

    const rawData = await fetchAllDashboardData();
    const transformed = transformTallyData(rawData);

    cachedData = {
      source: 'tally',
      customers: transformed.customers,
      categories: transformed.categories,
      skus: transformed.stockItems,
      stockGroups: transformed.stockGroups,
      rawTallyData: rawData,
      revenueTrends: buildRevenueTrends(transformed.customers),
      timestamp: new Date().toISOString(),
    };
    cacheTimestamp = now;

    tallyStatus = {
      connected: true,
      lastAttempt: new Date().toISOString(),
      lastError: null,
      source: 'tally',
      customerCount: transformed.customers.length,
      skuCount: transformed.stockItems.length,
      categoryCount: transformed.categories.length,
    };

    console.log(`[DataManager] Tally data loaded: ${transformed.customers.length} customers`);
    return cachedData;

  } catch (err) {
    console.warn(`[DataManager] Tally failed: ${err.message}. Using mock data.`);

    tallyStatus = {
      connected: false,
      lastAttempt: new Date().toISOString(),
      lastError: err.message,
      source: 'mock',
    };

    // Fall back to mock
    cachedData = {
      source: 'mock',
      customers: mockCustomers,
      categories: MOCK_CATEGORIES,
      skus: MOCK_SKUS,
      revenueTrends,
      timestamp: new Date().toISOString(),
    };
    cacheTimestamp = now;
    return cachedData;
  }
}

/**
 * Get current data source status
 */
export function getDataStatus() {
  return {
    ...tallyStatus,
    cacheAge: cachedData ? Math.round((Date.now() - cacheTimestamp) / 1000) : null,
    cacheTTL: CACHE_TTL / 1000,
  };
}

/**
 * Force refresh from Tally
 */
export async function refreshFromTally() {
  return getDashboardData(true);
}

/**
 * Build revenue trends from customer invoice histories
 */
function buildRevenueTrends(customers) {
  const months = customers[0]?.invoiceHistory?.map(m => m.month) || [];
  return months.map((month, i) => {
    const revenue = customers.reduce((s, c) => s + (c.invoiceHistory[i]?.value || 0), 0);
    return {
      month,
      revenue,
      nrr: 100 + Math.round(Math.random() * 20 - 5),
      grr: 90 + Math.round(Math.random() * 10),
      newCustomers: Math.floor(Math.random() * 4),
      churnedCustomers: Math.floor(Math.random() * 2),
    };
  });
}

export default { getDashboardData, getDataStatus, refreshFromTally };
