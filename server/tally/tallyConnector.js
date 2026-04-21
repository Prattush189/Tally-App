/**
 * Tally Prime 7.0 XML API Connector
 * Connects to Tally's XML server to fetch real business data.
 *
 * Tally's API accepts XML POST requests and returns XML responses.
 * We parse these into JS objects for the dashboard.
 */

import { XMLParser } from 'fast-xml-parser';

let TALLY_HOST = process.env.TALLY_HOST || '103.76.213.243';
let TALLY_PORT = process.env.TALLY_PORT || '65430';
let TALLY_URL = `http://${TALLY_HOST}:${TALLY_PORT}`;
let TALLY_COMPANY = process.env.TALLY_COMPANY || '';  // Leave empty for active company
let TALLY_USERNAME = process.env.TALLY_USERNAME || '';
let TALLY_PASSWORD = process.env.TALLY_PASSWORD || '';

/** Update Tally connection config at runtime (from frontend settings) */
export function updateConfig({ host, port, username, password, company } = {}) {
  if (host) TALLY_HOST = host;
  if (port) TALLY_PORT = port;
  if (username !== undefined) TALLY_USERNAME = username;
  if (password !== undefined) TALLY_PASSWORD = password;
  if (company) TALLY_COMPANY = company;
  TALLY_URL = `http://${TALLY_HOST}:${TALLY_PORT}`;
  console.log(`[Tally] Config updated → ${TALLY_URL} (user: ${TALLY_USERNAME || 'none'})`);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_',
  textNodeName: '_text',
  isArray: (name) => ['LEDGER', 'VOUCHER', 'STOCKITEM', 'BILL', 'INVENTORYENTRIES.LIST',
    'ALLINVENTORYENTRIES.LIST', 'ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST',
    'BILLALLOCATIONS.LIST', 'BATCHALLOCATIONS.LIST', 'CATEGORYENTRY.LIST',
    'STOCKITEMENTRY.LIST', 'BODY', 'COLLECTION'].includes(name),
});

// ─── CORE REQUEST ────────────────────────────────────────────────────────────

