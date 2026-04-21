/**
 * Tally Data Transformer
 * Converts raw Tally XML data into the structured format our dashboard expects.
 * Maps Tally ledgers → customers, vouchers → invoices/payments, stock items → SKUs.
 */

import { parseAmount, parseTallyDate, daysSince } from './tallyConnector.js';

// ─── MAIN TRANSFORMER ───────────────────────────────────────────────────────

export function transformTallyData(raw) {
  console.log('[Transform] Processing Tally data...');

  const stockGroups = transformStockGroups(raw.stockGroups || []);
  const stockItems = transformStockItems(raw.stockItems || [], stockGroups);
  const categories = [...new Set(stockItems.map(s => s.category).filter(Boolean))];

  // Build customer data from ledgers + sales + receipts
  const customers = transformCustomers(
    raw.ledgers || [],
    raw.salesVouchers || [],
    raw.receiptVouchers || [],
    stockItems,
    categories
  );

  console.log(`[Transform] Result: ${customers.length} customers, ${stockItems.length} SKUs, ${categories.length} categories`);

  return { customers, stockItems, categories, stockGroups, raw };
}

// ─── STOCK GROUPS → CATEGORIES ───────────────────────────────────────────────

function transformStockGroups(groups) {
  return groups.map(g => ({
    name: g.NAME || g._NAME || g.name || '',
    parent: g.PARENT || g._PARENT || '',
  }));
}

// ─── STOCK ITEMS → SKUs ──────────────────────────────────────────────────────

function transformStockItems(items, groups) {
  return items.map((item, i) => {
    const name = item.NAME || item._NAME || `Item-${i + 1}`;
    const parent = item.PARENT || item._PARENT || '';
    const category = item.CATEGORY || parent || 'Uncategorized';
    const closingBal = parseQty(item.CLOSINGBALANCE);
    const closingRate = parseAmount(item.CLOSINGRATE);
    const closingVal = parseAmount(item.CLOSINGVALUE);
    const openingVal = parseAmount(item.OPENINGVALUE);
    const hsnCode = item.HSNCODE || '';

    return {
      id: `SKU-${String(i + 1).padStart(3, '0')}`,
      name,
      category,
      parent,
      hsnCode,
      baseUnits: item.BASEUNITS || '',
      closingStock: closingBal,
      closingRate,
      closingValue: closingVal,
      openingValue: openingVal,
      price: closingRate || (closingBal > 0 ? Math.round(closingVal / closingBal) : 0),
      margin: 15 + Math.random() * 30, // Can't derive from Tally directly — will refine later
      avgMonthlyUnits: Math.floor(closingBal / 3), // Rough estimate
    };
  });
}

// ─── LEDGERS + VOUCHERS → CUSTOMERS ──────────────────────────────────────────

