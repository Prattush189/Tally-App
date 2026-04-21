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
//   { action: 'sync' }                    → list of customers summary
//   { action: 'request', xml: '...' }     → raw XML passthrough
// Optional fields on every request: host, username, password, company.

import { XMLParser } from 'npm:fast-xml-parser@4.3.4';

type TallyConfig = {
  host?: string;
  username?: string;
  password?: string;
  company?: string;
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
  isArray: (name) => ['LEDGER', 'VOUCHER', 'STOCKITEM', 'BILL', 'BODY', 'COLLECTION'].includes(name),
});

function resolveConfig(overrides: TallyConfig): Required<TallyConfig> {
  const host = overrides.host || Deno.env.get('TALLY_HOST') || '';
  const username = overrides.username ?? Deno.env.get('TALLY_USERNAME') ?? '';
  const password = overrides.password ?? Deno.env.get('TALLY_PASSWORD') ?? '';
  const company = overrides.company || Deno.env.get('TALLY_COMPANY') || '';
  return { host, username, password, company };
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

function companyFilter(company: string) {
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

// Lightweight sync — asks Tally for the built-in "Ledger" collection with minimal
// fields. A heavier custom-TDL query with SundryDebtorFilter + many NATIVEMETHODs
// produced responses large enough that shared-hosting Tally providers drop the
// connection mid-send ("connection closed before message completed"). This query
// returns enough to confirm plumbing works; the full transformer pass (map
// ledgers → dashboard customers, filter to sundry debtors client-side) lands
// when the CSV-upload or paginated-sync work goes in.
// Walk the parsed Tally XML response and count the most common record types.
// The response shape varies: ENVELOPE.BODY.DATA.COLLECTION.LEDGER, or nested
// directly under ENVELOPE.BODY, or inside a RESPONSE wrapper. We just dig for
// any arrays named LEDGER / VOUCHER / STOCKITEM / GROUP anywhere in the tree.
function countRecords(tree: unknown): { ledgers: number; vouchers: number; stockItems: number; groups: number } {
  const counts = { ledgers: 0, vouchers: 0, stockItems: 0, groups: 0 };
  const seen = new WeakSet<object>();
  const map: Record<string, keyof typeof counts> = {
    LEDGER: 'ledgers', VOUCHER: 'vouchers', STOCKITEM: 'stockItems', GROUP: 'groups',
  };
  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const bucket = map[key as keyof typeof map];
      if (bucket && Array.isArray(value)) counts[bucket] += value.length;
      else if (bucket && value && typeof value === 'object') counts[bucket] += 1;
      walk(value);
    }
  }
  walk(tree);
  return counts;
}
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Ledger</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyFilter(company)}
      </STATICVARIABLES>
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

  let xml: string;
  if (action === 'test') {
    xml = reportRequest('List of Companies', cfg.company);
  } else if (action === 'sync') {
    xml = sundryDebtorsRequest(cfg.company);
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
