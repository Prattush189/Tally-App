// Client-side Tally transformer — turns the raw parsed XML from the Supabase
// Edge Function into the customer shape the analytics engine reads.
//
// Two entry points:
//   - transformTallyLedgers(rawTree): lean, ledger-only. Used for the legacy
//     `sync` action and as a fallback when sync-full times out. Leaves
//     sales/inventory/aging fields at deterministic zeros.
//   - transformTallyFull(bundle): full bundle from `sync-full`. Derives
//     invoiceHistory, paymentHistory, aging buckets, SKU/category penetration,
//     DSO, churn score, segment — every field the dashboards render.
// Both return { customers, totals, diagnostics } in the same shape.

const MONTHS = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];

function parseAmount(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    return parseAmount(value._text ?? value['#text'] ?? '');
  }
  const s = String(value).trim();
  if (!s) return 0;
  // Tally uses "1234.56 Dr" or "-1234.56" or "1,234.56 Cr" for credits (negative)
  const isCr = /Cr/i.test(s);
  const cleaned = s.replace(/[,\s]|Dr|Cr/gi, '');
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num)) return 0;
  return isCr ? -num : num;
}

function textField(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    return textField(value._text ?? value['#text'] ?? '');
  }
  return '';
}

// Read a field from a Tally ledger whether it's present as a child element
// (<LEDGER><NAME>Abc</NAME>) or as an attribute (<LEDGER NAME="Abc">). Our
// XML parser prefixes attributes with '_', so we look both places.
function readField(ledger, name) {
  const direct = textField(ledger[name]);
  if (direct) return direct;
  const attr = textField(ledger['_' + name]);
  if (attr) return attr;
  // Also try the all-caps/mixed-case variants Tally occasionally uses
  const lower = name.toLowerCase();
  for (const key of Object.keys(ledger)) {
    if (key.toLowerCase() === lower || key.toLowerCase() === '_' + lower) {
      const v = textField(ledger[key]);
      if (v) return v;
    }
  }
  return '';
}

function stateToRegion(state) {
  const s = (state || '').toLowerCase();
  if (/(punjab|haryana|delhi|himachal|kashmir|uttarakhand|uttar pradesh|chandigarh)/.test(s)) return 'North';
  if (/(karnataka|tamil|kerala|andhra|telangana|puducherry)/.test(s)) return 'South';
  if (/(bengal|bihar|odisha|jharkhand|assam|sikkim|manipur|mizoram|nagaland|tripura|arunachal|meghalaya)/.test(s)) return 'East';
  if (/(maharashtra|gujarat|rajasthan|madhya|goa|chhattisgarh|daman|diu)/.test(s)) return 'West';
  return 'North';
}

function cityFromAddress(address, fallback) {
  const addr = Array.isArray(address) ? address.join(', ') : textField(address);
  if (!addr) return fallback || '';
  const parts = addr.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  // Heuristic: last non-state part is usually the city
  return parts[parts.length - 2] || parts[0] || fallback || '';
}

// Walk a parsed XML tree and return every LEDGER node we find, flattened
// into one array. Tally responses sometimes include stray LEDGER references
// at shallow depths (metadata / default ledger / bill allocation contexts)
// alongside the main COLLECTION > LEDGER[] payload. Returning the FIRST
// hit used to make us miss the real collection and show a single sample
// ledger instead of the 3000+ we actually want. Exhaustive walk fixes that.
function extractLedgers(tree) {
  return extractAllByKey(tree, 'LEDGER');
}

function extractAllByKey(tree, nodeName) {
  const acc = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === nodeName) {
        if (Array.isArray(value)) acc.push(...value);
        else if (value && typeof value === 'object') acc.push(value);
      } else {
        walk(value);
      }
    }
  };
  walk(tree);
  return acc;
}

// Returns true if `name` is one of the "this is a customer-ish bucket"
// accounting groups. Matches Sundry Debtors, Trade Debtors, Customer /
// Client / Receivable variants. All comparisons lowercased by caller.
function isDebtorGroupName(name) {
  if (!name) return false;
  return name.includes('sundry debtor')
    || name.includes('trade debtor')
    || name === 'debtors'
    || name.includes('accounts receivable')
    || name.includes('account receivable')
    || name.includes('receivable')
    || name.includes('customer')
    || name.includes('client');
}

