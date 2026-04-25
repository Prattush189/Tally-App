// Supabase Edge Function — proxies Tally Prime XML requests from the browser.
// Tally's XML API doesn't speak CORS and usually can't be reached directly from a browser
// (credentials, private IPs, etc.), so we do the HTTP from inside Supabase and stream the
// parsed JSON back to the client.
//
// Deploy: supabase functions deploy tally
// Secrets (optional defaults):
//   supabase secrets set TALLY_HOST=1.2.3.4:9000 TALLY_USERNAME=... TALLY_PASSWORD=...
// If the request body includes host/username/password they override the secrets.
//
// Actions:
//   { action: 'test' }                    → getCompanyInfo
//   { action: 'sync' }                    → Sundry Debtor ledgers (lean)
//   { action: 'sync-full' }               → ledgers + sales + receipts + stock items + stock groups
//   { action: 'request', xml: '...' }     → raw XML passthrough
//   { action: 'get-config', syncToken }   → returns portal creds for the local Playwright tool
//   { action: 'ingest', syncToken, data } → persists a snapshot to tally_snapshots
//   { action: 'get-snapshot' }            → reads the latest snapshot for dashboards
// Optional fields on every request: host, username, password, company, fromDate, toDate.

import { XMLParser } from 'npm:fast-xml-parser@4.3.4';
import { createClient } from 'npm:@supabase/supabase-js@2';

type TallyConfig = {
  host?: string;
  company?: string;
  fromDate?: string;  // Tally format: YYYYMMDD (e.g. 20250401)
  toDate?: string;
  // When true, voucher queries pull the entire history (Tally current-period
  // default is ignored; we send an explicit 1900-01-01 → 2100-12-31 window).
  // Set by the client when the user picks "All data" in the range switcher —
  // otherwise an empty fromDate/toDate still falls back to the 90-day window
  // below.
  allData?: boolean;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_',
  textNodeName: '_text',
  isArray: (name: string) => [
    'LEDGER', 'VOUCHER', 'STOCKITEM', 'STOCKGROUP', 'GROUP', 'BILL', 'BODY', 'COLLECTION',
    'COMPANY',
    'ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST',
    'ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST',
    'BILLALLOCATIONS.LIST', 'BATCHALLOCATIONS.LIST',
  ].includes(name),
});

