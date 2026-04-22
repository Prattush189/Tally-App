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
  username?: string;
  password?: string;
  company?: string;
  fromDate?: string;  // Tally format: YYYYMMDD (e.g. 20250401)
  toDate?: string;
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
    'LEDGER', 'VOUCHER', 'STOCKITEM', 'STOCKGROUP', 'BILL', 'BODY', 'COLLECTION',
    'ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST',
    'ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST',
    'BILLALLOCATIONS.LIST', 'BATCHALLOCATIONS.LIST',
  ].includes(name),
});

function resolveConfig(overrides: TallyConfig): Required<TallyConfig> {
  const host = overrides.host || Deno.env.get('TALLY_HOST') || '';
  const username = overrides.username ?? Deno.env.get('TALLY_USERNAME') ?? '';
  const password = overrides.password ?? Deno.env.get('TALLY_PASSWORD') ?? '';
  const company = overrides.company || Deno.env.get('TALLY_COMPANY') || '';
  const fromDate = overrides.fromDate || '';
  const toDate = overrides.toDate || '';
  return { host, username, password, company, fromDate, toDate };
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
function voucherDateFilter(cfg: { fromDate: string; toDate: string }) {
  if (cfg.fromDate || cfg.toDate) return dateFilter(cfg);
  const d = new Date();
  const to = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  d.setDate(d.getDate() - 90);
  const from = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `<SVFROMDATE Type="Date">${from}</SVFROMDATE><SVTODATE Type="Date">${to}</SVTODATE>`;
}

// Accept either a bare "host" / "host:port" or a full URL ("https://host:port/path").
// Falls back to http://<host> when no scheme is provided.
function buildTallyUrl(host: string): string {
  const trimmed = host.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

async function tallyRequest(xml: string, cfg: Required<TallyConfig>, timeoutMs = 120000) {
  if (!cfg.host) throw new Error('Tally host not configured. Provide "host" in the request body or set TALLY_HOST secret.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/xml' };
    if (cfg.username && cfg.password) {
      headers['Authorization'] = 'Basic ' + btoa(`${cfg.username}:${cfg.password}`);
    }
    const url = buildTallyUrl(cfg.host);
    const res = await fetch(url, {
      method: 'POST', headers, body: xml, signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Tally authentication failed (${res.status}). Check username/password.`);
    }
    if (!res.ok) throw new Error(`Tally returned HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();
    return parser.parse(text);
  } finally {
    clearTimeout(timer);
  }
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

// Sales vouchers — line items included (AllInventoryEntries) so the client
// transformer can derive SKU / category penetration per dealer. Filter to
// VoucherType = Sales (or nested under) via a formula system, the way the
// Express connector does it. Heavier than the ledger query; bumped timeout.
function salesVouchersRequest(cfg: { company: string; fromDate: string; toDate: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>B2BIntelSales</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
        ${voucherDateFilter(cfg)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="B2BIntelSales" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FILTERS>IsSalesVoucher</FILTERS>
            <NATIVEMETHOD>Date</NATIVEMETHOD>
            <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
            <NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
            <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
            <NATIVEMETHOD>Amount</NATIVEMETHOD>
            <NATIVEMETHOD>AllLedgerEntries</NATIVEMETHOD>
            <NATIVEMETHOD>AllInventoryEntries</NATIVEMETHOD>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsSalesVoucher">$$IsSales:$VoucherTypeName</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// Receipt vouchers — BillAllocations included so we can derive DSO and
// on-time/late payment history per bill.
function receiptVouchersRequest(cfg: { company: string; fromDate: string; toDate: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>B2BIntelReceipts</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
        ${voucherDateFilter(cfg)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="B2BIntelReceipts" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FILTERS>IsReceiptVoucher</FILTERS>
            <NATIVEMETHOD>Date</NATIVEMETHOD>
            <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
            <NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
            <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
            <NATIVEMETHOD>Amount</NATIVEMETHOD>
            <NATIVEMETHOD>AllLedgerEntries</NATIVEMETHOD>
            <NATIVEMETHOD>BillAllocations</NATIVEMETHOD>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsReceiptVoucher">$$IsReceipt:$VoucherTypeName</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// Stock items — SKU master. Parent / Category build the category lookup used
// for SKU and category penetration on the dealer side.
function stockItemsRequest(cfg: { company: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>B2BIntelStockItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
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
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// Stock groups — category master used as denominator for catPenetration.
function stockGroupsRequest(cfg: { company: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>B2BIntelStockGroups</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="B2BIntelStockGroups" ISMODIFY="No">
            <TYPE>StockGroup</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// Sync query — custom TDL collection with explicit NATIVEMETHOD per field.
// Tally honours NATIVEMETHOD reliably across versions; <FETCHLIST> is not
// always respected on a bare built-in collection. Filter to Sundry Debtors
// happens client-side so we don't trigger the heavier UNDER-clause query
// that drops the connection on shared hosts.
function sundryDebtorsRequest(cfg: { company: string; fromDate: string; toDate: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>B2BIntelLedgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(cfg.company)}
        ${dateFilter(cfg)}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
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
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

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

  // Snapshot + portal-config actions. These are for the scheduled GitHub
  // Actions sync (get-config + ingest), the web dashboards reading the most
  // recent persisted snapshot (get-snapshot), and admins saving / triggering
  // syncs from the UI (save-config + trigger-sync + get-status).
  const dbActions = new Set([
    'get-config', 'save-config', 'ingest', 'get-snapshot', 'get-status', 'trigger-sync',
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
    const gatedActions = new Set(['get-config', 'save-config', 'ingest', 'trigger-sync']);
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
      const { data: snap } = await db
        .from('tally_snapshots')
        .select('counts, errors, source, updated_at')
        .eq('tenant_key', tenantKey)
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
      // Two shapes accepted:
      //   1. body.data = { ledgers: {...parsed...}, salesVouchers: {...}, ... }
      //      (what the Playwright local tool sends — already parsed.)
      //   2. body.rawXml = { ledgers: '<ENVELOPE>...</ENVELOPE>', ... }
      //      (what the Chrome extension sends — parsed server-side so the
      //      extension stays free of XML-parser dependencies.)
      let data = body.data;
      let counts = (body.counts && typeof body.counts === 'object') ? { ...body.counts } : {};
      const errors = (body.errors && typeof body.errors === 'object') ? { ...body.errors } : {};
      if (body.rawXml && typeof body.rawXml === 'object') {
        const nodePerKey: Record<string, string> = {
          ledgers: 'LEDGER',
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
        return new Response(JSON.stringify({
          connected: false,
          error: 'ingest requires a "data" object or "rawXml" string map',
        }), { status: 400, headers: jsonHeaders });
      }
      const source = (body.source as string) || 'local-playwright';
      const { error } = await db.from('tally_snapshots').upsert({
        tenant_key: tenantKey,
        data,
        counts,
        errors,
        source,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_key' });
      if (error) {
        return new Response(JSON.stringify({
          connected: false,
          error: `Failed to persist snapshot: ${error.message}`,
        }), { status: 500, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({ connected: true, action, tenantKey, counts, errors }), { headers: jsonHeaders });
    }

    // get-snapshot
    const { data: row, error } = await db
      .from('tally_snapshots')
      .select('data, counts, errors, source, updated_at')
      .eq('tenant_key', tenantKey)
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
    }), { headers: jsonHeaders });
  }

  if (action === 'sync-full') {
    // Serial, not parallel. Shared-host Tally tunnels (ngrok free, cloudflare
    // quick tunnels, etc.) often only allow 1-2 concurrent connections; 5 at
    // once is what makes them drop the whole session. Trade faster wall clock
    // for reliability.
    //
    // Cumulative deadline of ~130s keeps us under Supabase's 150s function
    // timeout. If we blow the budget we stop queuing further jobs and return
    // what we have, with the skipped ones marked as errors.
    const jobs = [
      // Per-job timeouts reflect observed response sizes on the hosted tunnel.
      // Ledger master dump is the heaviest (3000+ rows seen) so it gets the
      // biggest slice. Vouchers come second; stock masters are small.
      // 65 + 45 + 35 + 15 + 10 + 4 × 1.5s cooldowns ≈ 176s worst-case, but
      // the wall-clock deadline below ensures we always return within
      // Supabase's 150s function limit even if every retry fires.
      { key: 'ledgers' as const, xml: sundryDebtorsRequest(cfg), node: 'LEDGER', timeoutMs: 65000 },
      { key: 'salesVouchers' as const, xml: salesVouchersRequest(cfg), node: 'VOUCHER', timeoutMs: 45000 },
      { key: 'receiptVouchers' as const, xml: receiptVouchersRequest(cfg), node: 'VOUCHER', timeoutMs: 35000 },
      { key: 'stockItems' as const, xml: stockItemsRequest(cfg), node: 'STOCKITEM', timeoutMs: 15000 },
      { key: 'stockGroups' as const, xml: stockGroupsRequest(cfg), node: 'STOCKGROUP', timeoutMs: 10000 },
    ];
    const deadline = Date.now() + 140000;
    const data: Record<string, unknown> = {};
    const counts: Record<string, number> = {};
    const errors: Record<string, string> = {};
    let anyConnected = false;
    let first = true;
    for (const job of jobs) {
      // Cooldown between calls. Some upstream boxes (captive-portal gated
      // tunnels, single-connection forwarders) reset the socket on the very
      // next connection; a short pause lets them settle. Skip on the first
      // job and when the budget is already tight.
      if (!first && deadline - Date.now() > 5000) {
        await new Promise((r) => setTimeout(r, 1500));
      }
      first = false;
      const budget = deadline - Date.now();
      if (budget <= 1000) {
        data[job.key] = null;
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
          const retriable = /reset by peer|ECONNRESET|network error|signal has been aborted|fetch failed/i.test(msg);
          if (!retriable || deadline - Date.now() < 5000) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (lastErr) {
        data[job.key] = null;
        counts[job.key] = 0;
        errors[job.key] = lastErr instanceof Error ? lastErr.message : String(lastErr);
      } else {
        data[job.key] = result;
        counts[job.key] = countNode(result, job.node);
        anyConnected = true;
      }
    }
    return new Response(JSON.stringify({
      connected: anyConnected,
      action,
      counts,
      data,
      errors,
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
    return new Response(JSON.stringify({ connected: true, action, counts, data: result }), {
      headers: jsonHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ connected: false, action, error: message }), {
      headers: jsonHeaders,
    });
  }
});
