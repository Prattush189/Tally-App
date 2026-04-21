// Local Tally sync driver.
//
// What it does, end-to-end:
// 1. Fetches portal + Tally creds from the Supabase Edge Function (action:
//    'get-config'), gated on LOCAL_SYNC_TOKEN so random callers can't leak
//    them.
// 2. Launches a Playwright Chromium browser, POSTs the portal login form,
//    opens /software/html5.html, clicks TallyPrime.
// 3. Polls http://<portalHost>:9007/ from inside that browser context until
//    Tally responds (it only starts serving HTTP after the RemoteApp is up).
// 4. Fires the 5 collection queries serially with a 1.5s cooldown and a
//    per-request timeout. Parses each response to JSON with fast-xml-parser.
// 5. POSTs the parsed bundle (plus per-collection counts / errors) to the
//    Edge Function (action: 'ingest'), which upserts tally_snapshots.
//
// Run: `npm run sync`  (headless).
//      `npm run sync:headed` to watch the browser (debug portal DOM changes).
//
// Expects a .env file in this directory — see .env.example.

import 'dotenv/config';
import { chromium } from 'playwright';
import { XMLParser } from 'fast-xml-parser';
import {
  sundryDebtorsRequest, salesVouchersRequest, receiptVouchersRequest,
  stockItemsRequest, stockGroupsRequest, XML_ARRAY_NODES, countNode,
} from './queries.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SYNC_TOKEN = process.env.LOCAL_SYNC_TOKEN;
const TENANT_KEY = process.env.TENANT_KEY || 'default';
const HEADED = process.env.HEADED === '1';

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

if (!SUPABASE_URL) die('SUPABASE_URL not set. Copy .env.example to .env and fill it in.');
if (!SUPABASE_ANON_KEY) die('SUPABASE_ANON_KEY not set.');
if (!SYNC_TOKEN) die('LOCAL_SYNC_TOKEN not set.');

async function callEdge(action, body = {}) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/tally`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action, tenantKey: TENANT_KEY, ...body }),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`Edge function returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok || parsed?.connected === false) {
    throw new Error(parsed?.error || `Edge function '${action}' failed (HTTP ${res.status})`);
  }
  return parsed;
}

function log(stage, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${stage}: ${msg}`);
}

// Click TallyPrime in the portal's launcher. DOM isn't documented, so we
// try a handful of selectors in order of specificity. If none match the
// user can run with HEADED=1 and eyeball what to click.
async function clickTallyPrime(page) {
  const candidates = [
    'a:has-text("TallyPrime")',
    'a:has-text("Tally Prime")',
    'div:has-text("TallyPrime") img',
    'img[alt*="Tally" i]',
    '[title*="Tally" i]',
    'text=TallyPrime',
  ];
  for (const sel of candidates) {
    const el = await page.$(sel);
    if (el) {
      log('portal', `clicking TallyPrime via selector: ${sel}`);
      await el.click();
      return true;
    }
  }
  return false;
}

async function waitForTally(page, tallyUrl, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  const probeXml = `<?xml version="1.0"?><ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const r = await page.request.post(tallyUrl, {
        headers: { 'Content-Type': 'application/xml' },
        data: probeXml,
        timeout: 8000,
      });
      if (r.ok()) {
        const body = await r.text();
        if (body.includes('<ENVELOPE') || body.includes('<COMPANY')) return;
      }
    } catch (err) {
      if (attempt % 5 === 0) log('probe', `still waiting (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Tally :9007 never responded within ${Math.round(timeoutMs / 1000)}s`);
}

async function fetchCollection(page, tallyUrl, xml, timeoutMs = 120000) {
  const r = await page.request.post(tallyUrl, {
    headers: { 'Content-Type': 'application/xml' },
    data: xml,
    timeout: timeoutMs,
  });
  if (!r.ok()) throw new Error(`Tally HTTP ${r.status()} ${r.statusText()}`);
  return r.text();
}