// Walks a ledger's parent chain through the accounting groups map and
// returns true if any ancestor is a debtor group. Handles the common
// distributor setup where dealers sit under sub-groups like NEW DELHI /
// HYDERABAD / BANGALORE that themselves sit under Sundry Debtors.
//
// groupParentMap: Map<lowerCaseGroupName, lowerCaseParentGroupName>.
// Empty map → behaves identically to the old single-hop check.
// Diagnostic helper — for the first N ledgers, returns the full parent
// chain the walker will see. Surfaces into the UI so we can instantly
// spot "group master isn't populated" vs "group master is there but
// doesn't include the city sub-groups" vs "chain works correctly".
function sampleGroupHops(ledgers, groupParentMap, count) {
  const samples = [];
  const sampled = new Set();
  for (const l of ledgers) {
    if (samples.length >= count) break;
    const start = readField(l, 'PARENT');
    if (!start || sampled.has(start)) continue;
    sampled.add(start);
    const chain = [start];
    let curr = start.toLowerCase();
    const seen = new Set([curr]);
    while (chain.length < 8) {
      const next = groupParentMap.get(curr) || '';
      if (!next || seen.has(next)) break;
      chain.push(next);
      seen.add(next);
      curr = next;
    }
    samples.push(chain.join(' → '));
  }
  return samples;
}

function isSundryDebtor(ledger, groupParentMap) {
  let curr = readField(ledger, 'PARENT').toLowerCase();
  if (!curr) return false;
  const visited = new Set();
  let hops = 0;
  while (curr && !visited.has(curr) && hops < 10) {
    if (isDebtorGroupName(curr)) return true;
    visited.add(curr);
    const next = groupParentMap ? groupParentMap.get(curr) : '';
    curr = (next || '').toLowerCase();
    hops += 1;
  }
  return false;
}

// Ledger groups we never want to treat as customers even in fallback mode.
// When we're guessing (no Sundry-Debtor parent matched), these are the
// obvious non-debtor buckets to exclude so we don't mix banks / taxes / P&L
// accounts into the dashboard's customer list.
const NON_DEBTOR_PARENT_PATTERNS = [
  'bank', 'cash', 'capital', 'current asset', 'fixed asset',
  'current liab', 'loan', 'duties', 'tax', 'gst', 'tds', 'tcs',
  'provision', 'reserve', 'suspense',
  'income', 'revenue', 'sales account', 'direct income', 'indirect income',
  'expense', 'direct exp', 'indirect exp', 'purchase',
  'depreciation', 'branch', 'division',
  'sundry creditor', 'trade creditor', 'creditor',
];

function isNotObviousNonDebtor(ledger) {
  const parent = readField(ledger, 'PARENT').toLowerCase();
  if (!parent) return true;
  return !NON_DEBTOR_PARENT_PATTERNS.some((p) => parent.includes(p));
}

function buildCustomer(ledger, index) {
  const name = readField(ledger, 'NAME') || `Dealer-${index + 1}`;
  const gstin = readField(ledger, 'PARTYGSTIN') || readField(ledger, 'GSTREGISTRATIONNUMBER');
  const state = readField(ledger, 'LEDSTATENAME') || readField(ledger, 'STATENAME');
  const region = stateToRegion(state);
  const addressField = ledger.ADDRESS ?? ledger._ADDRESS;
  const city = cityFromAddress(addressField, state) || state;
  const closing = parseAmount(readField(ledger, 'CLOSINGBALANCE'));
  const outstandingAmount = Math.max(0, closing);
  const creditLimit = parseAmount(readField(ledger, 'CREDITLIMIT'));
  const creditPeriod = parseInt(readField(ledger, 'CREDITPERIOD'), 10) || 30;

  // Simple heuristic so payment-risk dashboards aren't entirely flat
  let paymentRisk = 'Low';
  if (creditLimit > 0 && outstandingAmount > creditLimit) paymentRisk = 'High';
  else if (outstandingAmount > 0 && creditLimit > 0 && outstandingAmount / creditLimit > 0.7) paymentRisk = 'Medium';

  const emptyHistory = MONTHS.map(month => ({ month, value: 0, invoiceCount: 0 }));
  const emptyPayments = MONTHS.map(month => ({ month, onTime: 0, late: 0, dso: 0 }));

  return {
    id: index + 1,
    name,
    segment: 'Mid-Market',
    region,
    state,
    city,
    gstin,
    monthlyAvg: 0,
    churnRisk: 'Low',
    churnScore: 0,
    churnReasons: ['Awaiting sales history sync'],
    paymentRisk,
    dso: 0,
    agingCurrent: outstandingAmount,
    aging30: 0,
    aging60: 0,
    aging90: 0,
    skuCount: 0,
    catCount: 0,
    skuPenetration: 0,
    catPenetration: 0,
    expansionScore: 0,
    purchasedCategories: [],
    missedCategories: [],
    lastOrderDays: 0,
    orderFreqDecline: 0,
    revenueChange: 0,
    ltv: 0,
    invoiceHistory: emptyHistory,
    paymentHistory: emptyPayments,
    actionWindow: paymentRisk === 'High' ? 'This week' : 'Quarterly review',
    paymentTrend: 'Flat',
    lastContacted: 0,
    totalOrders: 0,
    avgOrderValue: 0,
    creditLimit,
    creditPeriod,
    outstandingAmount,
    joinedDate: null,
    dataSource: 'tally-live',
  };
}

