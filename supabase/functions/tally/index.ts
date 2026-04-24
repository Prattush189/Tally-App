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
  username?: string;          // Tally XML Basic Auth user (may equal portalUsername)
  password?: string;          // Tally XML Basic Auth password
  // Portal creds are OPTIONAL and used only for the hb.exe cp auto-login
  // fallback. They're often different from the XML user — the hosted-Tally
  // portal login uses a HOB RemoteApp account ("unitsd5") while the XML
  // server accepts a separate per-company user ("UNITED5"). We accept both
  // and fall back to the XML pair when the portal pair isn't supplied.
  portalUsername?: string;
  portalPassword?: string;
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
  const username = nonEmpty(overrides.username) || Deno.env.get('TALLY_USERNAME') || '';
  const password = (typeof overrides.password === 'string' && overrides.password) || Deno.env.get('TALLY_PASSWORD') || '';
  // Portal creds fall back to the XML creds ONLY when dedicated portal
  // fields + env overrides are both blank. If a separate portal login is
  // needed (most hosted-Tally tunnels — portal user != XML user), fill
  // the Portal Username / Portal Password fields in the TallySync UI.
  const portalUsername = nonEmpty(overrides.portalUsername) || Deno.env.get('TALLY_PORTAL_USER') || username;
  const portalPassword = (typeof overrides.portalPassword === 'string' && overrides.portalPassword)
    || Deno.env.get('TALLY_PORTAL_PASS') || password;
  const company = nonEmpty(overrides.company) || Deno.env.get('TALLY_COMPANY') || '';
  const fromDate = nonEmpty(overrides.fromDate) || '';
  const toDate = nonEmpty(overrides.toDate) || '';
  const allData = overrides.allData === true;
  return { host, username, password, portalUsername, portalPassword, company, fromDate, toDate, allData };
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
    // 5 years is the sweet spot: covers practically every B2B business's
    // historical window worth looking at. Day Book now fetches per-year
    // chunks (see dayBookYearChunks) so the 5-year total is split across
    // five small fetches — each one's parse tree + JSON serialization
    // stays well under Supabase's 150 MB Edge Function compute cap,
    // whereas parsing all five years in one call blew past it.
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

// Split the configured voucher window into calendar-year chunks. Day Book
// for heavy B2B tenants spans 5+ years and tens of thousands of vouchers;
// one monolithic fetch's parse tree + its JSON serialization for the
// merge RPC roughly doubles peak Deno memory and busts Supabase's 150 MB
// compute cap. Fetching per-year bounds peak memory to one year's tree
// (~1/5 the size) which comfortably fits the budget.
//
// Returns [{from, to, key}] where `key` is the per-year storage sub-key
// under tally_snapshots.data (e.g. "dayBook_2023"). When the window is a
// sub-year (the default 90-day range), we emit a single chunk under the
// canonical "dayBook" key to stay byte-compatible with the legacy shape.
function dayBookYearChunks(cfg: { fromDate: string; toDate: string; allData?: boolean }): Array<{ from: string; to: string; key: string }> {
  const [from, to] = resolveVoucherWindow(cfg);
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear) || toYear < fromYear) {
    return [{ from, to, key: 'dayBook' }];
  }
  if (toYear === fromYear) {
    // Sub-year windows (90-day default) don't need chunking — one fetch,
    // legacy key so existing snapshots keep working.
    return [{ from, to, key: 'dayBook' }];
  }
  const chunks: Array<{ from: string; to: string; key: string }> = [];
  for (let y = fromYear; y <= toYear; y++) {
    const yFrom = y === fromYear ? from : `${y}0101`;
    const yTo = y === toYear ? to : `${y}1231`;
    chunks.push({ from: yFrom, to: yTo, key: `dayBook_${y}` });
  }
  return chunks;
}

