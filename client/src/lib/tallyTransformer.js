// Client-side Tally transformer — turns the raw parsed XML from the Supabase
// Edge Function into the customer shape the analytics engine reads. Because we
// currently only sync the "Ledger" collection (heavier queries drop the
// connection on shared hosts), sales history / inventory / aging buckets are
// filled with neutral zeros rather than fake numbers. Fields derived from real
// Tally data:
//   - name, gstin, state, region, city (from ADDRESS / LEDSTATENAME)
//   - outstandingAmount, creditLimit, creditPeriod (parsed from amounts)
//   - paymentRisk heuristic (outstanding vs credit limit)
// Everything else stays at deterministic defaults so real users never see
// fabricated risk numbers on their own dealers.

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

// Walk a parsed XML tree and return the first array of LEDGER objects we find.
function extractLedgers(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = extractLedgers(item);
      if (found.length) return found;
    }
    return [];
  }
  for (const [key, value] of Object.entries(tree)) {
    if (key === 'LEDGER' && Array.isArray(value)) return value;
    if (key === 'LEDGER' && value && typeof value === 'object') return [value];
    const nested = extractLedgers(value);
    if (nested.length) return nested;
  }
  return [];
}

function isSundryDebtor(ledger) {
  const parent = readField(ledger, 'PARENT').toLowerCase();
  if (!parent) return false;
  // Match "Sundry Debtors", anything nested under it ("Sundry Debtors / X"),
  // and the common synonyms shops use for the same group.
  return parent.includes('sundry debtor')
    || parent === 'debtors'
    || parent.includes('accounts receivable');
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

export function transformTallyLedgers(rawTree) {
  const ledgers = extractLedgers(rawTree);
  const debtors = ledgers.filter(isSundryDebtor);

  // Fallback — if no ledger has a recognizable Sundry Debtor parent (common
  // when Tally returns name-only responses or the group is renamed), keep
  // ledgers that have a non-zero closing balance. They're almost certainly
  // the accounts we care about; the user can refine later.
  const source = debtors.length > 0
    ? debtors
    : ledgers.filter(l => Math.abs(parseAmount(readField(l, 'CLOSINGBALANCE'))) > 0);

  const customers = source.map(buildCustomer);

  // Unique parent groups found in the feed — useful diagnostic so the UI can
  // tell the user WHY their filter didn't match (e.g. group is "Trade
  // Debtors" instead of "Sundry Debtors").
  const parents = new Set();
  for (const l of ledgers) {
    const p = readField(l, 'PARENT');
    if (p) parents.add(p);
  }

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
      parentsSeen: Array.from(parents).slice(0, 20),
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