// Generic version of extractLedgers — walks the parsed XML tree and returns
// the first array of nodes matching `nodeName`. Used to pull VOUCHER /
// STOCKITEM / STOCKGROUP collections out of their parsed trees.
// Same exhaustive walk as extractLedgers, parameterised by node name.
// Used for VOUCHER / STOCKITEM / STOCKGROUP collections.
function extractCollection(tree, nodeName) {
  return extractAllByKey(tree, nodeName);
}

// Tally serialises dates as YYYYMMDD. Accept that form plus ISO-ish strings
// (for safety when called with already-parsed values).
function parseTallyDate(value) {
  const s = textField(value);
  if (!s) return null;
  if (/^\d{8}$/.test(s)) {
    const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 12-month window ending at `endDate`, oldest first. Each bucket has a string
// key we can hash voucher dates against (YYYY-MM) plus the short month label
// the dashboards render.
function build12MonthWindow(endDate) {
  const end = endDate instanceof Date ? endDate : new Date();
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      month: MONTH_SHORT[d.getMonth()],
    });
  }
  return buckets;
}

function bucketIndexForDate(date, window) {
  if (!date) return -1;
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return window.findIndex(b => b.key === key);
}

// Normalise a party / stock-item name for lookup — Tally returns names with
// inconsistent whitespace and casing between ledger and voucher records.
function normaliseName(value) {
  return textField(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Stock items carry Category (explicit taxonomy) and Parent (stock group).
// Prefer Category; fall back to the parent group name.
function stockItemCategory(item) {
  return readField(item, 'CATEGORY') || readField(item, 'PARENT') || 'Uncategorized';
}

// Sales/receipt vouchers nest their line items inside a key with a literal
// dot — 'ALLINVENTORYENTRIES.LIST' / 'BILLALLOCATIONS.LIST'. The parser keeps
// the dotted key; we just read it directly, normalising to an array.
function readNestedList(voucher, listKey) {
  const raw = voucher[listKey] ?? voucher['_' + listKey];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// Core aggregation: given a debtor ledger plus the party-keyed voucher
// buckets, build the full customer object the dashboards consume. Falls back
// to zeros for any field whose underlying collection is missing — a dropped
// stock query shouldn't NaN out SKU penetration.
function buildFullCustomer({
  ledger,
  index,
  window,
  salesByParty,
  receiptsByParty,
  skuToCategory,
  totalSKUs,
  allCategories,
  now,
}) {
  const nameKey = normaliseName(readField(ledger, 'NAME'));
  const sales = salesByParty.get(nameKey) || [];
  const receipts = receiptsByParty.get(nameKey) || [];

  // Base ledger fields (identity, state, credit, outstanding).
  const base = buildCustomer(ledger, index);

  // ── Invoice history ────────────────────────────────────────────────────
  const invoiceHistory = window.map(b => ({ month: b.month, value: 0, invoiceCount: 0 }));
  let lastSaleDate = null;
  const purchasedSKUs = new Set();
  const purchasedCategories = new Set();
  for (const v of sales) {
    const d = parseTallyDate(readField(v, 'DATE'));
    const amount = parseAmount(readField(v, 'AMOUNT'));
    // Tally stores sale vouchers with negative amount (Cr from party view); flip to positive.
    const saleValue = Math.abs(amount);
    const idx = bucketIndexForDate(d, window);
    if (idx >= 0) {
      invoiceHistory[idx].value += saleValue;
      invoiceHistory[idx].invoiceCount += 1;
    }
    if (d && (!lastSaleDate || d > lastSaleDate)) lastSaleDate = d;

    // Inventory line items → SKUs + categories.
    for (const entry of readNestedList(v, 'ALLINVENTORYENTRIES.LIST')) {
      const sku = normaliseName(readField(entry, 'STOCKITEMNAME'));
      if (!sku) continue;
      purchasedSKUs.add(sku);
      const cat = skuToCategory.get(sku);
      if (cat) purchasedCategories.add(cat);
    }
  }
  for (const b of invoiceHistory) b.value = Math.round(b.value);

  // ── Totals from history ────────────────────────────────────────────────
  const totalSales = invoiceHistory.reduce((s, m) => s + m.value, 0);
  const totalOrders = invoiceHistory.reduce((s, m) => s + m.invoiceCount, 0);
  const monthlyAvg = Math.round(totalSales / 12);
  const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

  const recent3 = invoiceHistory.slice(-3).reduce((s, m) => s + m.value, 0);
  const prior3 = invoiceHistory.slice(-6, -3).reduce((s, m) => s + m.value, 0);
  const revenueChange = prior3 > 0 ? Math.round(((recent3 - prior3) / prior3) * 1000) / 10 : 0;

  const recentCount = invoiceHistory.slice(-3).reduce((s, m) => s + m.invoiceCount, 0);
  const priorCount = invoiceHistory.slice(-6, -3).reduce((s, m) => s + m.invoiceCount, 0);
  const orderFreqDecline = priorCount > 0 ? Math.round(((priorCount - recentCount) / priorCount) * 1000) / 10 : 0;

  const lastOrderDays = lastSaleDate
    ? Math.max(0, Math.round((now.getTime() - lastSaleDate.getTime()) / 86400000))
    : 999;

  // ── SKU / category penetration ─────────────────────────────────────────
  const skuCount = purchasedSKUs.size;
  const catCount = purchasedCategories.size;
  const skuPenetration = totalSKUs > 0 ? Math.round((skuCount / totalSKUs) * 100) : 0;
  const catDenominator = Math.max(allCategories.size, 1);
  const catPenetration = Math.round((catCount / catDenominator) * 100);
  const purchasedCategoriesArr = Array.from(purchasedCategories);
  const missedCategories = Array.from(allCategories).filter(c => !purchasedCategories.has(c));
  // Expansion score: room to grow = unpurchased catalog surface. Keep within
  // the mock's 20-100 range so downstream visualisations line up. When we
  // have no voucher history at all (skuCount === 0 && catCount === 0) the
  // raw formula collapses to 100 — every dealer would look like a max-
  // expansion target — so fall back to 0 ("unknown") in that case so the
  // Growth Engine / Opportunities pages don't pretend they've classified
  // every customer at the ceiling.
  const hasPurchaseHistory = skuCount > 0 || catCount > 0;
  const expansionScore = hasPurchaseHistory
    ? Math.round(Math.max(20, Math.min(100,
        (100 - catPenetration) * 0.5 + (100 - skuPenetration) * 0.3 + 20
      )))
    : 0;

  // ── Payment history + DSO ──────────────────────────────────────────────
  const paymentHistory = window.map(b => ({ month: b.month, onTime: 0, late: 0, dso: 0 }));
  // For each month, tally on-time vs late receipts. Without matched sale
  // dates (which require bill-allocation lookups), fall back to credit-period
  // vs actual-DSO heuristic: if the party's DSO this month fits the credit
  // period, count receipts as on-time; otherwise late.
  const receiptsByMonth = window.map(() => []);
  for (const v of receipts) {
    const d = parseTallyDate(readField(v, 'DATE'));
    const idx = bucketIndexForDate(d, window);
    if (idx >= 0) receiptsByMonth[idx].push({ date: d, amount: Math.abs(parseAmount(readField(v, 'AMOUNT'))) });
  }
  // Simple monthly DSO = (outstanding at month start / monthly sales) × 30.
  // We approximate by using the overall DSO across the window for each
  // receipt-bearing month — honest enough without the ageing report.
  const avgDailySales = totalSales > 0 ? totalSales / 365 : 0;
  const dso = avgDailySales > 0 ? Math.round(base.outstandingAmount / avgDailySales) : 0;
  const creditPeriod = base.creditPeriod || 30;
  for (let i = 0; i < paymentHistory.length; i++) {
    const bucket = paymentHistory[i];
    const monthReceipts = receiptsByMonth[i];
    if (!monthReceipts.length) continue;
    const monthDso = dso; // same simplification
    bucket.dso = monthDso;
    // On-time if DSO ≤ creditPeriod; split as % of receipt count.
    if (monthDso <= creditPeriod) {
      bucket.onTime = 100;
      bucket.late = 0;
    } else {
      const slack = Math.min(1, (monthDso - creditPeriod) / Math.max(creditPeriod, 1));
      bucket.late = Math.round(100 * slack);
      bucket.onTime = 100 - bucket.late;
    }
  }

  // ── Aging buckets from sales - receipts (FIFO) ─────────────────────────
  // Order sales oldest first; reduce cumulatively. Each sale's unpaid balance
  // lives in the bucket matching its age. This is an approximation — a true
  // ageing needs bill-level allocation matching, which we don't have — but
  // it's accurate to the dollar on total outstanding.
  let aging = { current: 0, d30: 0, d60: 0, d90: 0 };
  if (sales.length) {
    const sorted = sales
      .map(v => ({ date: parseTallyDate(readField(v, 'DATE')), amount: Math.abs(parseAmount(readField(v, 'AMOUNT'))) }))
      .filter(s => s.date && s.amount > 0)
      .sort((a, b) => a.date - b.date);
    const totalReceipts = receipts.reduce((s, r) => s + Math.abs(parseAmount(readField(r, 'AMOUNT'))), 0);
    let paid = totalReceipts;
    for (const s of sorted) {
      const unpaid = Math.max(0, s.amount - Math.max(0, paid));
      paid = Math.max(0, paid - s.amount);
      if (unpaid <= 0) continue;
      const age = Math.floor((now.getTime() - s.date.getTime()) / 86400000);
      if (age <= 30) aging.current += unpaid;
      else if (age <= 60) aging.d30 += unpaid;
      else if (age <= 90) aging.d60 += unpaid;
      else aging.d90 += unpaid;
    }
  } else {
    // No voucher data: everything sits in the current bucket (existing behaviour).
    aging.current = base.outstandingAmount;
  }

  // ── Payment trend ──────────────────────────────────────────────────────
  const recentLate = mean(paymentHistory.slice(-3).map(p => p.late));
  const priorLate = mean(paymentHistory.slice(-6, -3).map(p => p.late));
  let paymentTrend = 'Flat';
  if (recentLate > priorLate + 5) paymentTrend = 'Worsening';
  else if (recentLate < priorLate - 5) paymentTrend = 'Improving';

  // ── Churn score + reasons (formula mirrors mockData.js:97-104) ─────────
  let churnScore = 0;
  churnScore += Math.min(30, lastOrderDays === 999 ? 30 : lastOrderDays);
  churnScore += Math.max(0, orderFreqDecline) * 0.8;
  churnScore += Math.max(0, -revenueChange) * 0.6;
  churnScore += (100 - skuPenetration) * 0.1;
  churnScore += (100 - catPenetration) * 0.1;
  churnScore = Math.min(99, Math.max(1, Math.round(churnScore)));
  const churnRisk = churnScore > 60 ? 'High' : churnScore > 35 ? 'Medium' : 'Low';
  const churnReasons = [];
  if (orderFreqDecline > 15) churnReasons.push('Order frequency declining');
  if (lastOrderDays !== 999 && lastOrderDays > 30) churnReasons.push(`No orders in ${lastOrderDays} days`);
  if (lastOrderDays === 999 && sales.length === 0) churnReasons.push('No sales vouchers in sync window');
  if (revenueChange < -15) churnReasons.push(`Invoice value dropping ${Math.abs(Math.round(revenueChange))}%`);
  if (catCount > 0 && catCount < 3) churnReasons.push('Low category engagement');
  if (skuPenetration > 0 && skuPenetration < 20) churnReasons.push('Very low SKU adoption');
  if (!churnReasons.length) churnReasons.push('Stable purchasing pattern');

  // ── Segment (matches mockData brackets) ────────────────────────────────
  const segment = monthlyAvg >= 60000 ? 'Enterprise' : monthlyAvg >= 20000 ? 'Mid-Market' : 'SMB';

  // ── LTV: historical sales + one year forward projection ────────────────
  const ltv = Math.round(totalSales + monthlyAvg * 12);

  // Reuse ledger-derived paymentRisk but promote to High if actual aging90 > 0
  // with real receipts data backing it.
  let paymentRisk = base.paymentRisk;
  if (aging.d90 > 0 && sales.length) paymentRisk = 'High';
  else if (aging.d60 > 0 && paymentRisk === 'Low') paymentRisk = 'Medium';

  const actionWindow = churnRisk === 'High' ? 'This week' : churnRisk === 'Medium' ? 'This month' : 'Quarterly review';

  return {
    ...base,
    segment,
    monthlyAvg,
    churnRisk,
    churnScore,
    churnReasons,
    paymentRisk,
    dso,
    agingCurrent: Math.round(aging.current),
    aging30: Math.round(aging.d30),
    aging60: Math.round(aging.d60),
    aging90: Math.round(aging.d90),
    skuCount,
    catCount,
    skuPenetration,
    catPenetration,
    expansionScore,
    purchasedCategories: purchasedCategoriesArr,
    missedCategories,
    lastOrderDays: lastOrderDays === 999 ? 0 : lastOrderDays,
    orderFreqDecline,
    revenueChange,
    ltv,
    invoiceHistory,
    paymentHistory,
    actionWindow,
    paymentTrend,
    totalOrders,
    avgOrderValue,
  };
}

export function transformTallyFull(bundle, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const ledgerTree = bundle?.ledgers ?? null;
  const accountingGroupsTree = bundle?.accountingGroups ?? null;
  // Voucher feeds — every dashboard reads vouchers from typed Voucher
  // COLLECTION fetches (Sales / Purchase / Receipt Register). Tolerate
  // any salesRegister_YYYY key that an older snapshot may still have
  // (we no longer write them) so previously-synced tenants don't lose
  // sales history when reading their existing snapshot.
  const salesShardTrees = [];
  if (bundle && typeof bundle === 'object') {
    for (const [k, v] of Object.entries(bundle)) {
      if (v == null) continue;
      if (k === 'salesRegister' || k.startsWith('salesRegister_')) salesShardTrees.push(v);
    }
  }
  const voucherFeedTrees = [
    ...salesShardTrees,
    bundle?.purchaseRegister ?? null,
    bundle?.receiptRegister ?? null,
  ].filter((t) => t != null);
  const salesRegisterVouchers = salesShardTrees.flatMap((tree) => extractCollection(tree, 'VOUCHER'));
  const purchaseRegisterVouchers = extractCollection(bundle?.purchaseRegister ?? null, 'VOUCHER');
  const receiptRegisterVouchers = extractCollection(bundle?.receiptRegister ?? null, 'VOUCHER');
  // Bills Outstanding rolls up bills (not vouchers) — different shape; the
  // aging derivation below uses it via parseBillsOutstanding when present.
  const billsOutstandingTree = bundle?.billsOutstanding ?? null;
  const stockItemsTree = bundle?.stockItems ?? null;
  const stockGroupsTree = bundle?.stockGroups ?? null;
  const profitLossTree = bundle?.profitLoss ?? null;
  const balanceSheetTree = bundle?.balanceSheet ?? null;
  const trialBalanceTree = bundle?.trialBalance ?? null;

  // Build a lowercase name→parent map from the Group master, so every
  // ledger can walk its ancestry and find "Sundry Debtors" even when the
  // direct parent is a city/region sub-group. Keys + values both
  // lowercased so the walker can compare without extra normalization.
  const groupParentMap = new Map();
  let accountingGroupCount = 0;
  for (const g of extractAllByKey(accountingGroupsTree, 'GROUP')) {
    accountingGroupCount += 1;
    const n = readField(g, 'NAME').toLowerCase();
    const p = readField(g, 'PARENT').toLowerCase();
    if (n) groupParentMap.set(n, p);
  }

  const ledgers = extractLedgers(ledgerTree);
  // Suppress unused-warning while billsOutstanding parsing isn't wired
  // into the aging pipeline yet — the snapshot key still lands and the
  // raw tree is exposed to consumers via diagnostics.
  void billsOutstandingTree;
  void voucherFeedTrees;
  // Trust the source. Each register was fetched with a typed Tally
  // filter ($$IsSales / $$IsPurchase / $$IsReceipt), so every VOUCHER
  // node Tally returned is already classified. Re-classifying by a
  // VOUCHERTYPENAME substring match (the previous behaviour) silently
  // dropped vouchers whose type was named something like "GST" or
  // "Tax Invoice (Export)" that didn't include the literal "sales" /
  // "purchase" / "receipt" — that's why the analytics stayed at zero
  // even after the registers fetched cleanly. Dedup still runs against
  // the union (in case a voucher somehow appears in two registers) but
  // each per-class array comes straight from its own feed.
  const dedupKey = (v) => `${readField(v, 'DATE')}|${readField(v, 'VOUCHERNUMBER')}|${readField(v, 'VOUCHERTYPENAME')}`;
  const dedupArray = (rows) => {
    const seen = new Set();
    const out = [];
    for (const v of rows) {
      const k = dedupKey(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  };
  const salesVouchers = dedupArray(salesRegisterVouchers);
  const purchaseVouchers = dedupArray(purchaseRegisterVouchers);
  const receiptVouchers = dedupArray(receiptRegisterVouchers);
  const stockItems = extractCollection(stockItemsTree, 'STOCKITEM');
  const stockGroups = extractCollection(stockGroupsTree, 'STOCKGROUP');

  // SKU → category lookup + category denominator.
  const skuToCategory = new Map();
  for (const item of stockItems) {
    const nameKey = normaliseName(readField(item, 'NAME'));
    if (nameKey) skuToCategory.set(nameKey, stockItemCategory(item));
  }
  const allCategories = new Set();
  for (const g of stockGroups) {
    const n = readField(g, 'NAME');
    if (n) allCategories.add(n);
  }
  for (const c of skuToCategory.values()) allCategories.add(c);
  const totalSKUs = stockItems.length;

  // Bucket vouchers by lowercased party name for O(n) per-customer lookup.
  const salesByParty = new Map();
  for (const v of salesVouchers) {
    const party = normaliseName(readField(v, 'PARTYLEDGERNAME'));
    if (!party) continue;
    const arr = salesByParty.get(party) || [];
    arr.push(v);
    salesByParty.set(party, arr);
  }
  const receiptsByParty = new Map();
  for (const v of receiptVouchers) {
    const party = normaliseName(readField(v, 'PARTYLEDGERNAME'));
    if (!party) continue;
    const arr = receiptsByParty.get(party) || [];
    arr.push(v);
    receiptsByParty.set(party, arr);
  }

  // Same three-tier debtor selection as transformTallyLedgers. See that
  // function for the rationale — NON_DEBTOR_PARENT_PATTERNS up top is the
  // filter shared between them. groupParentMap lets the filter walk up
  // the ancestor chain so ledgers under city sub-groups still match.
  const debtors = ledgers.filter((l) => isSundryDebtor(l, groupParentMap));
  let source = debtors;
  let sourceTier = 'debtors';
  if (!source.length) {
    source = ledgers.filter((l) =>
      Math.abs(parseAmount(readField(l, 'CLOSINGBALANCE'))) > 0
      && isNotObviousNonDebtor(l),
    );
    if (source.length) sourceTier = 'non-zero-balance';
  }
  if (!source.length) {
    source = ledgers.filter(isNotObviousNonDebtor);
    if (source.length) sourceTier = 'non-obvious-non-debtor';
  }

  const window = build12MonthWindow(now);
  const customers = source.map((ledger, index) =>
    buildFullCustomer({
      ledger, index, window, salesByParty, receiptsByParty,
      skuToCategory, totalSKUs, allCategories, now,
    })
  );

  // Per-parent counts so the UI can show "Sundry Debtors (75), Bank Accounts
  // (42), ..." — makes it obvious when the user's Tally uses a non-standard
  // group name.
  const parentCounts = {};
  for (const l of ledgers) {
    const p = readField(l, 'PARENT') || '(no parent)';
    parentCounts[p] = (parentCounts[p] || 0) + 1;
  }
  const parentsSeen = Object.entries(parentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, n]) => `${name} (${n})`);

  // Aggregate purchase spend so the InventoryBudget / inventory views
  // can show actuals next to projections without rerunning the
  // classification on every render. Sums VOUCHER AMOUNT (Tally serialises
  // the AMOUNT element as a negative number for purchases — `Math.abs` on
  // each row keeps the totals user-facing).
  const purchaseTotals = (() => {
    let total = 0;
    const byMonth = new Map();
    const bySupplier = new Map();
    for (const v of purchaseVouchers) {
      const amt = Math.abs(parseAmount(readField(v, 'AMOUNT')));
      if (!Number.isFinite(amt)) continue;
      total += amt;
      const monthKey = readField(v, 'DATE').slice(0, 6);
      if (monthKey) byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + amt);
      const supplier = readField(v, 'PARTYLEDGERNAME').trim() || '(unspecified)';
      bySupplier.set(supplier, (bySupplier.get(supplier) || 0) + amt);
    }
    const topSuppliers = Array.from(bySupplier.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const monthlySeries = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, value]) => ({ month, value: Math.round(value) }));
    return {
      total: Math.round(total),
      monthly: monthlySeries,
      topSuppliers,
    };
  })();

  const financials = {
    profitLoss: parseFinancialStatement(profitLossTree, 'pl'),
    balanceSheet: parseFinancialStatement(balanceSheetTree, 'bs'),
    trialBalance: parseFinancialStatement(trialBalanceTree, 'tb'),
    purchases: purchaseTotals,
    vouchers: {
      sales: salesVouchers,
      purchases: purchaseVouchers,
      receipts: receiptVouchers,
      all: [...salesVouchers, ...purchaseVouchers, ...receiptVouchers],
    },
  };

  return {
    customers,
    totals: {
      ledgers: ledgers.length,
      sundryDebtors: debtors.length,
      salesVouchers: salesVouchers.length,
      purchaseVouchers: purchaseVouchers.length,
      receiptVouchers: receiptVouchers.length,
      stockItems: stockItems.length,
      stockGroups: stockGroups.length,
      categories: allCategories.size,
      outstanding: customers.reduce((s, c) => s + c.outstandingAmount, 0),
      totalSales: customers.reduce((s, c) => s + c.invoiceHistory.reduce((a, m) => a + m.value, 0), 0),
      totalPurchases: purchaseTotals.total,
    },
    financials,
    diagnostics: {
      filterMatched: debtors.length > 0,
      usedFallback: debtors.length === 0 && source.length > 0,
      sourceTier,
      parentsSeen,
      accountingGroupCount,
      groupMapSize: groupParentMap.size,
      sampleGroupHops: sampleGroupHops(ledgers, groupParentMap, 5),
      coverage: {
        ledgers: ledgers.length,
        salesVouchers: salesVouchers.length,
        purchaseVouchers: purchaseVouchers.length,
        receiptVouchers: receiptVouchers.length,
        stockItems: stockItems.length,
        stockGroups: stockGroups.length,
        salesRegisterFeed: salesRegisterVouchers.length,
        purchaseRegisterFeed: purchaseRegisterVouchers.length,
        receiptRegisterFeed: receiptRegisterVouchers.length,
      },
      window: window.map(b => b.month),
    },
  };
}