function transformCustomers(ledgers, salesVouchers, receiptVouchers, stockItems, categories) {
  // Index sales and receipts by party name
  const salesByParty = groupBy(salesVouchers, v =>
    v.PARTYLEDGERNAME || v.PARTYNAME || extractPartyFromEntries(v)
  );
  const receiptsByParty = groupBy(receiptVouchers, v =>
    v.PARTYLEDGERNAME || v.PARTYNAME || extractPartyFromEntries(v)
  );

  return ledgers.map((ledger, i) => {
    const name = ledger.NAME || ledger._NAME || `Dealer-${i + 1}`;
    const partySales = salesByParty[name] || [];
    const partyReceipts = receiptsByParty[name] || [];

    // ─── Basic Info ────────────────────────────────────────────────────
    const address = extractAddress(ledger.ADDRESS);
    const state = ledger.LEDSTATENAME || ledger.STATENAME || extractState(address);
    const region = stateToRegion(state);
    const city = extractCity(address, state);
    const gstin = ledger.PARTYGSTIN || ledger.GSTREGISTRATIONNUMBER || '';
    const creditLimit = parseAmount(ledger.CREDITLIMIT);
    const creditPeriod = parseInt(ledger.CREDITPERIOD) || 30;
    const closingBalance = parseAmount(ledger.CLOSINGBALANCE);
    const openingBalance = parseAmount(ledger.OPENINGBALANCE);

    // ─── Sales Analysis ────────────────────────────────────────────────
    const sortedSales = partySales
      .map(v => ({ date: parseTallyDate(v.DATE), amount: parseAmount(v.AMOUNT), voucher: v }))
      .filter(s => s.date && !isNaN(s.date))
      .sort((a, b) => a.date - b.date);

    const totalRevenue = sortedSales.reduce((s, v) => s + v.amount, 0);
    const monthCount = sortedSales.length > 0
      ? Math.max(1, monthsBetween(sortedSales[0].date, sortedSales[sortedSales.length - 1].date))
      : 1;
    const monthlyAvg = Math.round(totalRevenue / monthCount);

    // Monthly invoice history (last 12 months)
    const invoiceHistory = buildMonthlyHistory(sortedSales, 12);

    // Last order
    const lastOrderDate = sortedSales.length > 0 ? sortedSales[sortedSales.length - 1].date : null;
    const lastOrderDays = lastOrderDate ? daysSince(formatTallyDate(lastOrderDate)) : 999;

    // Order frequency analysis
    const recentHalf = invoiceHistory.slice(-6);
    const olderHalf = invoiceHistory.slice(0, 6);
    const recentAvg = avg(recentHalf.map(m => m.value));
    const olderAvg = avg(olderHalf.map(m => m.value));
    const revenueChange = olderAvg > 0 ? Math.round((recentAvg - olderAvg) / olderAvg * 100 * 10) / 10 : 0;

    const recentOrders = sum(recentHalf.map(m => m.invoiceCount));
    const olderOrders = sum(olderHalf.map(m => m.invoiceCount));
    const orderFreqDecline = olderOrders > 0 ? Math.round((olderOrders - recentOrders) / olderOrders * 100 * 10) / 10 : 0;

    // ─── Product Analysis ──────────────────────────────────────────────
    const purchasedItems = extractPurchasedItems(partySales);
    const purchasedCategories = [...new Set(purchasedItems.map(item => {
      const si = stockItems.find(s => s.name === item);
      return si?.category;
    }).filter(Boolean))];
    const missedCategories = categories.filter(c => !purchasedCategories.includes(c));
    const skuCount = purchasedItems.length;
    const catCount = purchasedCategories.length;
    const skuPenetration = stockItems.length > 0 ? Math.round((skuCount / stockItems.length) * 100) : 0;
    const catPenetration = categories.length > 0 ? Math.round((catCount / categories.length) * 100) : 0;
    const expansionScore = Math.min(100, Math.round(
      (catPenetration * 0.3) + (skuPenetration * 0.2) + (revenueChange > 0 ? 20 : 0) + (monthlyAvg > 50000 ? 20 : monthlyAvg > 20000 ? 10 : 0) + (100 - Math.min(100, lastOrderDays * 2)) * 0.1
    ));

    // ─── Payment Analysis ──────────────────────────────────────────────
    const sortedReceipts = partyReceipts
      .map(v => ({ date: parseTallyDate(v.DATE), amount: parseAmount(v.AMOUNT), voucher: v }))
      .filter(r => r.date && !isNaN(r.date))
      .sort((a, b) => a.date - b.date);

    // Compute DSO (Days Sales Outstanding)
    const dso = computeDSO(closingBalance, monthlyAvg);

    // Payment history
    const paymentHistory = buildPaymentHistory(sortedSales, sortedReceipts, 12);

    // Aging buckets (estimate from closing balance and DSO)
    const aging = estimateAging(closingBalance, dso);

    // ─── Risk Scores ───────────────────────────────────────────────────
    // Churn risk
    let churnScore = 0;
    churnScore += Math.min(30, lastOrderDays);
    churnScore += Math.max(0, orderFreqDecline) * 0.8;
    churnScore += Math.max(0, -revenueChange) * 0.6;
    churnScore += (100 - skuPenetration) * 0.1;
    churnScore += (100 - catPenetration) * 0.1;
    churnScore = Math.min(99, Math.max(1, Math.round(churnScore)));

    const churnRisk = churnScore > 60 ? 'High' : churnScore > 35 ? 'Medium' : 'Low';

    const churnReasons = [];
    if (orderFreqDecline > 15) churnReasons.push('Order frequency declining');
    if (lastOrderDays > 30) churnReasons.push(`No orders in ${lastOrderDays} days`);
    if (revenueChange < -15) churnReasons.push(`Invoice value dropping ${Math.abs(Math.round(revenueChange))}%`);
    if (catCount < 3) churnReasons.push('Low category engagement');
    if (skuPenetration < 20) churnReasons.push('Very low SKU adoption');

    // Payment risk
    const paymentRisk = dso > 75 ? 'High' : dso > 40 ? 'Medium' : 'Low';

    // ─── Segment ───────────────────────────────────────────────────────
    const segment = monthlyAvg > 80000 ? 'Enterprise' : monthlyAvg > 30000 ? 'Mid-Market' : 'SMB';

    // LTV estimate
    const ltv = Math.round(monthlyAvg * 24);

    return {
      id: i + 1,
      name,
      segment,
      region,
      city,
      gstin,
      state,
      address,
      phone: ledger.LEDGERPHONE || ledger.LEDGERMOBILE || '',
      email: ledger.EMAIL || '',
      contact: ledger.LEDGERCONTACT || '',
      monthlyAvg,
      totalRevenue,
      churnRisk,
      churnScore,
      churnReasons: churnReasons.length ? churnReasons : ['Stable purchasing pattern'],
      paymentRisk,
      dso: Math.round(dso),
      agingCurrent: aging.current,
      aging30: aging.d30,
      aging60: aging.d60,
      aging90: aging.d90,
      skuCount,
      catCount,
      skuPenetration,
      catPenetration,
      expansionScore,
      purchasedCategories,
      missedCategories,
      lastOrderDays,
      orderFreqDecline,
      revenueChange,
      ltv,
      invoiceHistory,
      paymentHistory,
      actionWindow: churnRisk === 'High' ? 'This week' : churnRisk === 'Medium' ? 'This month' : 'Quarterly review',
      paymentTrend: dso > 60 ? 'Worsening' : dso > 35 ? 'Flat' : 'Improving',
      lastContacted: Math.floor(Math.random() * 30), // No Tally data for this
      totalOrders: sortedSales.length,
      avgOrderValue: sortedSales.length > 0 ? Math.round(totalRevenue / sortedSales.length) : 0,
      creditLimit: creditLimit || Math.round(monthlyAvg * 2.5),
      outstandingAmount: Math.round(closingBalance),
      openingBalance: Math.round(openingBalance),
      joinedDate: sortedSales.length > 0 ? sortedSales[0].date.toISOString().slice(0, 10) : '2024-01-01',
    };
  }).filter(c => c.totalRevenue > 0 || c.outstandingAmount > 0); // Only include active dealers
}

// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────

function buildMonthlyHistory(sortedSales, months) {
  const now = new Date();
  const history = [];
  for (let m = months - 1; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const monthKey = d.toLocaleString('en-US', { month: 'short' });
    const yearKey = d.getFullYear().toString().slice(-2);
    const monthSales = sortedSales.filter(s =>
      s.date.getMonth() === d.getMonth() && s.date.getFullYear() === d.getFullYear()
    );
    history.push({
      month: `${monthKey} '${yearKey}`,
      value: Math.round(monthSales.reduce((s, v) => s + v.amount, 0)),
      invoiceCount: monthSales.length,
    });
  }
  return history;
}

function buildPaymentHistory(sortedSales, sortedReceipts, months) {
  const now = new Date();
  const history = [];
  for (let m = months - 1; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const monthKey = d.toLocaleString('en-US', { month: 'short' });
    const monthSales = sortedSales.filter(s =>
      s.date.getMonth() === d.getMonth() && s.date.getFullYear() === d.getFullYear()
    );
    const monthReceipts = sortedReceipts.filter(r =>
      r.date.getMonth() === d.getMonth() && r.date.getFullYear() === d.getFullYear()
    );
    const salesAmt = sum(monthSales.map(s => s.amount));
    const receiptAmt = sum(monthReceipts.map(r => r.amount));
    const onTimeRate = salesAmt > 0 ? Math.min(100, Math.round(receiptAmt / salesAmt * 100)) : 100;

    history.push({
      month: monthKey,
      onTime: onTimeRate,
      late: Math.max(0, 100 - onTimeRate),
      dso: salesAmt > 0 ? Math.round((salesAmt - receiptAmt) / salesAmt * 30) : 0,
    });
  }
  return history;
}

function computeDSO(outstanding, monthlyAvg) {
  if (monthlyAvg <= 0) return 0;
  return Math.max(0, Math.round((outstanding / monthlyAvg) * 30));
}

