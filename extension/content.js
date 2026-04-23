// Injects a floating "Sync to Dashboard" button on the Tally cloud portal,
// and — if portal creds are stored — auto-submits the portal login form so
// the user only has to click TallyPrime inside the launcher.
//
// Flow on page load:
// 0. If we're on the portal login page and portalUser + portalPass are in
//    chrome.storage.local, POST the login form to /cgi-bin/hb.exe and
//    redirect to /software/html5.html. Skipped if creds aren't stored, or
//    auto-login already fired this tab session (sessionStorage guard).
//
// Flow when the user clicks Sync to Dashboard:
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
const PORTAL_ORIGIN = 'http://103.76.213.243';
const PORTAL_LOGIN_ENDPOINT = `${PORTAL_ORIGIN}/cgi-bin/hb.exe`;
const PORTAL_LAUNCHER_PATH = '/software/html5.html';
const STORAGE_KEY = 'tallyDashboardSyncConfig';
// Session-scoped flag so we don't retry auto-login on every SPA navigation
// within the same tab (portal is a SPA and re-injects the script on route
// changes, but sessionStorage survives the re-injects).
const AUTOLOGIN_FLAG = '__tally_autologin_done';

// Per-collection freshness window. Mirrors COLLECTION_TTL_MS in the edge
// function — when we read get-snapshot back, we skip any collection synced
// more recently than this (and with no error). Master data (ledgers, stock)
// rarely changes, so 30 min; vouchers turn over daily, 10 min.
const COLLECTION_TTL_MS = {
  ledgers: 30 * 60_000,
  salesVouchers: 10 * 60_000,
  receiptVouchers: 10 * 60_000,
  stockItems: 30 * 60_000,
  stockGroups: 30 * 60_000,
};

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
  const allJobs = [
    { key: 'ledgers', label: 'ledgers', xml: Q.sundryDebtorsRequest(tallyCfg) },
    { key: 'accountingGroups', label: 'accounting groups', xml: Q.accountingGroupsRequest(tallyCfg) },
    { key: 'stockItems', label: 'stock items', xml: Q.stockItemsRequest(tallyCfg) },
    { key: 'stockGroups', label: 'stock groups', xml: Q.stockGroupsRequest(tallyCfg) },
    { key: 'salesVouchers', label: 'sales', xml: Q.salesVouchersRequest(tallyCfg) },
    { key: 'receiptVouchers', label: 'receipts', xml: Q.receiptVouchersRequest(tallyCfg) },
  ];

  // Check the stored snapshot so we can skip collections synced recently
  // with no error. Force-resync if the auto-sync path called us (assumes
  // fresh Tally activation after a manual click).
  btn.textContent = '⏳ Checking what to sync…';
  const endpoint = `${cfg.supabaseUrl.replace(/\/+$/, '')}/functions/v1/tally`;
  const tenantKey = cfg.tenantKey || 'default';
  let collectionMeta = {};
  try {
    const statusRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.supabaseAnonKey,
        'Authorization': `Bearer ${cfg.supabaseAnonKey}`,
      },
      body: JSON.stringify({ action: 'get-snapshot', tenantKey }),
    });
    const statusBody = await statusRes.json();
    collectionMeta = statusBody?.collectionMeta || {};
  } catch { /* non-fatal — just won't skip anything */ }

  const jobs = [];
  const skipped = {};
  const now = Date.now();
  for (const job of allJobs) {
    const meta = collectionMeta[job.key];
    if (meta?.updated_at && !meta.error) {
      const ageMs = now - new Date(meta.updated_at).getTime();
      const ttl = COLLECTION_TTL_MS[job.key] ?? 30 * 60_000;
      if (ageMs < ttl) {
        skipped[job.key] = Math.round(ageMs / 60_000);
        continue;
      }
    }
    jobs.push(job);
  }

  if (!jobs.length) {
    toast(`Everything is fresh — nothing to sync. (Skipped: ${Object.entries(skipped).map(([k, m]) => `${k} ${m}m old`).join(', ')})`, 'info');
    btn.disabled = false;
    delete btn.dataset.busy;
    btn.textContent = '↻ Sync to Dashboard';
    return;
  }

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
  let result;
  try {
    const res = await fetch(endpoint, {
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
  const skipNote = Object.keys(skipped).length ? ` · kept ${Object.keys(skipped).length} fresh` : '';
  toast(`✓ Synced · ${parts}${skipNote}${errCount ? ` · ${errCount} collection error(s)` : ''}`, errCount ? 'warn' : 'ok');

  btn.disabled = false;
  delete btn.dataset.busy;
  btn.textContent = '↻ Sync to Dashboard';
}

// Detect whether the current page is the portal login form. Portal login is
// a static HTML page that posts to /cgi-bin/hb.exe — we check for (a) a form
// whose action points at that endpoint, or (b) the well-known input names
// ('l' for login, 'p' for password) used by HOB RemoteApp's login form.
function isLoginPage() {
  const form = document.querySelector('form');
  if (form) {
    const action = (form.getAttribute('action') || '').toLowerCase();
    if (action.includes('hb.exe')) return true;
    if (form.querySelector('input[name="l"]') && form.querySelector('input[name="p"]')) return true;
  }
  // Some portal builds present the login through a plain <input type="password">
  // on the root path without a form tag. Heuristic: password field + root path.
  if (location.pathname === '/' && document.querySelector('input[type="password"]')) return true;
  return false;
}

// Auto-submit the portal login form using stored creds. Mirrors the Playwright
// path in tools/tally-sync-local/sync.mjs — same endpoint, same field names.
// Safe: if creds aren't stored, or auto-login already fired this session, we
// no-op and let the user log in by hand.
async function autoLoginIfPossible() {
  if (sessionStorage.getItem(AUTOLOGIN_FLAG)) return;
  const cfg = await loadConfig();
  if (!cfg.portalUser || !cfg.portalPass) return;
  if (!isLoginPage()) return;
  sessionStorage.setItem(AUTOLOGIN_FLAG, '1');
  toast('Auto-logging in to the Tally portal…', 'info');
  try {
    const form = new URLSearchParams({
      action: 'cp',
      l: cfg.portalUser,
      p: cfg.portalPass,
      d: '',
      f: '',
      t: String(Date.now()),
    });
    const res = await fetch(PORTAL_LOGIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      credentials: 'include',
    });
    const text = await res.text();
    if (!res.ok || !/ok/i.test(text)) {
      toast(`Auto-login rejected (HTTP ${res.status}). Log in manually.`, 'error');
      return;
    }
    // Portal accepts creds; navigate to the launcher where the user can
    // click TallyPrime. (We don't auto-click it — the RemoteApp launcher
    // DOM is fragile; see tools/tally-sync-local/sync.mjs for context.)
    location.href = `${PORTAL_ORIGIN}${PORTAL_LAUNCHER_PATH}`;
  } catch (err) {
    toast(`Auto-login failed: ${err.message}. Log in manually.`, 'error');
  }
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

// Kick off auto-login before anything else — if we're on the login page and
// creds are stored, this POSTs the form and navigates to the launcher. The
// button injection + sync watchdog below then resumes on the next page.
autoLoginIfPossible();

// The portal is a SPA — inject after idle, and re-inject on any DOM mutation
// that removes our button (which the portal might do on navigation).
injectButton();
const mo = new MutationObserver(() => {
  if (!document.getElementById('__tally_sync_btn')) injectButton();
});
mo.observe(document.body, { childList: true, subtree: true });

// Auto-sync watchdog: poll :9007 every 5s. When TallyPrime starts responding,
// fire the sync automatically so the user doesn't have to click the button.
// Debounced to once per 2 min — prevents hammering Tally if the page stays
// open all day, and stops us from re-syncing after the user closes + reopens
// the RemoteApp session within that window.
const AUTO_COOLDOWN_MS = 120000;
let lastAutoAt = 0;
let autoInFlight = false;

async function autoSyncIfReady() {
  if (autoInFlight) return;
  if (Date.now() - lastAutoAt < AUTO_COOLDOWN_MS) return;
  autoInFlight = true;
  try {
    // Cheap probe — if it fails we just try again in 5s.
    await probeTally();
    lastAutoAt = Date.now();
    const btn = document.getElementById('__tally_sync_btn');
    if (btn && !btn.dataset.busy) {
      toast('TallyPrime detected — syncing automatically…', 'info');
      await runSync(btn);
    }
  } catch {
    // Tally not up yet (user hasn't clicked TallyPrime). That's normal.
  } finally {
    autoInFlight = false;
  }
}

setInterval(autoSyncIfReady, 5000);
