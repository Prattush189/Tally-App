// Persists the last-synced Tally customer set in localStorage so dashboards
// can read real data between page loads without re-hitting the Edge Function.
// Per-user key (email) keeps separate users' data isolated even on a shared
// device.

const KEY_PREFIX = 'b2b_live_customers_v1:';

function keyFor(userEmail) {
  return KEY_PREFIX + (userEmail || '').toLowerCase();
}

export function saveLiveCustomers(userEmail, customers, totals) {
  if (!userEmail) return;
  try {
    const payload = {
      syncedAt: new Date().toISOString(),
      customers,
      totals: totals || null,
    };
    localStorage.setItem(keyFor(userEmail), JSON.stringify(payload));
  } catch {
    // Quota exceeded or private mode — skip silently; user sees a fresh sync next load.
  }
}

export function loadLiveCustomers(userEmail) {
  if (!userEmail) return null;
  try {
    const raw = localStorage.getItem(keyFor(userEmail));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.customers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLiveCustomers(userEmail) {
  if (!userEmail) return;
  try { localStorage.removeItem(keyFor(userEmail)); } catch { /* ignore */ }
}