function estimateAging(outstanding, dso) {
  if (outstanding <= 0) return { current: 0, d30: 0, d60: 0, d90: 0 };
  if (dso <= 30) return { current: outstanding, d30: 0, d60: 0, d90: 0 };
  if (dso <= 60) return {
    current: Math.round(outstanding * 0.6),
    d30: Math.round(outstanding * 0.4),
    d60: 0, d90: 0,
  };
  if (dso <= 90) return {
    current: Math.round(outstanding * 0.4),
    d30: Math.round(outstanding * 0.3),
    d60: Math.round(outstanding * 0.3),
    d90: 0,
  };
  return {
    current: Math.round(outstanding * 0.25),
    d30: Math.round(outstanding * 0.25),
    d60: Math.round(outstanding * 0.25),
    d90: Math.round(outstanding * 0.25),
  };
}

function extractPurchasedItems(salesVouchers) {
  const items = new Set();
  for (const v of salesVouchers) {
    const entries = v['ALLINVENTORYENTRIES.LIST'] || v.ALLINVENTORYENTRIES || v['INVENTORYENTRIES.LIST'] || [];
    const list = Array.isArray(entries) ? entries : [entries];
    for (const e of list) {
      const name = e?.STOCKITEMNAME || e?.ITEMNAME || '';
      if (name) items.add(name);
    }
  }
  return [...items];
}

function extractPartyFromEntries(voucher) {
  const entries = voucher['ALLLEDGERENTRIES.LIST'] || voucher.ALLLEDGERENTRIES || voucher['LEDGERENTRIES.LIST'] || [];
  const list = Array.isArray(entries) ? entries : [entries];
  for (const e of list) {
    const name = e?.LEDGERNAME || '';
    if (name && name !== 'Sales' && name !== 'Cash' && !name.includes('Tax') && !name.includes('GST')) {
      return name;
    }
  }
  return 'Unknown';
}

function extractAddress(addr) {
  if (!addr) return '';
  if (Array.isArray(addr)) return addr.filter(Boolean).join(', ');
  if (typeof addr === 'object') return addr._text || addr.LIST?.join(', ') || JSON.stringify(addr);
  return String(addr);
}

function extractCity(address, state) {
  if (!address) return state || 'Unknown';
  // Try to extract city from address (usually before state/pincode)
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 2) return parts[parts.length - 2] || parts[0];
  return parts[0] || state || 'Unknown';
}

function extractState(address) {
  const states = ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Gujarat', 'Rajasthan',
    'Uttar Pradesh', 'Madhya Pradesh', 'West Bengal', 'Telangana', 'Andhra Pradesh',
    'Kerala', 'Punjab', 'Haryana', 'Bihar', 'Odisha', 'Jharkhand', 'Assam', 'Goa',
    'Chhattisgarh', 'Uttarakhand', 'Himachal Pradesh', 'Jammu and Kashmir'];
  if (!address) return '';
  for (const st of states) {
    if (address.toLowerCase().includes(st.toLowerCase())) return st;
  }
  return '';
}

function stateToRegion(state) {
  const north = ['Delhi', 'Uttar Pradesh', 'Haryana', 'Punjab', 'Rajasthan', 'Himachal Pradesh', 'Uttarakhand', 'Jammu and Kashmir', 'Chandigarh'];
  const south = ['Karnataka', 'Tamil Nadu', 'Kerala', 'Telangana', 'Andhra Pradesh', 'Goa'];
  const east = ['West Bengal', 'Bihar', 'Odisha', 'Jharkhand', 'Assam', 'Chhattisgarh'];
  const west = ['Maharashtra', 'Gujarat', 'Madhya Pradesh'];
  if (north.includes(state)) return 'North';
  if (south.includes(state)) return 'South';
  if (east.includes(state)) return 'East';
  if (west.includes(state)) return 'West';
  return 'Other';
}

function groupBy(arr, keyFn) {
  const map = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return map;
}

function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function sum(arr) { return arr.reduce((s, v) => s + v, 0); }

function monthsBetween(d1, d2) {
  return Math.max(1, (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()));
}

function formatTallyDate(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function parseQty(val) {
  if (!val) return 0;
  const str = String(val._text || val).replace(/[^0-9.\-]/g, '');
  return Math.abs(parseFloat(str) || 0);
}

export default { transformTallyData };
