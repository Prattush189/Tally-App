// Injects a floating "Sync to Dashboard" button on the Tally cloud portal.
//
// Flow when the user clicks it:
// 1. Read settings (Supabase URL + anon key + sync token + company) from
//    chrome.storage.local. Bail early with a toast if not configured.
// 2. Probe http://103.76.213.243:9007/ to make sure Tally is actually up.
//    Extensions bypass CORS via host_permissions in the manifest, so we
//    can fetch any origin listed there.
// 3. Fire the 5 collection XML queries serially with a 1.5s cooldown
//    (single-connection-tunnel friendly).
// 4. POST the raw XML strings to the Supabase edge function's ingest
//    action. The edge function parses them server-side.
// 5. Toast with per-collection counts.

const TALLY_URL = 'http://103.76.213.243:9007/';
const STORAGE_KEY = 'tallyDashboardSyncConfig';

const Q = window.__TALLY_QUERIES;

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (r) => resolve(r[STORAGE_KEY] || {}));
  });
}

function toast(msg, kind = 'info') {
  let el = document.getElementById('__tally_sync_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '__tally_sync_toast';
    document.body.appendChild(el);
  }
  el.className = `__tally_sync_toast __tally_sync_toast--${kind}`;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el.__hideTimer);
  el.__hideTimer = setTimeout(() => { el.style.display = 'none'; }, 8000);
}

async function probeTally() {
  // Minimal List-of-Companies request. Same probe the local sync uses —
  // if Tally's not up yet (the user hasn't clicked TallyPrime), this will
  // throw and we'll ask them to click first.
  const probeXml = `<?xml version="1.0"?><ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;
  const res = await fetch(TALLY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: probeXml,
  });
  if (!res.ok) throw new Error(`Tally HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('<ENVELOPE') && !text.includes('<COMPANY')) {
    throw new Error('Tally responded but not with XML — check that TallyPrime is launched');
  }
  return true;
}

async function fetchCollection(xml) {
  const res = await fetch(TALLY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  });
  if (!res.ok) throw new Error(`Tally HTTP ${res.status}`);
  return res.text();
}

async function runSync(btn) {
  const cfg = await loadConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !cfg.syncToken) {
    toast('Configure the extension first — click its toolbar icon.', 'error');
    return;
  }

  btn.disabled = true;
  btn.dataset.busy = '1';
  btn.textContent = '⏳ Probing Tally…';

  try {
    await probeTally();
  } catch (err) {
    btn.disabled = false;
    delete btn.dataset.busy;
    btn.textContent = '↻ Sync to Dashboard';
    toast(`Tally isn't responding on :9007 — make sure you've clicked the TallyPrime icon. (${err.message})`, 'error');
    return;
  }

  const tallyCfg = { company: cfg.company || '', fromDate: '', toDate: '' };
  const jobs = [
    { key: 'ledgers', label: 'ledgers', xml: Q.sundryDebtorsRequest(tallyCfg) },
    { key: 'salesVouchers', label: 'sales', xml: Q.salesVouchersRequest(tallyCfg) },
    { key: 'receiptVouchers', label: 'receipts', xml: Q.receiptVouchersRequest(tallyCfg) },
    { key: 'stockItems', label: 'stock items', xml: Q.stockItemsRequest(tallyCfg) },
    { key: 'stockGroups', label: 'stock groups', xml: Q.stockGroupsRequest(tallyCfg) },
  ];

  const rawXml = {};
  const errors = {};
  let first = true;
  for (const job of jobs) {
    if (!first) await new Promise((r) => setTimeout(r, 1500));
    first = false;
    btn.textContent = `⏳ Pulling ${job.label}…`;
    try {
      rawXml[job.key] = await fetchCollection(job.xml);
    } catch (err) {
      errors[job.key] = err.message;
    }
  }

  btn.textContent = '⏳ Uploading to dashboard…';
  const tenantKey = cfg.tenantKey || 'default';
  const ingestUrl = `${cfg.supabaseUrl.replace(/\/+$/, '')}/functions/v1/tally`;
  let result;
  try {
    const res = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.supabaseAnonKey,
        'Authorization': `Bearer ${cfg.supabaseAnonKey}`,
      },
      body: JSON.stringify({
        action: 'ingest',
        syncToken: cfg.syncToken,
        tenantKey,
        rawXml,
        errors,
        source: 'chrome-extension',
      }),
    });
    result = await res.json();
    if (!res.ok || result?.connected === false) {
      throw new Error(result?.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    btn.disabled = false;
    delete btn.dataset.busy;
    btn.textContent = '↻ Sync to Dashboard';
    toast(`Upload failed: ${err.message}`, 'error');
    return;
  }

  const counts = result?.counts || {};
  const parts = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ') || 'snapshot stored';
  const errCount = Object.keys(result?.errors || {}).length;
  toast(`✓ Synced · ${parts}${errCount ? ` · ${errCount} collection error(s)` : ''}`, errCount ? 'warn' : 'ok');

  btn.disabled = false;
  delete btn.dataset.busy;
  btn.textContent = '↻ Sync to Dashboard';
}

function injectButton() {
  if (document.getElementById('__tally_sync_btn')) return;
  const btn = document.createElement('button');
  btn.id = '__tally_sync_btn';
  btn.className = '__tally_sync_btn';
  btn.textContent = '↻ Sync to Dashboard';
  btn.title = 'Log into the portal + click TallyPrime first. Then click this to push data to your dashboard.';
  btn.addEventListener('click', () => {
    if (btn.dataset.busy) return;
    runSync(btn);
  });
  document.body.appendChild(btn);
}

// The portal is a SPA — inject after idle, and re-inject on any DOM mutation
// that removes our button (which the portal might do on navigation).
injectButton();
const mo = new MutationObserver(() => {
  if (!document.getElementById('__tally_sync_btn')) injectButton();
});
mo.observe(document.body, { childList: true, subtree: true });
