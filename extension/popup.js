const STORAGE_KEY = 'tallyDashboardSyncConfig';
const fields = ['supabaseUrl', 'supabaseAnonKey', 'syncToken', 'company', 'tenantKey'];
const form = document.getElementById('cfg');
const status = document.getElementById('status');

chrome.storage.local.get([STORAGE_KEY], (r) => {
  const cfg = r[STORAGE_KEY] || {};
  for (const k of fields) {
    const el = document.getElementById(k);
    if (el && cfg[k]) el.value = cfg[k];
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const cfg = {};
  for (const k of fields) {
    const el = document.getElementById(k);
    cfg[k] = (el?.value || '').trim();
  }
  if (!cfg.tenantKey) cfg.tenantKey = 'default';
  chrome.storage.local.set({ [STORAGE_KEY]: cfg }, () => {
    status.className = 'ok';
    status.textContent = '✓ Saved. Open the Tally portal tab to use the Sync button.';
    setTimeout(() => { status.textContent = ''; status.className = ''; }, 4000);
  });
});