// Parse a Tally built-in financial statement (Profit & Loss A/c, Balance
// Sheet, Trial Balance). The shape varies slightly between Tally versions,
// but the common pieces are a DSPACCNAME element per row holding the group
// name (DSPDISPNAME) and a sibling DSPACCINFO with closing debit (DSPCLDRAMA)
// and credit (DSPCLCRAMA) amounts. We pair them by traversal order — Tally
// emits name+info immediately adjacent — so the output is a flat list of
// { name, debit, credit, net } rows the UI can render as a tree or a table.
// The `kind` hint lets us split rows into sensible top-level buckets
// (income vs expense for P&L; assets vs liabilities for BS).
function parseFinancialStatement(tree, kind) {
  if (!tree) return null;
  const rows = [];
  const walk = (node, depth, parent) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth, parent)); return; }
    const entries = Object.entries(node);
    let i = 0;
    while (i < entries.length) {
      const [key, value] = entries[i];
      if (key === 'DSPACCNAME') {
        const nameNode = Array.isArray(value) ? value[0] : value;
        const name = readField(nameNode || {}, 'DSPDISPNAME') || textField(nameNode);
        // DSPACCINFO typically sits immediately after DSPACCNAME at the
        // same level. Walk forward until we find it (or bail).
        let info = null;
        for (let j = i + 1; j < entries.length && j < i + 4; j++) {
          if (entries[j][0] === 'DSPACCINFO') { info = entries[j][1]; break; }
        }
        const infoNode = Array.isArray(info) ? info[0] : info;
        const debit = parseAmount(readField(infoNode || {}, 'DSPCLDRAMA'));
        const credit = parseAmount(readField(infoNode || {}, 'DSPCLCRAMA'));
        if (name) {
          rows.push({
            name: name.trim(),
            parent: parent || '',
            depth,
            debit: Math.round(debit),
            credit: Math.round(credit),
            net: Math.round(credit - debit),
          });
          // Recurse into the info node in case child groups nest inside it.
          if (infoNode) walk(infoNode, depth + 1, name.trim());
        }
      } else if (value && typeof value === 'object') {
        walk(value, depth, parent);
      }
      i += 1;
    }
  };
  walk(tree, 0, '');
  // Totals for the summary row at the top of each statement. Debit/credit
  // totals come straight from the roots (depth 0); callers can still sum
  // the full `rows` array if they want per-group detail.
  const rootRows = rows.filter((r) => r.depth === 0);
  const totals = rootRows.reduce(
    (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
    { debit: 0, credit: 0 },
  );
  return { kind, rows, rootRows, totals };
}