// Accept either a bare "host" / "host:port" or a full URL ("https://host:port/path").
// Falls back to http://<host> when no scheme is provided.
function buildTallyUrl(host: string): string {
  const trimmed = host.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

// Deduce the HOB portal login URL from a Tally host. "103.76.213.243:9007"
// → "https://103.76.213.243/". The portal serves the login form over HTTPS
// on port 443 regardless of which port Tally's XML server listens on.
function portalBaseFromHost(host: string): string | null {
  if (!host) return null;
  const trimmed = host.trim();
  const urlMatch = trimmed.match(/^https?:\/\/([^/:]+)/i);
  const hostname = urlMatch ? urlMatch[1] : trimmed.split(':')[0];
  if (!hostname) return null;
  // IP-address portals we know (like the shared HOB RemoteApp tunnel) serve
  // the login at https://<host>/. If this doesn't match a user's deployment
  // they can override via TALLY_PORTAL_URL env / portal_url in config.
  return `https://${hostname}/`;
}

// Attempt portal login via POST /cgi-bin/hb.exe with action=cp. HOB
// RemoteApp's login form accepts URL-encoded form data and returns
// {"Status":"ok"} on success along with Set-Cookie session headers. We
// don't need to keep the cookies — the portal starts Tally's XML server
// on :9007 as a side-effect of a successful login — but on subsequent
// calls we DO forward the cookies in case a future portal update starts
// requiring them.
async function portalLogin(host: string, username: string, password: string, timeoutMs = 15000): Promise<{ ok: boolean; error?: string; cookies?: string[]; status?: number; bodySample?: string }> {
  const base = portalBaseFromHost(host);
  if (!base) return { ok: false, error: 'Could not derive portal URL from host.' };
  if (!username || !password) return { ok: false, error: 'Portal username or password is blank.' };

  const hostname = new URL(base).hostname;
  const body = new URLSearchParams({
    action: 'cp',
    l: username,
    p: password,
    d: '',
    f: '',
    t: String(Date.now()),
  }).toString();

  // Try HTTPS first, then HTTP. HOB RemoteApp portals typically listen on
  // both :443 and :80. We hit HTTPS to mirror what Chrome does, but fall
  // back to HTTP when Deno's rustls rejects the portal cert — which is
  // what happens at 103.76.213.243 (cert uses an older format Deno flags
  // as UnsupportedCertVersion; Chrome accepts it with a warning). Using
  // HTTP is fine here: we're on Supabase's server-to-server network, not
  // going through a user's browser, so there's no user-visible mixed
  // content or MITM exposure that wouldn't already exist with the
  // rejected cert anyway.
  const attempts: Array<{ scheme: 'https' | 'http'; url: string }> = [
    { scheme: 'https', url: `https://${hostname}/cgi-bin/hb.exe` },
    { scheme: 'http', url: `http://${hostname}/cgi-bin/hb.exe` },
  ];

  let lastErr = '';
  for (const attempt of attempts) {
    const origin = `${attempt.scheme}://${hostname}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': origin,
          'Referer': `${origin}/`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      const bodySample = text.slice(0, 200);
      if (!res.ok) {
        lastErr = `${attempt.scheme.toUpperCase()} HTTP ${res.status}: ${bodySample}`;
        continue;
      }
      if (!/"status"\s*:\s*"ok"|^\s*ok\s*$/i.test(text)) {
        lastErr = `${attempt.scheme.toUpperCase()} portal rejected login — body: ${bodySample}`;
        continue;
      }
      const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      return { ok: true, status: res.status, cookies, bodySample };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = `${attempt.scheme.toUpperCase()} ${msg}`;
      // Cert errors specifically → keep going to the HTTP fallback. Other
      // errors also fall through so the user sees the most informative
      // failure at the end.
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: `Portal login failed over both HTTPS and HTTP. Last error: ${lastErr}` };
}

// Per-invocation state. Previously `portalLoggedInForHost` lived at module
// scope and stuck across warm invocations — meaning the second Sync press
// on a warm instance would skip portal login even though the RemoteApp
// session had timed out in between. Now it resets at the top of every
// Deno.serve handler so each Sync starts fresh. Within a single
// invocation, we still only log in once (even if ensurePortalLogin is
// called from 6 different collection queries).
type RequestDiagnostics = {
  portalLoginAttempted: boolean;
  portalLoginOk: boolean;
  portalLoginError: string | null;
  // Explain why the step didn't fire, so the UI can show it instead of
  // silently hiding the row. Filled only when attempted is false.
  portalLoginSkippedReason: string | null;
};
let currentDiagnostics: RequestDiagnostics = {
  portalLoginAttempted: false,
  portalLoginOk: false,
  portalLoginError: null,
  portalLoginSkippedReason: null,
};
let portalLoggedInForHost = new Set<string>();

async function tallyRequest(xml: string, cfg: Required<TallyConfig>, timeoutMs = 120000) {
  if (!cfg.host) throw new Error('Tally host not configured. Provide "host" in the request body or set TALLY_HOST secret.');

  // Reactive-only portal login. We used to call ensurePortalLogin before
  // every XML request (proactive), but that wasted 10s on every cold
  // invocation even when :9007 was already reachable. Users who open the
  // port themselves don't need portal login at all. Now: just try the XML
  // call directly, and fall back to portal-login-then-retry only if the
  // call fails with a connection-level error. Saves 10s+ on the happy
  // path; still recovers when the session has idled out.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/xml' };
    if (cfg.username && cfg.password) {
      headers['Authorization'] = 'Basic ' + btoa(`${cfg.username}:${cfg.password}`);
    }
    const url = buildTallyUrl(cfg.host);
    const doFetch = () => fetch(url, {
      method: 'POST', headers, body: xml, signal: controller.signal,
    });
    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      // Connection-level failure. If portal creds are configured and we
      // haven't logged in this invocation, run portal login then retry
      // the XML call once.
      const msg = err instanceof Error ? err.message : String(err);
      const hasPortalCreds = Boolean(cfg.portalUsername && cfg.portalPassword);
      const shouldAuto = hasPortalCreds && !portalLoggedInForHost.has(cfg.host);
      if (!shouldAuto) throw err;
      currentDiagnostics.portalLoginAttempted = true;
      const login = await portalLogin(cfg.host, cfg.portalUsername, cfg.portalPassword);
      if (!login.ok) {
        currentDiagnostics.portalLoginError = login.error || 'unknown';
        throw new Error(`Tally unreachable and portal auto-login failed: ${login.error}. Original: ${msg}`);
      }
      currentDiagnostics.portalLoginOk = true;
      portalLoggedInForHost.add(cfg.host);
      // Longer warm-up wait on the retry path — the RemoteApp session
      // might still be spinning TallyPrime up. 10s has empirically been
      // enough when the portal session was active.
      await new Promise((r) => setTimeout(r, 10000));
      res = await doFetch();
    }
    if (res.status === 401 || res.status === 403) {
      const hasPortalCreds = Boolean(cfg.portalUsername && cfg.portalPassword);
      const shouldAuto = hasPortalCreds && !portalLoggedInForHost.has(cfg.host);
      if (shouldAuto) {
        currentDiagnostics.portalLoginAttempted = true;
        const login = await portalLogin(cfg.host, cfg.portalUsername, cfg.portalPassword);
        if (login.ok) {
          currentDiagnostics.portalLoginOk = true;
          portalLoggedInForHost.add(cfg.host);
          await new Promise((r) => setTimeout(r, 2000));
          res = await doFetch();
        } else {
          currentDiagnostics.portalLoginError = login.error || 'unknown';
        }
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Tally authentication failed (${res.status}). Check username/password.`);
      }
    }
    if (!res.ok) throw new Error(`Tally returned HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();
    return parser.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function resetDiagnostics(): void {
  currentDiagnostics = {
    portalLoginAttempted: false,
    portalLoginOk: false,
    portalLoginError: null,
    portalLoginSkippedReason: null,
  };
  // Clear the per-invocation "already logged in" set too — every fresh
  // Deno.serve handler should treat the portal session as unknown and
  // let the next Tally call drive ensurePortalLogin again.
  portalLoggedInForHost = new Set<string>();
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
// Sales / Receipt Register are type-specific Tally reports (shipped with
// every Prime version since forever). 'Day Book' returned EVERY voucher
// type in the window (contras, journals, purchases, sales, receipts),
// which on a 90-day default blew past the shared-host tunnel's payload
// ceiling → "Connection reset by peer". The type-specific reports are a
// fraction of the size (only one voucher type each), and — because sales
// and receipts no longer fire the same query back-to-back — the second
// call doesn't land while the tunnel is still flushing the first.
// Voucher fetch is a single Day Book call — see dayBookRequest below. The
// five type-specific registers (Sales/Receipt/Payment/Journal/Contra) used
// to run alongside it; they're gone now because they triple-counted the
// same rows in Deno worker memory and busted the Edge Function's compute
// budget. The transformer splits Day Book output by VOUCHERTYPENAME, which
// produces the same per-type arrays the dashboards consume.

// Custom lightweight voucher COLLECTION. The built-in Day Book report
// returns every voucher with its full line-item tree (ALLINVENTORYENTRIES,
// ALLLEDGERENTRIES, BILLALLOCATIONS, etc.) — for a 5-year distributor that
// balloons to 200+ MB of JSON, blowing the Edge Function's 150 MB memory
// cap even after per-job persist. This collection uses NATIVEMETHOD to
// return ONLY the fields the transformer actually reads: date, number,
// type, party, amount. Client splits by VOUCHERTYPENAME as before. Trade-
// off: no SKU-level line items, so the per-customer purchasedCategories
// / skuPenetration / catPenetration metrics degrade to zero. Revenue,
// aging, DSO, churn — everything that matters for the initial launch —
// still works because those only need the voucher header.
function dayBookRequest(cfg: { company: string; fromDate: string; toDate: string; allData?: boolean }) {
  return dayBookRequestForWindow(cfg.company, cfg.fromDate || '', cfg.toDate || '', cfg.allData === true);
}

// Per-year Day Book fetch. Mirrors dayBookRequest but forces an explicit
// from/to window so the yearly chunking loop can scope each call to one
// calendar year. The SVCURRENTPERIODFROM/TO pair is set to the same window
// so Tally doesn't silently snap back to the company's default FY.
function dayBookRequestForWindow(company: string, from: string, to: string, allData: boolean) {
  const dateFilter = (from || to)
    ? [
        from ? `<SVFROMDATE Type="Date">${from}</SVFROMDATE>` : '',
        to ? `<SVTODATE Type="Date">${to}</SVTODATE>` : '',
        from ? `<SVCURRENTPERIODFROM Type="Date">${from}</SVCURRENTPERIODFROM>` : '',
        to ? `<SVCURRENTPERIODTO Type="Date">${to}</SVCURRENTPERIODTO>` : '',
      ].join('')
    : voucherDateFilter({ fromDate: '', toDate: '', allData });
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>B2BIntelVouchers</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${companyFilter(company)}
      ${dateFilter}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="B2BIntelVouchers" ISMODIFY="No">
        <TYPE>Voucher</TYPE>
        <NATIVEMETHOD>Date</NATIVEMETHOD>
        <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
        <NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
        <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
        <NATIVEMETHOD>Amount</NATIVEMETHOD>
        <NATIVEMETHOD>Reference</NATIVEMETHOD>
        <NATIVEMETHOD>Narration</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

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
  dayBook: 10 * 60_000,
  stockItems: 30 * 60_000,
  stockGroups: 30 * 60_000,
  accountingGroups: 30 * 60_000,
  profitLoss: 15 * 60_000,
  balanceSheet: 15 * 60_000,
  trialBalance: 15 * 60_000,
};

// Per-year Day Book sub-keys (dayBook_2020, dayBook_2021, ...) use the
// same TTL as the canonical dayBook key — the year-level split is a
// server-side memory optimisation and shouldn't affect refresh cadence.
function ttlForKey(key: string): number {
  if (key.startsWith('dayBook_')) return COLLECTION_TTL_MS.dayBook;
  return COLLECTION_TTL_MS[key] ?? 30 * 60_000;
}

function isDayBookSubKey(key: string): boolean {
  return key === 'dayBook' || key.startsWith('dayBook_');
}

// Collapse dayBook / dayBook_YYYY keys into a single "dayBook" total so
// the UI and scheduler see one logical Day Book collection regardless of
// how many year-chunks the server actually fetched.
function rollupDayBook(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  let dayBookTotal = 0;
  let sawDayBook = false;
  for (const [k, v] of Object.entries(counts)) {
    if (isDayBookSubKey(k)) {
      dayBookTotal += Number(v) || 0;
      sawDayBook = true;
      continue;
    }
    out[k] = v;
  }
  if (sawDayBook) out.dayBook = dayBookTotal;
  return out;
}

function rollupDayBookErrors(errors: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const dayBookMsgs: string[] = [];
  for (const [k, v] of Object.entries(errors)) {
    if (isDayBookSubKey(k)) {
      const year = k === 'dayBook' ? null : k.replace('dayBook_', '');
      dayBookMsgs.push(year ? `${year}: ${v}` : String(v));
      continue;
    }
    out[k] = v;
  }
  if (dayBookMsgs.length) out.dayBook = dayBookMsgs.join('; ');
  return out;
}

function rollupDayBookSkipped(
  skipped: Record<string, { reason: string; updatedAt: string }>,
): Record<string, { reason: string; updatedAt: string }> {
  const out: Record<string, { reason: string; updatedAt: string }> = {};
  let latest: { reason: string; updatedAt: string } | null = null;
  let anyDayBook = false;
  for (const [k, v] of Object.entries(skipped)) {
    if (isDayBookSubKey(k)) {
      anyDayBook = true;
      if (!latest || new Date(v.updatedAt) > new Date(latest.updatedAt)) latest = v;
      continue;
    }
    out[k] = v;
  }
  if (anyDayBook && latest) {
    out.dayBook = { reason: `fresh (all year chunks) — ${latest.reason}`, updatedAt: latest.updatedAt };
  }
  return out;
}

function rollupDayBookList(keys: string[]): string[] {
  const out: string[] = [];
  let sawDayBook = false;
  for (const k of keys) {
    if (isDayBookSubKey(k)) { sawDayBook = true; continue; }
    out.push(k);
  }
  if (sawDayBook) out.push('dayBook');
  return out;
}

// Stamped into every sync-full / get-snapshot response so the client can
// tell which edge-function revision it's talking to. Bump manually when
// deploys need verification; the value is purely informational. Useful
// when diagnosing "is my fix live yet?" without digging into Actions logs.
const EDGE_BUILD_ID = '2026-04-24-daybook-yearly-chunks';

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
      const diagSnapshot = snapshotDiagnostics();
      const portalClue = diagSnapshot.portalLoginOk
        ? ' Portal auto-login succeeded, but :9007 is still not responding — TallyPrime is not running inside the RemoteApp session.'
        : diagSnapshot.portalLoginError
          ? ` Portal auto-login: ${diagSnapshot.portalLoginError}`
          : '';
      return new Response(JSON.stringify({
        connected: false,
        action,
        counts,
        data,
        errors,
        error: `Tally XML endpoint did not respond. Make sure Tally is running and :${cfg.host.split(':')[1] || '9000'} is reachable.${portalClue}`,
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
    // all-history run for a heavy distributor would otherwise parse 50-
    // 200 MB in one shot, and the *serialization* for the RPC body
    // doubles that transiently — exactly where earlier revisions still
    // hit "Function failed due to not having enough compute resources"
    // even after the server-side merge fix moved the jsonb || jsonb
    // merge into PostgreSQL. Yearly windows bound peak memory to one
    // year's tree, which comfortably fits.
    const dayBookChunks = dayBookYearChunks(queryCfg);
    const dayBookSubKeys = dayBookChunks.map((c) => c.key);
    const allJobs = [
      // Reliable small collections first, flaky voucher queries last. Voucher
      // failures on this tunnel historically burned their whole timeout
      // before erroring, chewing the wall-clock budget and forcing stocks
      // to abort on retries.
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
      // Day Book, fanned out across calendar years. Each chunk persists
      // to its own sub-key (dayBook_2021, dayBook_2022, ...); the client
      // transformer concatenates every dayBook* key on read, so the
      // downstream voucher-dedup / type-split logic keeps working
      // unchanged. A sub-year window (90-day default) collapses to a
      // single "dayBook" chunk to stay byte-compatible with legacy
      // snapshots already in storage.
      //
      // Per-chunk timeout is 30s rather than the old 75s monolith —
      // one year of lean vouchers is fast to produce, and a tighter
      // timeout frees wall-clock budget for retries.
      ...dayBookChunks.map((c) => ({
        key: c.key,
        xml: dayBookRequestForWindow(activeCompany, c.from, c.to, Boolean(cfg.allData)),
        node: 'VOUCHER',
        timeoutMs: 30000,
      })),
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
    // `data` still gets populated for response-side diagnostics (the client's
    // transformer runs against ledgers + accountingGroups to compute parent-
    // group stats) — BUT we deliberately skip the Day Book payload from this
    // in-memory map. Day Book dwarfs every other response (~50-200 MB parsed
    // for a 5-year distributor), and keeping it resident along with seven
    // other parse trees is what blew the Edge Function's compute cap. The
    // client reads vouchers back via get-snapshot, not the sync-full response.
    // Every Day Book shard (single-year or per-year) is heavy — the raw
    // parse tree can still be 10-40 MB per chunk, and keeping more than
    // one resident alongside the other collection trees would put us
    // right back over the compute cap.
    const HEAVY_KEYS = new Set<string>(['dayBook', ...dayBookSubKeys]);
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
      //
      // Reset-class errors ("reset by peer", "ECONNRESET") mean the tunnel
      // actively dropped the socket — it typically refuses new connections
      // for several seconds afterwards. 2s wasn't enough; 8s lets the
      // tunnel fully recover before the retry. Idle/abort errors ("signal
      // has been aborted", "fetch failed") don't suffer the same refusal
      // window, so a shorter wait is fine.
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
        errors[job.key] = lastErr instanceof Error ? lastErr.message : String(lastErr);
      } else {
        counts[job.key] = countNode(result, job.node);
        anyConnected = true;
        // Persist via a server-side JSONB merge RPC. Previously this called
        // mergeSnapshotIntoTable(), which does SELECT data + spread-copy +
        // UPSERT full row — meaning every per-job merge re-downloaded the
        // entire accumulating snapshot (including the tens-of-MB Day Book
        // once it had landed) and re-uploaded it. That re-download was the
        // real cause of the "Function failed due to not having enough
        // compute resources" error: peak memory ended up being the fresh
        // parse tree PLUS the full existing snapshot PLUS the spread copy.
        // merge_tally_snapshot_key pushes the jsonb || jsonb merge into
        // PostgreSQL so the edge worker only sends the new key's value.
        if (db) {
          const { error: mergeErr } = await db.rpc('merge_tally_snapshot_key', {
            p_tenant_key: tenantKey,
            p_company: activeCompany,
            p_key: job.key,
            p_data: result,
            p_count: counts[job.key],
            p_source: 'sync-full',
          });
          if (mergeErr) {
            errors['__persist__'] = `Failed to persist ${job.key}: ${mergeErr.message}`;
          }
        }
        // Keep light jobs around for the response's diagnostics block; the
        // client transformer uses ledgers + accountingGroups to compute
        // parent-group counts and sample chains in the sync-result panel.
        // Heavy jobs (Day Book) are NEVER kept in-memory past persistence;
        // the client reads them back via get-snapshot when a dashboard
        // mounts. Without this gate, stringify()'ing the response would
        // itself blow the compute cap.
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
        // from the per-job merge RPC above.
        await db.rpc('record_tally_snapshot_errors', {
          p_tenant_key: tenantKey,
          p_company: activeCompany,
          p_errors: errors,
          p_source: 'sync-full',
        });
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

    // Collapse per-year dayBook sub-keys (dayBook_2021, ...) into a single
    // aggregate "dayBook" entry for response-level consumers — the client
    // progress panel, the sync-result panel headline, and any scheduler /
    // cron wrapper that counts "did Day Book sync". The per-year keys
    // themselves are kept in storage (that's where the transformer reads
    // vouchers from) but never surfaced to the UI, which still thinks in
    // terms of one logical Day Book collection.
    const responseCounts = rollupDayBook(mergedResponse?.counts ?? counts);
    const responseErrors = rollupDayBookErrors(mergedResponse?.errors ?? errors);
    const responseSkipped = rollupDayBookSkipped(skipped);
    const responseFetched = rollupDayBookList(jobs.map((j) => j.key));

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

  // Dedicated portal-login test. Does NOT hit the XML endpoint — just
  // POSTs to hb.exe cp so the user can isolate whether the portal
  // credentials themselves are accepted. Returns status + body sample
  // so the UI can render a "here's what the server actually said".
  if (action === 'portal-login') {
    if (!cfg.host) {
      return new Response(JSON.stringify({ connected: false, error: 'Tally host not configured.' }), { headers: jsonHeaders });
    }
    const user = cfg.portalUsername;
    const pass = cfg.portalPassword;
    if (!user || !pass) {
      return new Response(JSON.stringify({
        connected: false,
        error: 'Portal username or password is blank. Fill the dedicated Portal fields on the TallySync page (or the Tally fields if they match).',
      }), { headers: jsonHeaders });
    }
    const result = await portalLogin(cfg.host, user, pass);
    return new Response(JSON.stringify({
      connected: result.ok,
      action,
      status: result.status,
      error: result.ok ? null : result.error,
      bodySample: result.bodySample,
      portalBase: portalBaseFromHost(cfg.host),
      diagnostics: { portalLoginAttempted: true, portalLoginOk: result.ok, portalLoginError: result.ok ? null : (result.error || null) },
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
