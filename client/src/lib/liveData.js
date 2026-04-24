// Persists the last-synced Tally customer set in localStorage so dashboards
// can read real data between page loads without re-hitting the Edge Function.
// Per-user key (email) keeps separate users' data isolated even on a shared
// device.

const KEY_PREFIX = 'b2b_live_customers_v1:';

function keyFor(userEmail) {
  return KEY_PREFIX + (userEmail || '').toLowerCase();
}

// Per-customer `missedCategories` is the single largest contributor to payload
// size — every dealer carries the full list of unpurchased categories, so a
// modest 150-category catalog × a few thousand dealers blows past localStorage's
// 5-10 MB quota. We strip it at save time, store one shared `allCategories`
// list at the root, and re-expand per customer at load. Saves ~90% of payload
// size in the typical "2000 dealers, most with zero sales history" case.
function slimPayload(payload) {
  const customers = payload.customers || [];
  const categorySet = new Set();
  for (const c of customers) {
    for (const cat of c.purchasedCategories || []) categorySet.add(cat);
    for (const cat of c.missedCategories || []) categorySet.add(cat);
  }
  const slimmed = customers.map((c) => {
    if (!c || !Array.isArray(c.missedCategories)) return c;
    const rest = { ...c };
    delete rest.missedCategories;
    return rest;
  });
  return {
    ...payload,
    customers: slimmed,
    allCategories: Array.from(categorySet),
    slim: true,
  };
}

function expandPayload(payload) {
  if (!payload || !Array.isArray(payload.customers)) return payload;
  if (!Array.isArray(payload.allCategories)) return payload;
  const all = payload.allCategories;
  const expanded = payload.customers.map((c) => {
    if (!c || Array.isArray(c.missedCategories)) return c;
    const purchased = new Set(c.purchasedCategories || []);
    return { ...c, missedCategories: all.filter((cat) => !purchased.has(cat)) };
  });
  return { ...payload, customers: expanded };
}

function trySet(key, payload) {
  localStorage.setItem(key, JSON.stringify(payload));
}

export function saveLiveCustomers(userEmail, customers, totals) {
  if (!userEmail) return;
  // Callers that pulled data from a cloud snapshot pass the snapshot's
  // server-side updated_at via totals.syncedAt; honour it so subsequent
  // cross-PC "is cloud newer?" comparisons stay exact. Direct Sync Now
  // callers don't pass one — they get client now(), which is always
  // strictly after the server finished writing (client save happens on
  // response receive), so localAt >= cloudAt naturally.
  const explicit = totals && typeof totals.syncedAt === 'string' ? totals.syncedAt : null;
  const payload = {
    syncedAt: explicit || new Date().toISOString(),
    customers,
    totals: totals || null,
  };
  const key = keyFor(userEmail);
  try {
    trySet(key, payload);
    return;
  } catch (err) {
    // Typically QuotaExceededError — big catalogs × many dealers push past
    // the 5-10 MB localStorage quota. Fall through to the slim fallback
    // rather than leaving the dashboards in "no data synced yet" state.
    console.warn('[liveData] full save failed, retrying slim:', err?.name || err);
  }
  try {
    trySet(key, slimPayload(payload));
  } catch (err) {
    // Slim also failed — nothing else to try. Surface loudly so the next
    // dashboard render doesn't silently pretend the sync produced nothing.
    console.error('[liveData] slim save also failed:', err?.name || err);
  }
}

export function loadLiveCustomers(userEmail) {
  if (!userEmail) return null;
  try {
    const raw = localStorage.getItem(keyFor(userEmail));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.customers)) return null;
    return expandPayload(parsed);
  } catch {
    return null;
  }
}

export function clearLiveCustomers(userEmail) {
  if (!userEmail) return;
  try { localStorage.removeItem(keyFor(userEmail)); } catch { /* ignore */ }
}