async function tallyRequest(xmlBody, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { 'Content-Type': 'application/xml' };

    // Add Basic Auth if credentials are configured
    if (TALLY_USERNAME && TALLY_PASSWORD) {
      const credentials = Buffer.from(`${TALLY_USERNAME}:${TALLY_PASSWORD}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const res = await fetch(TALLY_URL, {
      method: 'POST',
      headers,
      body: xmlBody,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Tally authentication failed (${res.status}). Check username/password.`);
    }
    if (!res.ok) {
      throw new Error(`Tally returned HTTP ${res.status}: ${res.statusText}`);
    }

    const text = await res.text();
    return parser.parse(text);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Tally connection timed out after ${timeoutMs / 1000}s. Check if Tally is running and the IP/port are correct.`);
    }
    throw new Error(`Tally connection failed: ${err.message}`);
  }
}

// ─── XML REQUEST BUILDERS ────────────────────────────────────────────────────

function companyFilter() {
  return TALLY_COMPANY ? `<SVCURRENTCOMPANY>${TALLY_COMPANY}</SVCURRENTCOMPANY>` : '';
}

function exportRequest(collectionType, fields = '', fetchList = '', filters = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${collectionType}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter()}
        ${filters}
      </STATICVARIABLES>
      ${fields}
      ${fetchList}
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function reportRequest(reportId, filters = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${reportId}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter()}
        ${filters}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// ─── DATA FETCHERS ───────────────────────────────────────────────────────────

/** Test connection and get company info */
export async function getCompanyInfo() {
  const xml = reportRequest('List of Companies');
  const result = await tallyRequest(xml);
  return result;
}

/** Get active company details */
export async function getCompanyDetails() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Company</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${companyFilter()}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
  return await tallyRequest(xml);
}

/** Fetch all Sundry Debtors (B2B customers/dealers) */
export async function getLedgers() {
  const xml = exportRequest(
    'CustomLedgerCollection',
    `<TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="CustomLedgerCollection" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <NATIVEMETHOD>Name</NATIVEMETHOD>
          <NATIVEMETHOD>Parent</NATIVEMETHOD>
          <NATIVEMETHOD>Address</NATIVEMETHOD>
          <NATIVEMETHOD>LedgerPhone</NATIVEMETHOD>
          <NATIVEMETHOD>LedgerContact</NATIVEMETHOD>
          <NATIVEMETHOD>LedgerMobile</NATIVEMETHOD>
          <NATIVEMETHOD>Email</NATIVEMETHOD>
          <NATIVEMETHOD>GSTRegistrationType</NATIVEMETHOD>
          <NATIVEMETHOD>PartyGSTIN</NATIVEMETHOD>
          <NATIVEMETHOD>LedStateName</NATIVEMETHOD>
          <NATIVEMETHOD>PINCode</NATIVEMETHOD>
          <NATIVEMETHOD>CreditPeriod</NATIVEMETHOD>
          <NATIVEMETHOD>CreditLimit</NATIVEMETHOD>
          <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
          <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
          <FILTER>SundryDebtorFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="SundryDebtorFilter">
          $Parent = "Sundry Debtors" OR $Parent UNDER "Sundry Debtors"
        </SYSTEM>
      </TDLMESSAGE>
    </TDL>`
  );
  const result = await tallyRequest(xml);
  return extractCollection(result, 'LEDGER');
}

/** Fetch all Sundry Creditors */
export async function getCreditors() {
  const xml = exportRequest(
    'CustomCreditorCollection',
    `<TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="CustomCreditorCollection" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <NATIVEMETHOD>Name</NATIVEMETHOD>
          <NATIVEMETHOD>Parent</NATIVEMETHOD>
          <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
          <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
          <NATIVEMETHOD>PartyGSTIN</NATIVEMETHOD>
          <FILTER>SundryCreditorFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="SundryCreditorFilter">
          $Parent = "Sundry Creditors" OR $Parent UNDER "Sundry Creditors"
        </SYSTEM>
      </TDLMESSAGE>
    </TDL>`
  );
  const result = await tallyRequest(xml);
  return extractCollection(result, 'LEDGER');
}

/** Fetch Sales Vouchers with line items */
export async function getSalesVouchers(fromDate = '', toDate = '') {
  const dateFilter = fromDate && toDate ? `
    <SVFROMDATE>${fromDate}</SVFROMDATE>
    <SVTODATE>${toDate}</SVTODATE>
  ` : '';

  const xml = exportRequest(
    'CustomSalesCollection',
    `<TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="CustomSalesCollection" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <NATIVEMETHOD>Date</NATIVEMETHOD>
          <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
          <NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
          <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
          <NATIVEMETHOD>Amount</NATIVEMETHOD>
          <NATIVEMETHOD>AllLedgerEntries</NATIVEMETHOD>
          <NATIVEMETHOD>AllInventoryEntries</NATIVEMETHOD>
          <NATIVEMETHOD>NarrationAllocations</NATIVEMETHOD>
          <FILTER>SalesFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="SalesFilter">
          $VoucherTypeName = "Sales" OR $VoucherTypeName UNDER "Sales"
        </SYSTEM>
      </TDLMESSAGE>
    </TDL>`,
    '',
    dateFilter
  );
  const result = await tallyRequest(xml, 60000);
  return extractCollection(result, 'VOUCHER');
}

/** Fetch Receipt Vouchers (payments from customers) */
export async function getReceiptVouchers(fromDate = '', toDate = '') {
  const dateFilter = fromDate && toDate ? `
    <SVFROMDATE>${fromDate}</SVFROMDATE>
    <SVTODATE>${toDate}</SVTODATE>
  ` : '';

  const xml = exportRequest(
    'CustomReceiptCollection',
    `<TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="CustomReceiptCollection" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <NATIVEMETHOD>Date</NATIVEMETHOD>
          <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
          <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
          <NATIVEMETHOD>Amount</NATIVEMETHOD>
          <NATIVEMETHOD>AllLedgerEntries</NATIVEMETHOD>
          <NATIVEMETHOD>BillAllocations</NATIVEMETHOD>
          <FILTER>ReceiptFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="ReceiptFilter">
          $VoucherTypeName = "Receipt" OR $VoucherTypeName UNDER "Receipt"
        </SYSTEM>
      </TDLMESSAGE>
    </TDL>`,
    '',
    dateFilter
  );
  const result = await tallyRequest(xml, 60000);
  return extractCollection(result, 'VOUCHER');
}

/** Fetch Stock Items with details */
export async function getStockItems() {
  const xml = exportRequest(
    'CustomStockCollection',
    `<TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="CustomStockCollection" ISMODIFY="No">
          <TYPE>StockItem</TYPE>
          <NATIVEMETHOD>Name</NATIVEMETHOD>
          <NATIVEMETHOD>Parent</NATIVEMETHOD>
          <NATIVEMETHOD>Category</NATIVEMETHOD>
          <NATIVEMETHOD>BaseUnits</NATIVEMETHOD>
          <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
          <NATIVEMETHOD>OpeningRate</NATIVEMETHOD>
          <NATIVEMETHOD>OpeningValue</NATIVEMETHOD>
          <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
          <NATIVEMETHOD>ClosingRate</NATIVEMETHOD>
          <NATIVEMETHOD>ClosingValue</NATIVEMETHOD>
          <NATIVEMETHOD>MailingName</NATIVEMETHOD>
          <NATIVEMETHOD>HSNCode</NATIVEMETHOD>
          <NATIVEMETHOD>GSTApplicable</NATIVEMETHOD>
        </COLLECTION>
      </TDLMESSAGE>
    </TDL>`
  );
  const result = await tallyRequest(xml, 45000);
  return extractCollection(result, 'STOCKITEM');
}

/** Fetch Stock Groups (categories) */
export async function getStockGroups() {
  const xml = exportRequest(
    'CustomStockGroupCollection',
    `<TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="CustomStockGroupCollection" ISMODIFY="No">
          <TYPE>StockGroup</TYPE>
          <NATIVEMETHOD>Name</NATIVEMETHOD>
          <NATIVEMETHOD>Parent</NATIVEMETHOD>
        </COLLECTION>
      </TDLMESSAGE>
    </TDL>`
  );
  const result = await tallyRequest(xml);
  return extractCollection(result, 'STOCKGROUP');
}

/** Fetch Receivables (Outstanding bills from Sundry Debtors) */
export async function getReceivables() {
  const xml = reportRequest('Bills Receivable', `
    <SVFROMDATE>20250401</SVFROMDATE>
    <SVTODATE>20260420</SVTODATE>
  `);
  return await tallyRequest(xml, 45000);
}

/** Fetch Day Book / Voucher Register */
export async function getDayBook(fromDate, toDate) {
  const xml = reportRequest('Day Book', `
    <SVFROMDATE>${fromDate}</SVFROMDATE>
    <SVTODATE>${toDate}</SVTODATE>
  `);
  return await tallyRequest(xml, 45000);
}

/** Fetch Ledger Monthly Summary for a specific party */
export async function getLedgerMonthly(ledgerName) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Ledger Monthly Summary</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter()}
        <LEDGERNAME>${escapeXml(ledgerName)}</LEDGERNAME>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
  return await tallyRequest(xml);
}

// ─── COMPOSITE DATA FETCH (all data in one go) ──────────────────────────────

/**
 * Fetches all data needed for the dashboard in parallel.
 * Returns structured data ready for analytics computation.
 */
export async function fetchAllDashboardData() {
  console.log(`[Tally] Connecting to ${TALLY_URL}...`);

  const results = await Promise.allSettled([
    getLedgers(),
    getSalesVouchers('20240401', '20260420'),  // Last 2 years
    getReceiptVouchers('20240401', '20260420'),
    getStockItems(),
    getStockGroups(),
  ]);

  const [ledgersRes, salesRes, receiptsRes, stockRes, groupsRes] = results;

  const data = {
    connected: true,
    timestamp: new Date().toISOString(),
    ledgers: ledgersRes.status === 'fulfilled' ? ledgersRes.value : [],
    salesVouchers: salesRes.status === 'fulfilled' ? salesRes.value : [],
    receiptVouchers: receiptsRes.status === 'fulfilled' ? receiptsRes.value : [],
    stockItems: stockRes.status === 'fulfilled' ? stockRes.value : [],
    stockGroups: groupsRes.status === 'fulfilled' ? groupsRes.value : [],
    errors: results.filter(r => r.status === 'rejected').map(r => r.reason?.message),
  };

  console.log(`[Tally] Fetched: ${data.ledgers.length} ledgers, ${data.salesVouchers.length} sales vouchers, ${data.receiptVouchers.length} receipts, ${data.stockItems.length} stock items, ${data.stockGroups.length} stock groups`);
  if (data.errors.length) console.warn(`[Tally] Errors:`, data.errors);

  return data;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function extractCollection(parsed, nodeName) {
  if (!parsed?.ENVELOPE) return [];

  // Navigate the Tally XML response structure
  const body = parsed.ENVELOPE.BODY;
  if (!body) return [];

  const desc = body.DESC || body.DATA || body;

  // Try multiple paths since Tally's XML structure varies
  const paths = [
    () => desc?.COLLECTION?.[nodeName],
    () => body?.DATA?.COLLECTION?.[nodeName],
    () => body?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE?.[nodeName],
    () => parsed.ENVELOPE?.[nodeName],
    () => {
      // Deep search
      const search = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj[nodeName]) return obj[nodeName];
        for (const val of Object.values(obj)) {
          const found = search(val);
          if (found) return found;
        }
        return null;
      };
      return search(parsed);
    },
  ];

  for (const pathFn of paths) {
    const items = pathFn();
    if (items) return Array.isArray(items) ? items : [items];
  }

  return [];
}

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ─── TALLY VALUE PARSERS ─────────────────────────────────────────────────────

/** Parse Tally's amount format (negative = debit, positive = credit for debtors) */
export function parseAmount(val) {
  if (!val) return 0;
  const str = String(val._text || val).replace(/,/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.abs(num);
}

/** Parse Tally date format (YYYYMMDD) to JS Date */
export function parseTallyDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr);
  if (s.length === 8) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
  }
  return new Date(s);
}

/** Get number of days between date and now */
export function daysSince(dateStr) {
  const d = parseTallyDate(dateStr);
  if (!d || isNaN(d)) return 999;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

export default {
  updateConfig,
  getCompanyInfo,
  getCompanyDetails,
  getLedgers,
  getCreditors,
  getSalesVouchers,
  getReceiptVouchers,
  getStockItems,
  getStockGroups,
  getReceivables,
  getDayBook,
  getLedgerMonthly,
  fetchAllDashboardData,
  parseAmount,
  parseTallyDate,
  daysSince,
};