// Coerce empty / whitespace-only strings to undefined so the `||` fallback
// chain below actually falls through. The client sometimes sends "" for
// optional fields (React-controlled inputs with empty initial state); the
// original nullish-coalescing (??) preserved those empty strings, which
// made the portal-login fallback a silent no-op and confused the UI.
function nonEmpty(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function resolveConfig(overrides: TallyConfig): Required<TallyConfig> {
  const host = nonEmpty(overrides.host) || Deno.env.get('TALLY_HOST') || '';
  const company = nonEmpty(overrides.company) || Deno.env.get('TALLY_COMPANY') || '';
  const fromDate = nonEmpty(overrides.fromDate) || '';
  const toDate = nonEmpty(overrides.toDate) || '';
  const allData = overrides.allData === true;
  return { host, company, fromDate, toDate, allData };
}

function dateFilter(cfg: { fromDate: string; toDate: string }) {
  const parts: string[] = [];
  if (cfg.fromDate) parts.push(`<SVFROMDATE Type="Date">${cfg.fromDate}</SVFROMDATE>`);
  if (cfg.toDate) parts.push(`<SVTODATE Type="Date">${cfg.toDate}</SVTODATE>`);
  return parts.join('');
}

// Voucher queries default to the last 90 days when no range is supplied.
// Pulling all-time history (years of invoices + line items) regularly blows
// past the tunnel's payload ceiling and trips "connection closed before
// message completed". 90 days is enough for churn / aging / DSO.
//
// Opt in to "all history" via `allData: true` on the request body (the UI's
// "All data" range switcher sets this). We don't use 1900→2100 — Tally Prime
// silently returns EMPTY for extremely wide ranges on voucher-type reports
// (Sales/Receipt Register etc.), even though master-data reports honour them
// fine. A 10-year window is wide enough to cover any real business history
// and is reliably accepted.
//
// We also set SVCURRENTPERIODFROM / SVCURRENTPERIODTO alongside SVFROMDATE /
// SVTODATE. Several Tally reports respect the company's "current period"
// over the explicit date filter unless both pairs are set — which was our
// bug: the date filter was correct but Tally was still scoping every voucher
// query to the company's default FY, returning 0 rows for tenants whose
// current period was mis-set.
function fmtTallyDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function voucherDateFilter(cfg: { fromDate: string; toDate: string; allData?: boolean }) {
  const [from, to] = resolveVoucherWindow(cfg);
  return [
    `<SVFROMDATE Type="Date">${from}</SVFROMDATE>`,
    `<SVTODATE Type="Date">${to}</SVTODATE>`,
    `<SVCURRENTPERIODFROM Type="Date">${from}</SVCURRENTPERIODFROM>`,
    `<SVCURRENTPERIODTO Type="Date">${to}</SVCURRENTPERIODTO>`,
  ].join('');
}

function resolveVoucherWindow(cfg: { fromDate: string; toDate: string; allData?: boolean }): [string, string] {
  if (cfg.fromDate || cfg.toDate) {
    const from = cfg.fromDate || fmtTallyDate(new Date(1990, 0, 1));
    const to = cfg.toDate || fmtTallyDate(new Date(new Date().getFullYear() + 1, 11, 31));
    return [from, to];
  }
  if (cfg.allData) {
    // 5 years covers practically every B2B distributor's historical window
    // worth looking at. Voucher feeds bound by reportWithVoucherDates keep
    // each register's parse tree well under Supabase's 150 MB compute cap.
    const today = new Date();
    const from = fmtTallyDate(new Date(today.getFullYear() - 5, 0, 1));
    const to = fmtTallyDate(new Date(today.getFullYear() + 1, 11, 31));
    return [from, to];
  }
  const d = new Date();
  const to = fmtTallyDate(d);
  d.setDate(d.getDate() - 90);
  const from = fmtTallyDate(d);
  return [from, to];
}

// Accept either a bare "host" / "host:port" or a full URL ("https://host:port/path").
// Falls back to http://<host> when no scheme is provided.
function buildTallyUrl(host: string): string {
  const trimmed = host.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

// Per-request diagnostics. Previously also tracked portal-login state
// for the HOB RemoteApp auto-login, but that was a no-op every run on
// the actual customer deployment, so the whole portal subsystem (and
// its diagnostics fields) is gone. Kept as an empty record so the
// existing `diagnostics: snapshotDiagnostics()` in every response
// continues to work without conditional spread.
type RequestDiagnostics = Record<string, never>;
let currentDiagnostics: RequestDiagnostics = {};

async function tallyRequest(xml: string, cfg: Required<TallyConfig>, timeoutMs = 120000) {
  if (!cfg.host) throw new Error('Tally host not configured. Provide "host" in the request body or set TALLY_HOST secret.');

  // Plain XML POST. TallyPrime's XML server on this deployment does not
  // require Basic Auth, and the previous reactive portal-login retry
  // (HOB RemoteApp /cgi-bin/hb.exe?action=cp) was a no-op every run —
  // both removed. If a future deployment fronts Tally with HTTP Basic
  // Auth or a hosted portal, restore from git.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/xml' };
    const url = buildTallyUrl(cfg.host);
    const res = await fetch(url, {
      method: 'POST', headers, body: xml, signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Tally authentication failed (${res.status}). The XML server has Basic Auth enabled — disable it in TallyPrime (F1: Help → Settings → Connectivity → Client/Server) or restore the auth header path from git.`);
    }
    if (!res.ok) throw new Error(`Tally returned HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();
    // Hard memory guard. fast-xml-parser allocates a parse tree roughly
    // 2-3x the raw XML size, and JSON.stringify on that tree (what the
    // merge RPC body needs) doubles peak memory again. If a single
    // response is already pushing 40 MB of text, parsing it on the
    // 150 MB Edge Function would OOM-kill the whole invocation —
    // taking the rest of the sync down with it. Better to surface a
    // clean per-collection error and let the other collections land.
    const MAX_XML_BYTES = 40 * 1024 * 1024;
    if (text.length > MAX_XML_BYTES) {
      throw new Error(
        `Tally response too large to parse in the Edge Function (${Math.round(text.length / 1024 / 1024)} MB > ${MAX_XML_BYTES / 1024 / 1024} MB). Narrow the date range (the default is 5 years — try 1-2 years) or split the collection further.`,
      );
    }
    return parser.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function resetDiagnostics(): void {
  currentDiagnostics = {};
}
function snapshotDiagnostics(): RequestDiagnostics {
  return { ...currentDiagnostics };
}

function companyFilter(company: string): string {
  return company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';
}

function reportRequest(reportId: string, company: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${reportId}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    ${companyFilter(company)}
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`;
}

// Tally action XML that explicitly opens a company file. Some Tally
// setups don't auto-load on a bare SVCURRENTCOMPANY filter — when the
// Select Company screen is showing they answer collection queries with
// built-in placeholder data ("1 root group / 1 default ledger") instead
// of loading the company first. Sending an explicit Load Company action
// before the phase chain forces Tally into the company's data context
// so subsequent queries return real records.
//
// We send THREE different XML forms because TallyPrime's documentation
// itself shows different shapes across versions and different builds
// accept different ones:
//   (a) bare TALLYREQUEST=Load Company       (older legacy form)
//   (b) Execute / TYPE=Action / ID=Load Company   (mid-vintage docs)
//   (c) Execute / TYPE=TDLAction / ID=Load Company (current TallyPrime
//       Developer Reference — TYPE for action execution is documented
//       as "TDLAction", not the bare "Action" we'd been using).
// The caller surfaces whichever response actually came back so we can
// see exactly what Tally said.
function loadCompanyRequestSimple(company: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Load Company</TALLYREQUEST></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(company)}
    </STATICVARIABLES>
  </DESC></BODY>
</ENVELOPE>`;
}

function loadCompanyRequest(company: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Execute</TALLYREQUEST><TYPE>Action</TYPE><ID>Load Company</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(company)}
    </STATICVARIABLES>
  </DESC></BODY>
</ENVELOPE>`;
}

function loadCompanyRequestTDLAction(company: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Execute</TALLYREQUEST><TYPE>TDLAction</TYPE><ID>Load Company</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(company)}
    </STATICVARIABLES>
  </DESC></BODY>
</ENVELOPE>`;
}

// Built-in Tally report with optional date range. Used for everything
// except the single-row test ping — it's more tunnel-friendly than custom
// TDL COLLECTION queries (Tally hits pre-compiled code paths, no TDL
// compile step, less vulnerable to the tunnel's idle timer).
function reportWithDates(reportId: string, cfg: { company: string; fromDate: string; toDate: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${reportId}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    ${companyFilter(cfg.company)}
    ${dateFilter(cfg)}
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`;
}

function reportWithVoucherDates(reportId: string, cfg: { company: string; fromDate: string; toDate: string; allData?: boolean }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${reportId}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    ${companyFilter(cfg.company)}
    ${voucherDateFilter(cfg)}
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`;
}

// Walk the parsed Tally XML response and count the most common record types.
// The response shape varies: ENVELOPE.BODY.DATA.COLLECTION.LEDGER, or nested
// directly under ENVELOPE.BODY, or inside a RESPONSE wrapper. We just dig for
// any arrays named LEDGER / VOUCHER / STOCKITEM / GROUP anywhere in the tree.
function countRecords(tree: unknown) {
  const counts = { ledgers: 0, vouchers: 0, stockItems: 0, groups: 0 };
  const seen = new WeakSet();
  const bucketFor = (key: string): keyof typeof counts | null => {
    if (key === 'LEDGER') return 'ledgers';
    if (key === 'VOUCHER') return 'vouchers';
    if (key === 'STOCKITEM') return 'stockItems';
    if (key === 'GROUP') return 'groups';
    return null;
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    for (const key of Object.keys(obj)) {
      const bucket = bucketFor(key);
      const value = obj[key];
      if (bucket) {
        if (Array.isArray(value)) counts[bucket] += value.length;
        else if (value && typeof value === 'object') counts[bucket] += 1;
      }
      walk(value);
    }
  };
  walk(tree);
  return counts;
}

// Count how many occurrences of a single top-level node name exist anywhere
// in a parsed Tally response (VOUCHER, STOCKITEM, etc.). Used for per-collection
// coverage reporting in sync-full so the UI can explain "17 vouchers · 0 stock
// items — did Tally drop the stock query?".
function countNode(tree: unknown, target: string): number {
  let total = 0;
  const seen = new WeakSet();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (key === target) {
        if (Array.isArray(value)) total += value.length;
        else if (value && typeof value === 'object') total += 1;
      }
      walk(value);
    }
  };
  walk(tree);
  return total;
}

// Switched from custom <TYPE>Collection</TYPE> + <TDL> blocks to Tally's
// built-in <TYPE>Data</TYPE> reports. Built-in reports hit pre-compiled
// code paths inside Tally — no TDL compile on every request, much smaller
// XML payload we send, and the tunnel's idle timer is far less likely to
// fire before Tally starts responding. Field names in the output differ
// from our old collections, but extractAllByKey in the transformer walks
// for LEDGER / VOUCHER / STOCKITEM / STOCKGROUP at any depth, so it keeps
// working across both shapes.
//
// Voucher feed = Tally's pre-compiled Sales / Purchase / Receipt Register
// reports. Each is type-specific (single voucher class per call), so the
// per-call payload is a fraction of what 'Day Book' would return — a 5-year
// Day Book on a real distributor blew past both the tunnel's payload
// ceiling and the Edge Function's 150 MB memory cap, so it's gone.

// Management-accounting reports. P&L and Balance Sheet are Tally's built-in
// financial statements — pre-compiled, no TDL, returns a hierarchical tree
// of groups → sub-groups → ledgers with opening/closing balances. Trial
// Balance is the same flat group-level view without the P&L/BS split, so
// dashboards that want group-by-group drill-downs have it as a fallback.
function profitLossRequest(cfg: { company: string; fromDate: string; toDate: string }) {
  return reportWithDates('Profit & Loss', cfg);
}
function balanceSheetRequest(cfg: { company: string; fromDate: string; toDate: string }) {
  return reportWithDates('Balance Sheet', cfg);
}
function trialBalanceRequest(cfg: { company: string; fromDate: string; toDate: string }) {
  return reportWithDates('Trial Balance', cfg);
}

// Voucher fallback reports — use Tally's pre-compiled REPORT code path
// instead of the generic Voucher iterator that crashes with c0000005 on
// some installs. Sales / Receipt Register and Bills Outstanding are
// shipped reports built into every TallyPrime release; their internal
// iterator differs from the one Day Book and custom Voucher COLLECTIONs
// trigger, so they often succeed on datasets where Day Book bombs.
// Each runs in its own sync-collection isolate so the per-key timeout
// + 150 MB compute budget isolation we already have for Day Book years
// applies here too.
function salesRegisterRequest(cfg: { company: string; fromDate: string; toDate: string; allData?: boolean }) {
  return reportWithVoucherDates('Sales Register', cfg);
}
function purchaseRegisterRequest(cfg: { company: string; fromDate: string; toDate: string; allData?: boolean }) {
  return reportWithVoucherDates('Purchase Register', cfg);
}
function receiptRegisterRequest(cfg: { company: string; fromDate: string; toDate: string; allData?: boolean }) {
  return reportWithVoucherDates('Receipt Register', cfg);
}
function billsOutstandingRequest(cfg: { company: string; fromDate: string; toDate: string }) {
  return reportWithDates('Bills Outstanding', cfg);
}

// Stock items / groups stay on our custom COLLECTION queries — empirically
// the built-in 'Stock Summary' report returns a hierarchical summary (one
// row per group, not per item) and 'List of Stock Groups' came back with a
// single entry on the user's Tally. Custom COLLECTION reliably returns
// the flat STOCKITEM[] / STOCKGROUP[] arrays the transformer expects (803
// items + 52 groups in production).
function stockItemsRequest(cfg: { company: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelStockItems</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelStockItems" ISMODIFY="No">
        <TYPE>StockItem</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
        <NATIVEMETHOD>Category</NATIVEMETHOD>
        <NATIVEMETHOD>BaseUnits</NATIVEMETHOD>
        <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingRate</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingValue</NATIVEMETHOD>
        <NATIVEMETHOD>HSNCode</NATIVEMETHOD>
        <NATIVEMETHOD>GSTApplicable</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

// Accounting Group masters. Distinct from Stock Groups — these are the
// hierarchy that organises ledgers (Sundry Debtors > NEW DELHI > Dealer-X).
// We need the Name→Parent map so the transformer can walk each ledger's
// ancestry and detect "is this ledger somewhere under Sundry Debtors?",
// even when the direct parent is a city/region sub-group.
// Custom TDL COLLECTION query that lists Company objects directly.
// Used as a fallback to the built-in "List of Companies" report
// because that report only returns companies currently LOADED in
// TallyPrime — a hosted-Tally tenant sitting on the Select Company
// screen produces an empty response even though the XML server
// itself is healthy. A bare Company collection is often answered
// correctly in that state, because it enumerates company objects
// rather than running a report pipeline.
function companiesRequest(cfg: { company: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelCompanies</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelCompanies" ISMODIFY="No">
        <TYPE>Company</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

function accountingGroupsRequest(cfg: { company: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelGroups</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelGroups" ISMODIFY="No">
        <TYPE>Group</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

function stockGroupsRequest(cfg: { company: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelStockGroups</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelStockGroups" ISMODIFY="No">
        <TYPE>StockGroup</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

// Custom COLLECTION (not 'List of Accounts' built-in report) — the built-in
// returns a hierarchical structure where each ledger's group is implicit in
// its XML parent, not exposed as a PARENT field. Our isSundryDebtor filter
// needs a flat PARENT string per ledger, so we use NATIVEMETHOD explicitly.
function sundryDebtorsRequest(cfg: { company: string; fromDate: string; toDate: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelLedgers</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(cfg.company)}
      ${dateFilter(cfg)}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelLedgers" ISMODIFY="No">
        <TYPE>Ledger</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
        <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
        <NATIVEMETHOD>CreditLimit</NATIVEMETHOD>
        <NATIVEMETHOD>CreditPeriod</NATIVEMETHOD>
        <NATIVEMETHOD>PartyGSTIN</NATIVEMETHOD>
        <NATIVEMETHOD>LedStateName</NATIVEMETHOD>
        <NATIVEMETHOD>Address</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

// Per-collection freshness window for the sync-full skipFresh flag. Vouchers
// turn over fast (new invoices daily), so a tight 10-min TTL. Master data
// (ledgers, stock items, stock groups) changes rarely — 30 min keeps the
// tunnel from re-pulling MBs of XML that didn't change.
const COLLECTION_TTL_MS: Record<string, number> = {
  ledgers: 30 * 60_000,
  stockItems: 30 * 60_000,
  stockGroups: 30 * 60_000,
  accountingGroups: 30 * 60_000,
  profitLoss: 15 * 60_000,
  balanceSheet: 15 * 60_000,
  trialBalance: 15 * 60_000,
  salesRegister: 10 * 60_000,
  purchaseRegister: 10 * 60_000,
  receiptRegister: 10 * 60_000,
  billsOutstanding: 15 * 60_000,
};

// Maps a collection key to the XML payload, count-node tag, and timeout
// the sync-collection action should use. Keeps the spec in one place so
// both sync-full's job list and the per-collection action stay in sync.
// Returns null for unknown keys so the caller can 400 cleanly.
function buildCollectionJob(
  key: string,
  cfg: Required<TallyConfig>,
): { xml: string; node: string; timeoutMs: number } | null {
  if (key === 'ledgers') return { xml: sundryDebtorsRequest(cfg), node: 'LEDGER', timeoutMs: 120000 };
  if (key === 'accountingGroups') return { xml: accountingGroupsRequest(cfg), node: 'GROUP', timeoutMs: 60000 };
  if (key === 'stockItems') return { xml: stockItemsRequest(cfg), node: 'STOCKITEM', timeoutMs: 60000 };
  if (key === 'stockGroups') return { xml: stockGroupsRequest(cfg), node: 'STOCKGROUP', timeoutMs: 30000 };
  if (key === 'profitLoss') return { xml: profitLossRequest(cfg), node: 'DSPACCNAME', timeoutMs: 30000 };
  if (key === 'balanceSheet') return { xml: balanceSheetRequest(cfg), node: 'DSPACCNAME', timeoutMs: 30000 };
  if (key === 'trialBalance') return { xml: trialBalanceRequest(cfg), node: 'DSPACCNAME', timeoutMs: 45000 };
  if (key === 'salesRegister') return { xml: salesRegisterRequest(cfg), node: 'VOUCHER', timeoutMs: 90000 };
  if (key === 'purchaseRegister') return { xml: purchaseRegisterRequest(cfg), node: 'VOUCHER', timeoutMs: 90000 };
  if (key === 'receiptRegister') return { xml: receiptRegisterRequest(cfg), node: 'VOUCHER', timeoutMs: 90000 };
  if (key === 'billsOutstanding') return { xml: billsOutstandingRequest(cfg), node: 'BILLFIXED', timeoutMs: 60000 };
  return null;
}

function ttlForKey(key: string): number {
  return COLLECTION_TTL_MS[key] ?? 30 * 60_000;
}

// Module-level guard so we only log the "RPC missing" fallback message
// once per Deno isolate warm-up instead of on every persist call.
let mergeRpcMissingLogged = false;

// Persist a single collection key to tally_snapshots. Prefers the
// server-side merge RPC (merge_tally_snapshot_key) so Deno only sends
// the new key's value; falls back to a read-modify-write upsert when the
// RPC is missing from the schema cache. The missing-RPC case is a real
// production hazard: the migration (20260424000100_merge_snapshot_rpcs)
// lives under supabase/migrations but deploy-supabase.yml runs
// `supabase db push` with continue-on-error, so any migration-history
// drift silently skips the RPC install — and every per-collection
// persist then fails with "Could not find the function ... in the
// schema cache". Users saw counts of 1/1/1 on fresh syncs while
// dashboards stayed empty because nothing was actually landing in
// tally_snapshots. The fallback path keeps the app functional even
// with migration skew; the primary path still runs first whenever
// the RPC is available.
async function persistSnapshotKey(
  db: ReturnType<typeof createClient>,
  tenantKey: string,
  company: string,
  key: string,
  data: unknown,
  count: number,
): Promise<string | null> {
  const { error: rpcErr } = await db.rpc('merge_tally_snapshot_key', {
    p_tenant_key: tenantKey,
    p_company: company,
    p_key: key,
    p_data: data,
    p_count: count,
    p_source: 'sync-full',
  });
  if (!rpcErr) return null;
  const rpcMsg = rpcErr.message || String(rpcErr);
  const rpcMissing = /schema cache|Could not find the function|does not exist/i.test(rpcMsg);
  if (!rpcMissing) return rpcMsg;
  if (!mergeRpcMissingLogged) {
    // eslint-disable-next-line no-console
    console.warn(
      '[tally] merge_tally_snapshot_key RPC missing — falling back to direct upsert. Run `supabase db push` to apply the 20260424000100_merge_snapshot_rpcs migration. Dashboards will still populate via the fallback path but compute-memory safety of the server-side merge is lost.',
    );
    mergeRpcMissingLogged = true;
  }
  // Fallback: SELECT existing row, merge the new key in Deno, UPSERT
  // the full row back. This reintroduces the old memory pressure for
  // heavy collections (Day Book shards), but it's strictly better than
  // the current behaviour of persisting nothing at all.
  const nowIso = new Date().toISOString();
  const { data: existing, error: selErr } = await db
    .from('tally_snapshots')
    .select('data, counts, errors, collection_meta')
    .eq('tenant_key', tenantKey)
    .eq('company', company)
    .maybeSingle();
  if (selErr) return `fallback select failed: ${selErr.message}`;
  const existingData = (existing?.data as Record<string, unknown>) || {};
  const existingCounts = (existing?.counts as Record<string, number>) || {};
  const existingErrors = (existing?.errors as Record<string, string>) || {};
  const existingMeta = (existing?.collection_meta as Record<string, { updated_at?: string; count?: number; error?: string | null }>) || {};
  const nextErrors = { ...existingErrors };
  delete nextErrors[key];
  const { error: upErr } = await db.from('tally_snapshots').upsert({
    tenant_key: tenantKey,
    company,
    data: { ...existingData, [key]: data },
    counts: { ...existingCounts, [key]: count },
    errors: nextErrors,
    collection_meta: { ...existingMeta, [key]: { updated_at: nowIso, count, error: null } },
    source: 'sync-full',
    updated_at: nowIso,
  }, { onConflict: 'tenant_key,company' });
  if (upErr) return `fallback upsert failed: ${upErr.message}`;
  return null;
}

// Stamped into every sync-full / get-snapshot response so the client can
// tell which edge-function revision it's talking to. Bump manually when
// deploys need verification; the value is purely informational. Useful
// when diagnosing "is my fix live yet?" without digging into Actions logs.
const EDGE_BUILD_ID = '2026-04-24-sync-discover-client-chained';

// Merge a new sync result into the existing tally_snapshots row. Idempotent
// — collections not included in `incoming.data` retain their prior values
// (which is how "next sync continues from where last one left off" works:
// a partial failure ingest only overwrites the collections it has fresh
// data for, not the entire row).
async function mergeSnapshotIntoTable(
  db: ReturnType<typeof createClient>,
  tenantKey: string,
  company: string,
  incoming: {
    data?: Record<string, unknown>;
    counts?: Record<string, number>;
    errors?: Record<string, string>;
    source?: string;
  },
) {
  const { data: existing } = await db
    .from('tally_snapshots')
    .select('data, counts, errors, collection_meta')
    .eq('tenant_key', tenantKey)
    .eq('company', company)
    .maybeSingle();

  const data = { ...(existing?.data as Record<string, unknown> || {}) };
  const counts = { ...(existing?.counts as Record<string, number> || {}) };
  const errors = { ...(existing?.errors as Record<string, string> || {}) };
  const meta = { ...(existing?.collection_meta as Record<string, unknown> || {}) };
  const nowIso = new Date().toISOString();

  if (incoming.data) {
    for (const [key, value] of Object.entries(incoming.data)) {
      if (value == null) continue; // skip explicit nulls (failed collection)
      data[key] = value;
      if (incoming.counts && key in incoming.counts) counts[key] = incoming.counts[key];
      delete errors[key]; // success clears prior error
      meta[key] = {
        updated_at: nowIso,
        count: (incoming.counts?.[key]) ?? counts[key] ?? 0,
        error: null,
      };
    }
  }

  if (incoming.errors) {
    for (const [key, err] of Object.entries(incoming.errors)) {
      if (!err) continue;
      errors[key] = err;
      meta[key] = {
        updated_at: (meta[key] as Record<string, unknown>)?.updated_at ?? null,
        count: counts[key] ?? 0,
        error: err,
      };
    }
  }

  const { error } = await db.from('tally_snapshots').upsert({
    tenant_key: tenantKey,
    company,
    data,
    counts,
    errors,
    source: incoming.source || 'unknown',
    collection_meta: meta,
    updated_at: nowIso,
  }, { onConflict: 'tenant_key,company' });

  return { error, data, counts, errors, collectionMeta: meta };
}

// Wraps mergeSnapshotIntoTable with the ingest-action body parsing (supports
// both data: {parsed} and rawXml: {stringMap}).
async function mergeSnapshotFromBody(
  db: ReturnType<typeof createClient>,
  tenantKey: string,
  company: string,
  body: Record<string, unknown>,
) {
  let data = body.data as Record<string, unknown> | undefined;
  const counts: Record<string, number> = (body.counts && typeof body.counts === 'object')
    ? { ...(body.counts as Record<string, number>) } : {};
  const errors: Record<string, string> = (body.errors && typeof body.errors === 'object')
    ? { ...(body.errors as Record<string, string>) } : {};

  if (body.rawXml && typeof body.rawXml === 'object') {
    const nodePerKey: Record<string, string> = {
      ledgers: 'LEDGER',
      accountingGroups: 'GROUP',
      salesVouchers: 'VOUCHER',
      receiptVouchers: 'VOUCHER',
      stockItems: 'STOCKITEM',
      stockGroups: 'STOCKGROUP',
    };
    const parsed: Record<string, unknown> = {};
    for (const [key, xml] of Object.entries(body.rawXml as Record<string, unknown>)) {
      if (typeof xml !== 'string' || !xml) {
        errors[key] = 'Empty or non-string payload';
        continue;
      }
      try {
        const node = parser.parse(xml);
        parsed[key] = node;
        counts[key] = counts[key] ?? countNode(node, nodePerKey[key] || 'LEDGER');
      } catch (err) {
        errors[key] = err instanceof Error ? err.message : String(err);
      }
    }
    data = parsed;
  }

  if (!data || typeof data !== 'object') {
    return { error: 'ingest requires a "data" object or "rawXml" string map' };
  }

  const source = (body.source as string) || 'local-playwright';
  const { error, counts: outCounts, errors: outErrors, collectionMeta } =
    await mergeSnapshotIntoTable(db, tenantKey, company, { data, counts, errors, source });
  if (error) return { error: `Failed to persist snapshot: ${error.message}` };
  return { result: { counts: outCounts, errors: outErrors, collectionMeta } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
  // Reset per-invocation diagnostics so responses (test / sync-full) can
  // report whether the portal auto-login path kicked in for this call.
  resetDiagnostics();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ connected: false, error: 'Request body must be JSON' }), {
      status: 400, headers: jsonHeaders,
    });
  }

  const action = (body.action as string) || 'test';
  const cfg = resolveConfig(body as TallyConfig);
  const tenantKey = (body.tenantKey as string) || 'default';
  // `company` is the second half of the compound key on tally_snapshots.
  // Callers that don't send one (legacy clients, single-company tenants)
  // get an empty string which matches the migration's default; fresh
  // multi-company callers pass the explicit Tally company name.
  const company = typeof body.company === 'string' ? body.company : '';

  // Snapshot + portal-config actions. These are for the scheduled GitHub
  // Actions sync (get-config + ingest), the web dashboards reading the most
  // recent persisted snapshot (get-snapshot), and admins saving / triggering
  // syncs from the UI (save-config + trigger-sync + get-status).
  const dbActions = new Set([
    'get-config', 'save-config', 'ingest', 'get-snapshot', 'get-status', 'trigger-sync',
    'list-companies', 'get-companies', 'set-active-company', 'delete-snapshot',
  ]);
  if (dbActions.has(action)) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceRole) {
      return new Response(JSON.stringify({
        connected: false,
        error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — snapshot actions unavailable.',
      }), { status: 500, headers: jsonHeaders });
    }
    const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    // Token-gated actions: anything that reads creds or mutates state requires
    // LOCAL_SYNC_TOKEN. get-snapshot + get-status are read-only (same trust
    // level as /sync-full) and pass through with just the project anon key.
    // Company list + active-company selection are not token-gated: the
    // company list comes from Tally itself (not our secrets), active_company
    // is a UI-state pointer into existing rows. Callers with the anon key
    // may freely list / read / switch; the write surface is limited to this
    // one pointer field. Matches the access level of sync-full / get-snapshot.
    const gatedActions = new Set([
      'get-config', 'save-config', 'ingest', 'trigger-sync',
    ]);
    if (gatedActions.has(action)) {
      const required = Deno.env.get('LOCAL_SYNC_TOKEN') || '';
      const provided = (body.syncToken as string) || '';
      if (!required) {
        return new Response(JSON.stringify({
          connected: false,
          error: 'Server missing LOCAL_SYNC_TOKEN — set it with `supabase secrets set LOCAL_SYNC_TOKEN=...` to enable sync.',
        }), { status: 500, headers: jsonHeaders });
      }
      if (provided !== required) {
        return new Response(JSON.stringify({
          connected: false,
          error: 'Invalid syncToken',
        }), { status: 401, headers: jsonHeaders });
      }
    }

    if (action === 'save-config') {
      // Admin UI writes creds here instead of the operator doing
      // `supabase secrets set`. One row per tenant.
      const required = ['portalUrl', 'portalUser', 'portalPass'];
      const missing = required.filter((k) => !body[k] || typeof body[k] !== 'string');
      if (missing.length) {
        return new Response(JSON.stringify({
          connected: false,
          error: `Missing required fields: ${missing.join(', ')}`,
        }), { status: 400, headers: jsonHeaders });
      }
      const { error } = await db.from('tally_portal_config').upsert({
        tenant_key: tenantKey,
        portal_url: String(body.portalUrl).trim().replace(/\/+$/, ''),
        portal_user: String(body.portalUser).trim(),
        portal_pass: String(body.portalPass),
        tally_host: String(body.tallyHost || '').trim(),
        tally_user: String(body.tallyUser || '').trim(),
        tally_pass: String(body.tallyPass || ''),
        company: String(body.company || '').trim(),
        updated_at: new Date().toISOString(),
        updated_by: (body.updatedBy as string) || null,
      }, { onConflict: 'tenant_key' });
      if (error) {
        return new Response(JSON.stringify({
          connected: false,
          error: `Failed to save config: ${error.message}`,
        }), { status: 500, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({ connected: true, action, tenantKey }), { headers: jsonHeaders });
    }

    if (action === 'get-config') {
      // DB row wins; fall back to Deno env secrets for backwards compat with
      // setups that provisioned via `supabase secrets set` before the UI
      // existed. tally-level creds are passed through verbatim.
      const { data: row } = await db
        .from('tally_portal_config')
        .select('*')
        .eq('tenant_key', tenantKey)
        .maybeSingle();
      return new Response(JSON.stringify({
        connected: true,
        action,
        config: {
          portalUrl: row?.portal_url || Deno.env.get('TALLY_PORTAL_URL') || '',
          portalUser: row?.portal_user || Deno.env.get('TALLY_PORTAL_USER') || '',
          portalPass: row?.portal_pass || Deno.env.get('TALLY_PORTAL_PASS') || '',
          tallyHost: row?.tally_host || Deno.env.get('TALLY_HOST') || '',
          tallyUser: row?.tally_user || Deno.env.get('TALLY_USERNAME') || '',
          tallyPass: row?.tally_pass || Deno.env.get('TALLY_PASSWORD') || '',
          company: row?.company || Deno.env.get('TALLY_COMPANY') || '',
          tenantKey,
          source: row ? 'db' : 'env',
          updatedAt: row?.updated_at || null,
        },
      }), { headers: jsonHeaders });
    }

    if (action === 'trigger-sync') {
      // Kicks off the scheduled sync workflow via GitHub's workflow_dispatch
      // API. Needs GITHUB_SYNC_PAT (PAT with 'workflow' scope) + the repo
      // owner/name in env. Used by the "Sync Now" button in the admin UI.
      const pat = Deno.env.get('GITHUB_SYNC_PAT') || '';
      const owner = Deno.env.get('GITHUB_REPO_OWNER') || '';
      const repo = Deno.env.get('GITHUB_REPO_NAME') || '';
      const workflow = Deno.env.get('GITHUB_SYNC_WORKFLOW') || 'tally-scheduled-sync.yml';
      const ref = Deno.env.get('GITHUB_SYNC_REF') || 'main';
      if (!pat || !owner || !repo) {
        return new Response(JSON.stringify({
          connected: false,
          error: 'GITHUB_SYNC_PAT / GITHUB_REPO_OWNER / GITHUB_REPO_NAME not configured — hourly cron still runs, just no manual trigger.',
        }), { status: 500, headers: jsonHeaders });
      }
      const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
      const ghRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref, inputs: { tenant_key: tenantKey } }),
      });
      if (!ghRes.ok) {
        const text = await ghRes.text();
        return new Response(JSON.stringify({
          connected: false,
          error: `GitHub dispatch failed (HTTP ${ghRes.status}): ${text.slice(0, 200)}`,
        }), { status: 500, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({
        connected: true,
        action,
        message: 'Sync queued. Check GitHub Actions for progress. Snapshot will refresh in ~2 min.',
      }), { headers: jsonHeaders });
    }

    if (action === 'get-status') {
      // Dashboard polls this to show "last synced / next run" info without
      // leaking creds. Anon-key callers are fine — no secrets returned.
      const { data: cos } = await db
        .from('tally_companies')
        .select('active_company')
        .eq('tenant_key', tenantKey)
        .maybeSingle();
      const activeCompany = company || cos?.active_company || '';
      const { data: snap } = await db
        .from('tally_snapshots')
        .select('counts, errors, source, updated_at, company')
        .eq('tenant_key', tenantKey)
        .eq('company', activeCompany)
        .maybeSingle();
      const { data: cfg } = await db
        .from('tally_portal_config')
        .select('portal_url, portal_user, company, updated_at')
        .eq('tenant_key', tenantKey)
        .maybeSingle();
      return new Response(JSON.stringify({
        connected: true,
        action,
        configured: Boolean(cfg?.portal_url),
        configPreview: cfg ? {
          portalUrl: cfg.portal_url,
          portalUser: cfg.portal_user,
          company: cfg.company,
          updatedAt: cfg.updated_at,
        } : null,
        snapshot: snap ? {
          updatedAt: snap.updated_at,
          source: snap.source,
          counts: snap.counts || {},
          hasErrors: snap.errors && Object.keys(snap.errors).length > 0,
          errors: snap.errors || {},
        } : null,
      }), { headers: jsonHeaders });
    }

    if (action === 'ingest') {
      const { result, error } = await mergeSnapshotFromBody(db, tenantKey, company, body);
      if (error) {
        return new Response(JSON.stringify({ connected: false, error }), {
          status: 500, headers: jsonHeaders,
        });
      }
      return new Response(JSON.stringify({ connected: true, action, tenantKey, ...result }), { headers: jsonHeaders });
    }

    // list-companies: probe Tally's built-in "List of Companies" report,
    // extract the company names, cache them in tally_companies, and return
    // the list. Token-gated because it's the Tally-hits-the-wire action.
    // Typical flow: admin clicks "Detect companies" in the settings card →
    // UI calls this → dropdown populates. The cached list is then served
    // by get-companies (anon-safe) so every dashboard load doesn't re-ping
    // Tally for the same master data.
    if (action === 'list-companies') {
      const xml = reportRequest('List of Companies', cfg.company || '');
      let companies: string[] = [];
      try {
        const parsed = await tallyRequest(xml, cfg, 20000);
        // Walk the parsed XML for every COMPANYNAME or NAME attribute on a
        // COMPANY node. Tally's List of Companies puts the name at
        // COMPANY.@_NAME in attribute form, so we check both the text node
        // and the attribute-prefixed variant.
        const seen = new Set<string>();
        const walk = (node: unknown) => {
          if (!node) return;
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (typeof node !== 'object') return;
          for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            const k = key.toUpperCase();
            if (k === 'COMPANY' || k === 'COMPANIES') {
              // Multi-company responses come back as an array (COMPANY is
              // array-forced in our isArray config); single-company ones
              // can still be a bare object. Handle both so the dropdown
              // populates correctly for users with 4 companies loaded.
              const items = Array.isArray(value) ? value : [value];
              for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                const rec = item as Record<string, unknown>;
                const raw = rec?._NAME ?? rec?.NAME;
                // Unwrap text-node wrappers: NAME might be "Foo" OR
                // { _text: "Foo" } OR { "#text": "Foo" } depending on
                // Tally's XML shape. Check all three.
                let name: string | undefined;
                if (typeof raw === 'string') name = raw;
                else if (raw && typeof raw === 'object') {
                  const r = raw as Record<string, unknown>;
                  if (typeof r._text === 'string') name = r._text;
                  else if (typeof r['#text'] === 'string') name = r['#text'] as string;
                }
                if (name && name.trim()) seen.add(name.trim());
              }
              walk(value);
            } else {
              walk(value);
            }
          }
        };
        walk(parsed);
        companies = Array.from(seen).sort();
      } catch (err) {
        return new Response(JSON.stringify({
          connected: false,
          error: `List of Companies failed: ${err instanceof Error ? err.message : String(err)}`,
        }), { status: 500, headers: jsonHeaders });
      }
      if (companies.length) {
        await db.from('tally_companies').upsert({
          tenant_key: tenantKey,
          companies,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_key' });
      }
      return new Response(JSON.stringify({ connected: true, action, companies }), { headers: jsonHeaders });
    }

    // get-companies: read-only, returns cached companies list + the current
    // active_company. Anon-safe (no creds).
    if (action === 'get-companies') {
      const { data: row } = await db
        .from('tally_companies')
        .select('companies, active_company, updated_at')
        .eq('tenant_key', tenantKey)
        .maybeSingle();
      return new Response(JSON.stringify({
        connected: true,
        action,
        companies: (row?.companies as string[]) || [],
        activeCompany: row?.active_company || '',
        updatedAt: row?.updated_at || null,
      }), { headers: jsonHeaders });
    }

    // set-active-company: admin picks which company dashboards read from.
    // Dashboards call get-snapshot without an explicit company → it
    // resolves to active_company here.
    if (action === 'set-active-company') {
      const next = (body.company as string) || '';
      const { error } = await db.from('tally_companies').upsert({
        tenant_key: tenantKey,
        active_company: next,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_key' });
      if (error) {
        return new Response(JSON.stringify({
          connected: false,
          error: `Failed to set active company: ${error.message}`,
        }), { status: 500, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({ connected: true, action, activeCompany: next }), { headers: jsonHeaders });
    }

    // Nuke the snapshot for this tenant (+ optional company) so the next
    // sync starts from a blank slate. MUST come before the get-snapshot
    // default tail below — that tail returns for ANY unmatched action in
    // the dbActions set, so delete-snapshot was falling through to it and
    // never running the actual DELETE.
    if (action === 'delete-snapshot') {
      const q = db.from('tally_snapshots').delete().eq('tenant_key', tenantKey);
      const { error: delErr } = company ? await q.eq('company', company) : await q;
      if (delErr) {
        return new Response(JSON.stringify({ connected: false, error: `Failed to delete snapshot: ${delErr.message}` }), { status: 500, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({ connected: true, action, deleted: true, company: company || '(all)' }), { headers: jsonHeaders });
    }

    // get-snapshot — default tail of the dbActions block. Must run LAST.
    // Resolve which company to read: explicit body.company > active_company
    // saved in tally_companies > empty string (back-compat with the single-
    // company row that existed before the compound-PK migration).
    let snapshotCompany = company;
    if (!snapshotCompany) {
      const { data: cos } = await db
        .from('tally_companies')
        .select('active_company')
        .eq('tenant_key', tenantKey)
        .maybeSingle();
      snapshotCompany = cos?.active_company || '';
    }
    const { data: row, error } = await db
      .from('tally_snapshots')
      .select('data, counts, errors, source, updated_at, collection_meta, company')
      .eq('tenant_key', tenantKey)
      .eq('company', snapshotCompany)
      .maybeSingle();
    if (error) {
      return new Response(JSON.stringify({
        connected: false,
        error: `Failed to load snapshot: ${error.message}`,
      }), { status: 500, headers: jsonHeaders });
    }
    if (!row) {
      return new Response(JSON.stringify({
        connected: false,
        action,
        error: 'No snapshot yet — run the local sync tool to populate one.',
      }), { headers: jsonHeaders });
    }
    return new Response(JSON.stringify({
      connected: true,
      action,
      counts: row.counts || {},
      errors: row.errors || {},
      data: row.data,
      source: row.source,
      updatedAt: row.updated_at,
      collectionMeta: row.collection_meta || {},
    }), { headers: jsonHeaders });
  }

  // sync-discover: runs ONLY the company-detection probe that sync-full does
  // at its top, then returns the discovered companies + resolved active
  // company without touching any collection fetches. Exists so the client
  // can drive sync as a sequence of (discover → sync-collection per phase)
  // with its own pacing — giving each phase a fresh 150s isolate and a
  // cooldown between calls so a transient Tally crash or RemoteApp tunnel
  // drop on one phase doesn't cascade into skipping every remaining phase,
  // which is what sync-full's monolithic loop used to do when Tally's XML
  // service bounced mid-run.
  //
  // Body: { action: 'sync-discover', ...creds }
  // Returns: { connected, activeCompany, discoveredCompanies, discoveryError, discoveryRawSample, diagnostics }
  // Explicit "Load Company" action. Some hosted-Tally setups don't
  // auto-load when SVCURRENTCOMPANY is set on a regular collection
  // query — they answer with built-in placeholders until the company
  // is actually open in the Tally UI. This action sends Tally's
  // dedicated Load Company XML to force the open, then returns
  // whatever Tally sent back so the caller can verify success.
  //
  // Body: { action: 'load-company', company, ...creds }
  // Returns: { connected, action, company, response, error?, status?, diagnostics }
  if (action === 'load-company') {
    const target = String(body.company || cfg.company || company || '').trim();
    if (!target) {
      return new Response(JSON.stringify({
        connected: false, action,
        error: 'load-company requires `company` in the request body or stored config.',
      }), { status: 400, headers: jsonHeaders });
    }
    // Tally accepts two different XML shapes for opening a company
    // depending on build / hosted-Tally configuration. Try the simple
    // TALLYREQUEST=Load Company form first; if Tally responds with an
    // explicit error envelope (LINEERROR / DESC>ERR / "no such
    // company"), fall back to the Execute Action form. Both raw
    // responses are returned so the caller can see exactly what
    // Tally said.
    const attempts: { form: string; ok: boolean; sample: string | null; error: string | null }[] = [];
    const isErrorResponse = (parsed: unknown): { ok: boolean; reason: string | null } => {
      if (!parsed || typeof parsed !== 'object') return { ok: true, reason: null };
      const text = (() => {
        try { return JSON.stringify(parsed).toLowerCase(); } catch { return ''; }
      })();
      // Tally surfaces errors via LINEERROR, EXCEPTIONS, or a
      // "no company" string somewhere in the envelope. Treat any
      // of those as a failed load so the next form gets a chance.
      if (/lineerror|"err"|exception|no.*company|invalid|not found|could not/i.test(text)) {
        return { ok: false, reason: text.slice(0, 240) };
      }
      return { ok: true, reason: null };
    };
    const tryForm = async (form: string, xml: string) => {
      try {
        const parsed = await tallyRequest(xml, cfg, 30000);
        let sample: string | null = null;
        try { sample = JSON.stringify(parsed).slice(0, 1500); } catch { /* ignore */ }
        const verdict = isErrorResponse(parsed);
        attempts.push({ form, ok: verdict.ok, sample, error: verdict.reason });
        return verdict.ok;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ form, ok: false, sample: null, error: msg });
        return false;
      }
    };
    let connected = await tryForm('tdlaction', loadCompanyRequestTDLAction(target));
    if (!connected) {
      connected = await tryForm('action', loadCompanyRequest(target));
    }
    if (!connected) {
      connected = await tryForm('simple', loadCompanyRequestSimple(target));
    }
    return new Response(JSON.stringify({
      connected,
      action,
      company: target,
      attempts,
      // Backward-compat: keep `response` + `error` mirrored from the
      // last attempt so older clients still see the same shape.
      response: attempts[attempts.length - 1]?.sample || null,
      error: connected ? null : (attempts[attempts.length - 1]?.error || 'Load Company failed in both XML forms.'),
      edgeBuildId: EDGE_BUILD_ID,
      diagnostics: snapshotDiagnostics(),
    }), { headers: jsonHeaders });
  }

  if (action === 'sync-discover') {
    const dbUrl = Deno.env.get('SUPABASE_URL') || '';
    const dbRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const db = (dbUrl && dbRole) ? createClient(dbUrl, dbRole, { auth: { persistSession: false } }) : null;
    let activeCompany = cfg.company || company;
    let discoveredCompanies: string[] = [];
    let discoveryError: string | null = null;
    let discoveryRawSample: string | null = null;

    // Shared walker — finds every COMPANY node in a parsed tree and
    // extracts the Name attribute / element regardless of which shape
    // Tally used (attribute, text node, #text wrapper).
    const walkForCompanies = (parsed: unknown): string[] => {
      const seen = new Set<string>();
      const walk = (node: unknown) => {
        if (!node) return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (key.toUpperCase() === 'COMPANY') {
            const items = Array.isArray(value) ? value : [value];
            for (const item of items) {
              if (!item || typeof item !== 'object') continue;
              const rec = item as Record<string, unknown>;
              const raw = rec?._NAME ?? rec?.NAME;
              let name: string | undefined;
              if (typeof raw === 'string') name = raw;
              else if (raw && typeof raw === 'object') {
                const r = raw as Record<string, unknown>;
                if (typeof r._text === 'string') name = r._text;
                else if (typeof r['#text'] === 'string') name = r['#text'] as string;
              }
              if (name && name.trim()) seen.add(name.trim());
            }
          }
          walk(value);
        }
      };
      walk(parsed);
      return Array.from(seen).sort();
    };

    // Probe 1: "List of Selected Companies" report. This returns
    // ONLY the companies currently loaded in TallyPrime's GUI — i.e.
    // the ones the XML server can actually serve real data for.
    // That's the answer we want as the active company on every sync.
    // Previously we used "List of Companies" which returns every
    // company on disk regardless of load state, then fell back to
    // a cached active_company; the result was that even when the
    // user had UA open in Tally right now, the sync would still
    // drive against GIRNAR because GIRNAR was the cached active
    // from an earlier run.
    let loadedCompanies: string[] = [];
    try {
      const probeXml = reportRequest('List of Selected Companies', '');
      const parsed = await tallyRequest(probeXml, cfg, 15000);
      try {
        discoveryRawSample = `Probe 1 (List of Selected Companies):\n${JSON.stringify(parsed).slice(0, 1200)}`;
      } catch { /* ignore */ }
      loadedCompanies = walkForCompanies(parsed);
    } catch (err) {
      discoveryError = err instanceof Error ? err.message : String(err);
    }

    // Probe 2: built-in "List of Companies" report — every company
    // on disk, loaded or not. Used as a directory listing only;
    // never as the active company since loaded state is what
    // matters for SVCURRENTCOMPANY routing.
    let onDiskCompanies: string[] = [];
    if (!loadedCompanies.length) {
      try {
        const probeXml = reportRequest('List of Companies', '');
        const parsed = await tallyRequest(probeXml, cfg, 15000);
        try {
          const sample = JSON.stringify(parsed).slice(0, 1200);
          discoveryRawSample = discoveryRawSample
            ? `${discoveryRawSample}\n---\nProbe 2 (List of Companies):\n${sample}`
            : `Probe 2 (List of Companies):\n${sample}`;
        } catch { /* ignore */ }
        onDiskCompanies = walkForCompanies(parsed);
      } catch (err) {
        if (!discoveryError) discoveryError = err instanceof Error ? err.message : String(err);
      }
    }

    // Probe 3: custom TDL COLLECTION of Company objects. Enumerates
    // Tally's internal company registry directly. Used as a final
    // fallback when both report-style probes return empty (some
    // hosted-Tally tunnels block report queries until a company is
    // open but still answer collection queries).
    if (!loadedCompanies.length && !onDiskCompanies.length) {
      try {
        const probeXml = companiesRequest({ company: '' });
        const parsed = await tallyRequest(probeXml, cfg, 15000);
        try {
          const sample = JSON.stringify(parsed).slice(0, 1200);
          discoveryRawSample = discoveryRawSample
            ? `${discoveryRawSample}\n---\nProbe 3 (TDL Company collection):\n${sample}`
            : `Probe 3 (TDL Company collection):\n${sample}`;
        } catch { /* ignore */ }
        const found = walkForCompanies(parsed);
        if (found.length) {
          onDiskCompanies = found;
          discoveryError = null;
        }
      } catch (err) {
        if (!discoveryError) discoveryError = err instanceof Error ? err.message : String(err);
      }
    }

    // Resolve activeCompany strictly off what's CURRENTLY loaded.
    // Cached active_company is only consulted when no loaded
    // company can be detected (Tally still answering pings but
    // with nothing open) and only as a hint, not as an authority.
    if (loadedCompanies.length) {
      discoveredCompanies = loadedCompanies;
      // Always pick the first loaded company as active. If the
      // user has multiple companies loaded, the iteration in
      // handleSync will sync each of them in turn.
      activeCompany = activeCompany && loadedCompanies.includes(activeCompany)
        ? activeCompany
        : loadedCompanies[0];
    } else {
      discoveredCompanies = onDiskCompanies;
      // No loaded company — try cached active as last resort. If
      // even that's missing or stale, the empty-no-data path
      // below kicks in with a clear error.
      if (db && discoveredCompanies.length) {
        try {
          const { data: prior } = await db
            .from('tally_companies')
            .select('active_company')
            .eq('tenant_key', tenantKey)
            .maybeSingle();
          if (prior?.active_company && discoveredCompanies.includes(prior.active_company)) {
            activeCompany = activeCompany || prior.active_company;
          } else {
            activeCompany = activeCompany || discoveredCompanies[0];
          }
        } catch { /* non-fatal */ }
      } else if (discoveredCompanies.length) {
        activeCompany = activeCompany || discoveredCompanies[0];
      }
    }

    // Persist the freshly-resolved view (loaded list + active) so
    // a subsequent get-companies call sees the truth, not stale
    // state from the previous sync.
    if (db && discoveredCompanies.length) {
      try {
        await db.from('tally_companies').upsert({
          tenant_key: tenantKey,
          companies: discoveredCompanies,
          active_company: activeCompany || discoveredCompanies[0],
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_key' });
      } catch { /* non-fatal */ }
    }
    // Fallback: "List of Companies" only returns companies that are
    // CURRENTLY LOADED in TallyPrime. If the user is sitting on the
    // "Select Company" screen (e.g. right after dismissing the c0000005
    // Internal Error dialog), the probe returns empty even though the
    // XML server is healthy. In that case we reuse the list we
    // persisted from the last successful run so the sync can proceed —
    // Tally accepts the old company name in SVCURRENTCOMPANY and will
    // auto-load it on the first report query.
    let usedCachedCompanies = false;
    if (db && !discoveredCompanies.length) {
      try {
        const { data: row } = await db
          .from('tally_companies')
          .select('companies, active_company')
          .eq('tenant_key', tenantKey)
          .maybeSingle();
        const cached = (row?.companies as string[] | null) || [];
        if (cached.length) {
          discoveredCompanies = cached;
          usedCachedCompanies = true;
          if (!activeCompany) {
            activeCompany = row?.active_company && cached.includes(row.active_company)
              ? row.active_company
              : cached[0];
          }
        }
      } catch { /* non-fatal — we'll surface the no-companies error below */ }
    }
    const connected = discoveredCompanies.length > 0 || Boolean(activeCompany);
    // Build an actionable error when we genuinely have nothing. The
    // common cause here is TallyPrime showing the "Select Company"
    // screen — the server answers pings but has no open company, so
    // every report request returns an empty tree. Telling the user
    // exactly what to click beats the old generic "no companies".
    let resolvedError: string | null = discoveryError;
    if (!connected && !resolvedError) {
      resolvedError = 'TallyPrime is reachable but no company is open. In Tally, pick a company from "List of Companies" (Gateway of Tally → Select Company) and try again.';
    }
    return new Response(JSON.stringify({
      connected,
      action,
      edgeBuildId: EDGE_BUILD_ID,
      activeCompany,
      discoveredCompanies,
      discoveryError: resolvedError,
      discoveryRawSample: (discoveredCompanies.length === 0 && !discoveryError) ? discoveryRawSample : null,
      usedCachedCompanies,
      diagnostics: snapshotDiagnostics(),
    }), { headers: jsonHeaders });
  }

  if (action === 'sync-full') {
    // Serial, not parallel. Shared-host Tally tunnels (ngrok free, cloudflare
    // quick tunnels, etc.) often only allow 1-2 concurrent connections; 5 at
    // once is what makes them drop the whole session. Trade faster wall clock
    // for reliability.
    //
    // skipFresh (default true) reads the persisted tally_snapshots row and
    // skips any collection synced within COLLECTION_TTL_MS that didn't
    // error. That's how "don't re-sync the same things" + "continue from
    // where the last run left off" both work: on a healthy refresh only
    // stale / errored collections hit Tally; after a partial failure the
    // fresh ones keep their data and the retry budgets go to what actually
    // needs it.
    const skipFresh = body.skipFresh !== false;

    // Decide which collections to actually fetch. We can only persist +
    // skip-fresh if Supabase service role env is set; without it we fall
    // back to the original always-fetch-all behaviour.
    const dbUrl = Deno.env.get('SUPABASE_URL') || '';
    const dbRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const db = (dbUrl && dbRole) ? createClient(dbUrl, dbRole, { auth: { persistSession: false } }) : null;

    // Auto-detect companies at the start of every sync (~1-2s, cheap report).
    // Keeps the top-bar switcher populated without a manual "Detect" click.
    // If body.company is empty, use the stored active_company as the sync
    // target so the user's chosen company drives every collection query.
    let activeCompany = cfg.company || company;
    let discoveredCompanies: string[] = [];
    let discoveryError: string | null = null;
    // When detection succeeds but the parser finds no companies, keep a
    // short dump of the raw XML so we can diagnose unexpected Tally shapes
    // (which differ by TallyPrime version). Truncated to 1500 chars.
    let discoveryRawSample: string | null = null;
    if (db) {
      try {
        const probeXml = reportRequest('List of Companies', '');
        // Snag the raw text too — if the parser finds nothing below, we
        // include a truncated slice in the response so we can see what
        // Tally actually sent us and fix the shape.
        const parsed = await tallyRequest(probeXml, cfg, 15000);
        try {
          discoveryRawSample = JSON.stringify(parsed).slice(0, 1500);
        } catch { /* ignore */ }
        const seen = new Set<string>();
        const walk = (node: unknown) => {
          if (!node) return;
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (typeof node !== 'object') return;
          for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key.toUpperCase() === 'COMPANY') {
              // COMPANY is array-forced in our isArray config so multi-company
              // responses come back as an array; but a single-company tally
              // could legitimately return one object. Handle both.
              const items = Array.isArray(value) ? value : [value];
              for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                const rec = item as Record<string, unknown>;
                const raw = rec?._NAME ?? rec?.NAME;
                // Unwrap text-node wrappers: NAME might be "Foo" OR
                // { _text: "Foo" } OR { "#text": "Foo" } depending on
                // Tally's XML shape. Check all three.
                let name: string | undefined;
                if (typeof raw === 'string') name = raw;
                else if (raw && typeof raw === 'object') {
                  const r = raw as Record<string, unknown>;
                  if (typeof r._text === 'string') name = r._text;
                  else if (typeof r['#text'] === 'string') name = r['#text'] as string;
                }
                if (name && name.trim()) seen.add(name.trim());
              }
            }
            walk(value);
          }
        };
        walk(parsed);
        discoveredCompanies = Array.from(seen).sort();
        if (discoveredCompanies.length) {
          // Try to persist into tally_companies. If the table doesn't exist
          // (migration hasn't been applied yet), catch the error and keep
          // going — we still return the list in the response so the UI can
          // display the switcher via localStorage fallback.
          try {
            const { data: prior } = await db
              .from('tally_companies')
              .select('active_company')
              .eq('tenant_key', tenantKey)
              .maybeSingle();
            const nextActive = prior?.active_company
              && discoveredCompanies.includes(prior.active_company)
                ? prior.active_company
                : discoveredCompanies[0];
            await db.from('tally_companies').upsert({
              tenant_key: tenantKey,
              companies: discoveredCompanies,
              active_company: nextActive,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'tenant_key' });
            if (!activeCompany) activeCompany = nextActive;
          } catch (dbErr) {
            discoveryError = dbErr instanceof Error ? dbErr.message : String(dbErr);
            if (!activeCompany) activeCompany = discoveredCompanies[0];
          }
        }
      } catch (err) {
        discoveryError = err instanceof Error ? err.message : String(err);
        // Discovery failure is non-fatal — fall back to cfg.company / empty.
      }
    }

    // Fast-bail: if the discovery probe aborted (Tally XML endpoint cold),
    // there's no point in plowing through 5+ more collection fetches that
    // will each also time out at 45-65s. Supabase's 150s hard wall would
    // kill the invocation before we return anything, so the client never
    // sees diagnostics. Instead, return immediately with everything marked
    // as "not attempted — Tally unreachable". The client / UI can then
    // render the portal-login skip reason, the real error, and suggest
    // actions (e.g. "click TallyPrime in the portal launcher").
    const discoveryAborted = discoveryError && /aborted|timeout|fetch failed|network error|connection/i.test(discoveryError);
    if (discoveryAborted) {
      const errors: Record<string, string> = {};
      const data: Record<string, unknown> = {};
      const counts: Record<string, number> = {};
      for (const key of ['ledgers', 'accountingGroups', 'stockItems', 'stockGroups', 'salesVouchers', 'receiptVouchers']) {
        data[key] = null;
        counts[key] = 0;
        errors[key] = 'Skipped — Tally XML endpoint unreachable (discovery probe aborted).';
      }
      return new Response(JSON.stringify({
        connected: false,
        action,
        counts,
        data,
        errors,
        error: `Tally XML endpoint did not respond. Make sure Tally is running and :${cfg.host.split(':')[1] || '9000'} is reachable.`,
        collectionMeta: {},
        skipped: {},
        fetched: [],
        activeCompany,
        discoveredCompanies,
        discoveryError,
        discoveryRawSample: null,
        diagnostics: diagSnapshot,
      }), { headers: jsonHeaders });
    }

    // Build the job list after company discovery so every query's
    // SVCURRENTCOMPANY points at the resolved activeCompany.
    const queryCfg = { ...cfg, company: activeCompany };
    // Day Book is split into per-year chunks so each fetch's parse tree
    // stays small enough that `tree + JSON.stringify(tree)` during the
    // merge-RPC send fits under Supabase's 150 MB compute cap. A 5-year
    // Voucher feed: Tally's pre-compiled Sales / Purchase / Receipt registers
    // are the only voucher source — Day Book and the custom Voucher
    // COLLECTION are gone (both OOM'd this 150 MB Edge Function isolate or
    // crashed Tally with c0000005 on real distributor datasets). Each
    // register is bounded by the configured voucher window via reportWith-
    // VoucherDates, so peak memory stays predictable.
    const allJobs = [
      // Reliable small collections first. Voucher failures on this tunnel
      // historically burned their whole timeout before erroring, chewing
      // the wall-clock budget and forcing stocks to abort on retries.
      { key: 'ledgers' as const, xml: sundryDebtorsRequest(queryCfg), node: 'LEDGER', timeoutMs: 65000 },
      // accountingGroups is small (~500 rows for a typical distributor),
      // cheap to fetch, and required for the transformer's ancestor-chain
      // walk when ledgers are sub-grouped by city/region under Sundry Debtors.
      { key: 'accountingGroups' as const, xml: accountingGroupsRequest(queryCfg), node: 'GROUP', timeoutMs: 15000 },
      { key: 'stockItems' as const, xml: stockItemsRequest(queryCfg), node: 'STOCKITEM', timeoutMs: 20000 },
      { key: 'stockGroups' as const, xml: stockGroupsRequest(queryCfg), node: 'STOCKGROUP', timeoutMs: 12000 },
      // Financial statements — small (group-level tree, not per-voucher),
      // run before the heavy voucher registers so they never get starved by
      // wall-clock exhaustion. P&L + BS together are ~20-40 KB for most tenants.
      { key: 'profitLoss' as const, xml: profitLossRequest(queryCfg), node: 'DSPACCNAME', timeoutMs: 15000 },
      { key: 'balanceSheet' as const, xml: balanceSheetRequest(queryCfg), node: 'DSPACCNAME', timeoutMs: 15000 },
      { key: 'trialBalance' as const, xml: trialBalanceRequest(queryCfg), node: 'DSPACCNAME', timeoutMs: 18000 },
      { key: 'salesRegister' as const, xml: salesRegisterRequest(queryCfg), node: 'VOUCHER', timeoutMs: 90000 },
      { key: 'purchaseRegister' as const, xml: purchaseRegisterRequest(queryCfg), node: 'VOUCHER', timeoutMs: 90000 },
      { key: 'receiptRegister' as const, xml: receiptRegisterRequest(queryCfg), node: 'VOUCHER', timeoutMs: 90000 },
      { key: 'billsOutstanding' as const, xml: billsOutstandingRequest(queryCfg), node: 'BILLFIXED', timeoutMs: 60000 },
    ];

    const skipped: Record<string, { reason: string; updatedAt: string }> = {};
    let jobs = allJobs;
    let existingMeta: Record<string, { updated_at?: string; error?: string | null }> = {};
    if (db && skipFresh) {
      const { data: existing } = await db
        .from('tally_snapshots')
        .select('collection_meta')
        .eq('tenant_key', tenantKey)
        .eq('company', activeCompany)
        .maybeSingle();
      existingMeta = (existing?.collection_meta as typeof existingMeta) || {};
      const now = Date.now();
      jobs = allJobs.filter((j) => {
        const meta = existingMeta[j.key];
        if (!meta?.updated_at || meta.error) return true;
        const ageMs = now - new Date(meta.updated_at).getTime();
        const ttl = ttlForKey(j.key);
        if (ageMs < ttl) {
          skipped[j.key] = { reason: `fresh (${Math.round(ageMs / 60_000)} min old, ttl ${Math.round(ttl / 60_000)} min)`, updatedAt: meta.updated_at };
          return false;
        }
        return true;
      });
    }

    const deadline = Date.now() + 140000;
    // Heavy jobs (the voucher registers) are persisted then dropped from
    // the response payload — keeping every parse tree resident at once
    // blew the 150 MB Edge Function compute cap on real distributor
    // datasets. The client reads vouchers back via get-snapshot when a
    // dashboard mounts.
    const HEAVY_KEYS = new Set<string>(['salesRegister', 'purchaseRegister', 'receiptRegister']);
    const data: Record<string, unknown> = {};
    const counts: Record<string, number> = {};
    const errors: Record<string, string> = {};
    let anyConnected = false;
    let first = true;
    for (const job of jobs) {
      // Cooldown between calls. Observed behaviour: after a big response
      // (3000+ ledgers) the tunnel refuses the next 2-3 connections for
      // several seconds. 1.5s wasn't enough; 4s lets it fully flush before
      // the next POST. Skipped on the first job and when budget is tight.
      if (!first && deadline - Date.now() > 10000) {
        await new Promise((r) => setTimeout(r, 4000));
      }
      first = false;
      const budget = deadline - Date.now();
      if (budget <= 1000) {
        counts[job.key] = 0;
        errors[job.key] = 'Skipped — wall-clock budget exhausted by earlier queries';
        continue;
      }
      const timeout = Math.min(job.timeoutMs, budget);
      let result: unknown;
      let lastErr: unknown;
      // One retry on connection-reset-class failures. Doesn't apply to auth
      // errors or 4xx/5xx — only to TCP resets and timed-out reads, which
      // flaky tunnels tend to produce on the 2nd+ connection.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          result = await tallyRequest(job.xml, cfg, Math.max(5000, Math.floor(timeout / (2 - attempt))));
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const wasReset = /reset by peer|ECONNRESET/i.test(msg);
          const retriable = wasReset || /network error|signal has been aborted|fetch failed/i.test(msg);
          if (!retriable || deadline - Date.now() < 5000) break;
          await new Promise((r) => setTimeout(r, wasReset ? 8000 : 2000));
        }
      }
      if (lastErr) {
        counts[job.key] = 0;
        const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        errors[job.key] = errMsg;
      } else {
        counts[job.key] = countNode(result, job.node);
        anyConnected = true;
        if (db) {
          const persistErr = await persistSnapshotKey(db, tenantKey, activeCompany, job.key, result, counts[job.key]);
          if (persistErr) {
            errors['__persist__'] = `Failed to persist ${job.key}: ${persistErr}`;
          }
        }
        if (!HEAVY_KEYS.has(job.key)) {
          data[job.key] = result;
        }
        result = null;
      }
    }

    // Read back just counts / errors / collection_meta. Deliberately NOT
    // pulling `data` — it's been populated collection-by-collection already
    // and the client reads it via get-snapshot when a dashboard mounts.
    // Hauling the full `data` JSONB back into Deno memory here is what put
    // us right back over the compute cap.
    let mergedResponse: {
      counts: Record<string, number>;
      errors: Record<string, string>;
      collectionMeta: Record<string, unknown>;
    } | null = null;
    if (db && (anyConnected || Object.keys(errors).length)) {
      if (Object.keys(errors).length) {
        // Errors-only flush via a dedicated RPC so we never pull `data`
        // back into Deno memory at the tail of the run. mergeSnapshotInto
        // Table would SELECT data here too and undo the memory savings
        // from the per-job merge RPC above. Same fallback as
        // persistSnapshotKey — if the RPC is missing from the schema
        // cache (migration not applied), UPSERT the errors map
        // directly so the next sync run sees which collections
        // previously errored.
        const { error: recErr } = await db.rpc('record_tally_snapshot_errors', {
          p_tenant_key: tenantKey,
          p_company: activeCompany,
          p_errors: errors,
          p_source: 'sync-full',
        });
        if (recErr && /schema cache|Could not find the function|does not exist/i.test(recErr.message || String(recErr))) {
          const nowIso = new Date().toISOString();
          const { data: existing } = await db
            .from('tally_snapshots')
            .select('errors, collection_meta')
            .eq('tenant_key', tenantKey)
            .eq('company', activeCompany)
            .maybeSingle();
          const nextMeta: Record<string, { updated_at?: string; error?: string | null }> = {
            ...((existing?.collection_meta as Record<string, { updated_at?: string; error?: string | null }>) || {}),
          };
          for (const [k, v] of Object.entries(errors)) {
            nextMeta[k] = { ...(nextMeta[k] || {}), error: v };
          }
          await db.from('tally_snapshots').upsert({
            tenant_key: tenantKey,
            company: activeCompany,
            errors: { ...((existing?.errors as Record<string, string>) || {}), ...errors },
            collection_meta: nextMeta,
            source: 'sync-full',
            updated_at: nowIso,
          }, { onConflict: 'tenant_key,company' });
        }
      }
      const { data: row } = await db
        .from('tally_snapshots')
        .select('counts, errors, collection_meta')
        .eq('tenant_key', tenantKey)
        .eq('company', activeCompany)
        .maybeSingle();
      if (row) {
        mergedResponse = {
          counts: (row.counts || {}) as Record<string, number>,
          errors: (row.errors || {}) as Record<string, string>,
          collectionMeta: (row.collection_meta || {}) as Record<string, unknown>,
        };
      }
    }

    const responseCounts = mergedResponse?.counts ?? counts;
    const responseErrors = mergedResponse?.errors ?? errors;
    const responseSkipped = skipped;
    const responseFetched = jobs.map((j) => j.key);

    return new Response(JSON.stringify({
      connected: anyConnected,
      action,
      edgeBuildId: EDGE_BUILD_ID,
      counts: responseCounts,
      data,
      errors: responseErrors,
      collectionMeta: mergedResponse?.collectionMeta ?? {},
      skipped: responseSkipped,
      fetched: responseFetched,
      activeCompany,
      discoveredCompanies,
      discoveryError,
      discoveryRawSample: (discoveredCompanies.length === 0 && !discoveryError) ? discoveryRawSample : null,
      // Per-invocation diagnostics so the client progress panel can announce
      // "Portal session revived via auto-login" when the hb.exe cp retry
      // kicked in.
      diagnostics: snapshotDiagnostics(),
    }), { headers: jsonHeaders });
  }

  // sync-collection: fetch + persist ONE named collection in a fresh
  // Edge Function isolate so each register / master-data fetch gets its
  // own 150 s wall clock and 150 MB compute budget instead of sharing
  // sync-full's single pool. The client orchestrates one sync-collection
  // call per phase (see CORE_SYNC_PHASES on the client) so a per-phase
  // failure no longer cascades into "budget exhausted" on the rest.
  //
  // Body: { action: 'sync-collection', key: 'salesRegister' | 'ledgers' | ...,
  //         company, ...creds, allData?, fromDate?, toDate? }
  // Returns: { connected, action, key, count, error, source, company }
  if (action === 'sync-collection') {
    const dbUrl = Deno.env.get('SUPABASE_URL') || '';
    const dbRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const db = (dbUrl && dbRole) ? createClient(dbUrl, dbRole, { auth: { persistSession: false } }) : null;
    if (!db) {
      return new Response(JSON.stringify({
        connected: false, action,
        error: 'Supabase service role not configured — sync-collection requires it to persist the per-collection result.',
      }), { headers: jsonHeaders });
    }
    const key = String(body.key || '').trim();
    if (!key) {
      return new Response(JSON.stringify({
        connected: false, action,
        error: 'Missing "key" field for action="sync-collection" (e.g. "ledgers", "salesRegister").',
      }), { status: 400, headers: jsonHeaders });
    }
    const target = cfg.company || company || '';
    if (!target) {
      return new Response(JSON.stringify({
        connected: false, action, key,
        error: 'Missing company for action="sync-collection" — pass `company` in the body.',
      }), { status: 400, headers: jsonHeaders });
    }
    const queryCfg = { ...cfg, company: target };
    const job = buildCollectionJob(key, queryCfg);
    if (!job) {
      return new Response(JSON.stringify({
        connected: false, action, key,
        error: `Unknown collection key "${key}". Expected one of: ledgers, accountingGroups, stockItems, stockGroups, profitLoss, balanceSheet, trialBalance, salesRegister, purchaseRegister, receiptRegister, billsOutstanding.`,
      }), { status: 400, headers: jsonHeaders });
    }
    let result: unknown;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await tallyRequest(job.xml, cfg, Math.max(15000, Math.floor(job.timeoutMs / (2 - attempt))));
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const wasReset = /reset by peer|ECONNRESET/i.test(msg);
        const retriable = wasReset || /network error|signal has been aborted|fetch failed/i.test(msg);
        if (!retriable) break;
        await new Promise((r) => setTimeout(r, wasReset ? 8000 : 2000));
      }
    }
    if (lastErr) {
      const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      const { error: recErr } = await db.rpc('record_tally_snapshot_errors', {
        p_tenant_key: tenantKey,
        p_company: target,
        p_errors: { [key]: errMsg },
        p_source: 'sync-collection',
      });
      if (recErr && /schema cache|Could not find the function|does not exist/i.test(recErr.message || String(recErr))) {
        const nowIso = new Date().toISOString();
        const { data: existing } = await db
          .from('tally_snapshots')
          .select('errors, collection_meta')
          .eq('tenant_key', tenantKey)
          .eq('company', target)
          .maybeSingle();
        const nextMeta = {
          ...((existing?.collection_meta as Record<string, { updated_at?: string; error?: string | null }>) || {}),
          [key]: { error: errMsg },
        };
        await db.from('tally_snapshots').upsert({
          tenant_key: tenantKey,
          company: target,
          errors: { ...((existing?.errors as Record<string, string>) || {}), [key]: errMsg },
          collection_meta: nextMeta,
          source: 'sync-collection',
          updated_at: nowIso,
        }, { onConflict: 'tenant_key,company' });
      }
      return new Response(JSON.stringify({
        connected: false, action, key, company: target,
        count: 0, error: errMsg, edgeBuildId: EDGE_BUILD_ID,
        diagnostics: snapshotDiagnostics(),
      }), { headers: jsonHeaders });
    }
    const count = countNode(result, job.node);
    const persistErr = await persistSnapshotKey(db, tenantKey, target, key, result, count);
    return new Response(JSON.stringify({
      connected: true, action, key, company: target,
      count, error: persistErr, source: 'sync-collection',
      edgeBuildId: EDGE_BUILD_ID,
      diagnostics: snapshotDiagnostics(),
    }), { headers: jsonHeaders });
  }

  let xml: string;
  if (action === 'test') {
    xml = reportRequest('List of Companies', cfg.company);
  } else if (action === 'sync') {
    xml = sundryDebtorsRequest(cfg);
  } else if (action === 'request') {
    if (!body.xml || typeof body.xml !== 'string') {
      return new Response(JSON.stringify({ connected: false, error: 'Missing "xml" field for action="request"' }), {
        status: 400, headers: jsonHeaders,
      });
    }
    xml = body.xml;
  } else {
    return new Response(JSON.stringify({ connected: false, error: `Unknown action: ${action}` }), {
      status: 400, headers: jsonHeaders,
    });
  }

  // Tally-level failures (can't reach, auth, timeout) return HTTP 200 with
  // { connected: false, error }. This keeps supabase.functions.invoke() happy
  // so the browser can surface the actual message instead of a generic
  // "Edge Function returned a non-2xx status code".
  try {
    const result = await tallyRequest(xml, cfg);
    const counts = countRecords(result);
    return new Response(JSON.stringify({
      connected: true, action, counts, data: result,
      diagnostics: snapshotDiagnostics(),
    }), { headers: jsonHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({
      connected: false, action, error: message,
      diagnostics: snapshotDiagnostics(),
    }), { headers: jsonHeaders });
  }
});