async function main() {
  log('boot', 'fetching portal config from Supabase');
  const { config } = await callEdge('get-config', { syncToken: SYNC_TOKEN });
  if (!config?.portalUrl) die('Edge function returned empty portalUrl. Set TALLY_PORTAL_URL via `supabase secrets set`.');
  if (!config?.portalUser || !config?.portalPass) die('Portal creds missing. Set TALLY_PORTAL_USER / TALLY_PORTAL_PASS.');
  const portalUrl = config.portalUrl.replace(/\/+$/, '');
  const portalHost = new URL(portalUrl).hostname;
  const tallyUrl = `http://${portalHost}:9007/`;
  log('boot', `portal=${portalUrl}  tally=${tallyUrl}  company=${config.company || '(default)'}`);

  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  try {
    log('login', 'POST /cgi-bin/hb.exe');
    const loginRes = await page.request.post(`${portalUrl}/cgi-bin/hb.exe`, {
      form: {
        action: 'cp',
        l: config.portalUser,
        p: config.portalPass,
        d: '',
        f: '',
        t: String(Date.now()),
      },
      timeout: 30000,
    });
    const loginText = await loginRes.text();
    if (!loginRes.ok() || !/ok/i.test(loginText)) {
      throw new Error(`Portal login rejected (HTTP ${loginRes.status()}): ${loginText.slice(0, 200)}`);
    }
    log('login', 'portal accepted creds');

    log('launcher', `GET ${portalUrl}/software/html5.html`);
    await page.goto(`${portalUrl}/software/html5.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const clicked = await clickTallyPrime(page);
    if (!clicked) {
      if (HEADED) {
        log('launcher', 'Could not find TallyPrime button — leaving browser open so you can click it manually. Script will keep polling :9007.');
      } else {
        throw new Error('TallyPrime launcher element not found. Re-run with HEADED=1 to inspect the portal DOM.');
      }
    }

    log('tally', 'waiting for :9007 to accept XML');
    await waitForTally(page, tallyUrl, 180000);
    log('tally', 'reachable — running collection queries');

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '_',
      textNodeName: '_text',
      isArray: (name) => XML_ARRAY_NODES.has(name),
    });

    const jobs = [
      { key: 'ledgers', xml: sundryDebtorsRequest(config), node: 'LEDGER' },
      { key: 'salesVouchers', xml: salesVouchersRequest(config), node: 'VOUCHER' },
      { key: 'receiptVouchers', xml: receiptVouchersRequest(config), node: 'VOUCHER' },
      { key: 'stockItems', xml: stockItemsRequest(config), node: 'STOCKITEM' },
      { key: 'stockGroups', xml: stockGroupsRequest(config), node: 'STOCKGROUP' },
    ];

    const data = {};
    const counts = {};
    const errors = {};
    let first = true;
    for (const job of jobs) {
      if (!first) await new Promise((r) => setTimeout(r, 1500));
      first = false;
      try {
        log('fetch', `${job.key}...`);
        const text = await fetchCollection(page, tallyUrl, job.xml, 120000);
        const parsed = parser.parse(text);
        data[job.key] = parsed;
        counts[job.key] = countNode(parsed, job.node);
        log('fetch', `${job.key}: ${counts[job.key]} ${job.node}`);
      } catch (err) {
        data[job.key] = null;
        counts[job.key] = 0;
        errors[job.key] = err.message;
        log('fetch', `${job.key} FAILED: ${err.message}`);
      }
    }

    log('ingest', 'POST /functions/v1/tally action=ingest');
    await callEdge('ingest', {
      syncToken: SYNC_TOKEN,
      data,
      counts,
      errors,
      source: 'local-playwright',
    });

    console.log('\n✓ Snapshot written. Counts:');
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(16)} ${v}`);
    const errKeys = Object.keys(errors);
    if (errKeys.length) {
      console.log('\nErrors:');
      for (const k of errKeys) console.log(`  ${k}: ${errors[k]}`);
    }
  } finally {
    if (!HEADED) await browser.close();
    else log('done', 'HEADED=1 — leaving browser open. Close it manually when done.');
  }
}

main().catch((err) => {
  console.error(`\n✗ Sync failed: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