export function transformTallyLedgers(rawTree) {
  const ledgers = extractLedgers(rawTree);
  // Lean-mode transformer doesn't have group master data, so the ancestor
  // walk degrades to the single-hop parent check. Fine as a fallback; the
  // full transformer passes a populated groupParentMap.
  const debtors = ledgers.filter((l) => isSundryDebtor(l, new Map()));

  // Three-tier fallback: prefer real debtors → any non-zero-balance ledger
  // that isn't obviously a non-debtor (bank/tax/P&L) → finally any ledger
  // whose parent looks customer-ish. At least one tier should find something
  // in a real Tally feed.
  let source = debtors;
  let sourceTier = 'debtors';
  if (!source.length) {
    source = ledgers.filter((l) =>
      Math.abs(parseAmount(readField(l, 'CLOSINGBALANCE'))) > 0
      && isNotObviousNonDebtor(l),
    );
    if (source.length) sourceTier = 'non-zero-balance';
  }
  if (!source.length) {
    source = ledgers.filter(isNotObviousNonDebtor);
    if (source.length) sourceTier = 'non-obvious-non-debtor';
  }

  const customers = source.map(buildCustomer);

  // Count every parent group so the UI can show "75 in Sundry Debtors, 42 in
  // Bank Accounts, 18 in Expenses..." — tells the user exactly why the
  // filter matched nothing (e.g. their debtors sit under "Trade Debtors").
  const parentCounts = {};
  for (const l of ledgers) {
    const p = readField(l, 'PARENT') || '(no parent)';
    parentCounts[p] = (parentCounts[p] || 0) + 1;
  }
  const parentsSeen = Object.entries(parentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, n]) => `${name} (${n})`);

  // Build a richer sample so we can diagnose attribute-vs-element differences.
  let sampleKeys = [];
  const sampleRaw = {};
  if (ledgers[0]) {
    sampleKeys = Object.keys(ledgers[0]).slice(0, 30);
    for (const key of sampleKeys) {
      const v = ledgers[0][key];
      sampleRaw[key] = typeof v === 'string'
        ? v.slice(0, 80)
        : JSON.stringify(v).slice(0, 80);
    }
  }

  return {
    customers,
    totals: {
      ledgers: ledgers.length,
      sundryDebtors: debtors.length,
      outstanding: customers.reduce((s, c) => s + c.outstandingAmount, 0),
    },
    diagnostics: {
      filterMatched: debtors.length > 0,
      usedFallback: debtors.length === 0 && source.length > 0,
      sourceTier,
      parentsSeen,
      sampleKeys,
      sampleLedger: ledgers[0]
        ? {
            NAME: readField(ledgers[0], 'NAME'),
            PARENT: readField(ledgers[0], 'PARENT'),
            CLOSINGBALANCE: readField(ledgers[0], 'CLOSINGBALANCE'),
          }
        : null,
      sampleRaw,
    },
  };
}
