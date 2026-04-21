// Tally client — routes Tally calls to the configured backend.
// Priority: Supabase Edge Function ("tally") > Express REST backend > unavailable.

import api, { HAS_BACKEND } from '../utils/api';
import { HAS_SUPABASE, supabase } from '../utils/supabase';

export const TALLY_BACKEND =
  HAS_SUPABASE ? 'supabase' :
  HAS_BACKEND ? 'express' :
  'none';

export function tallyAvailable() {
  return TALLY_BACKEND !== 'none';
}

async function readErrorBody(error) {
  // supabase-js puts the Response on error.context when a function returns non-2xx.
  // We try to parse it as JSON to surface the real error message.
  const ctx = error?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      try {
        const text = await ctx.text();
        if (text) return text;
      } catch { /* ignore */ }
    }
  }
  return error?.message || 'Tally function failed';
}

async function supabaseInvoke(action, config = {}) {
  const { data, error } = await supabase.functions.invoke('tally', {
    body: { action, ...config },
  });
  if (error) {
    throw new Error(await readErrorBody(error));
  }
  return data;
}

export async function testConnection(config = {}) {
  if (TALLY_BACKEND === 'supabase') {
    const data = await supabaseInvoke('test', config);
    return { connected: Boolean(data?.connected), response: data?.data, error: data?.error };
  }
  if (TALLY_BACKEND === 'express') {
    const r = await api.post('/tally/test', config);
    return r.data;
  }
  throw new Error('Tally is not available on this deployment. Configure Supabase (VITE_SUPABASE_URL) or a dedicated backend (VITE_API_URL).');
}

export async function syncFromTally(config = {}) {
  if (TALLY_BACKEND === 'supabase') {
    const data = await supabaseInvoke('sync', config);
    const counts = data?.counts || {};
    return {
      success: Boolean(data?.connected),
      error: data?.error,
      ledgers: counts.ledgers || 0,
      vouchers: counts.vouchers || 0,
      stockItems: counts.stockItems || 0,
      groups: counts.groups || 0,
      raw: data?.data,
      note: 'Raw Tally ledgers received. Dashboard transformer (ledger → dealer mapping) lands in the next iteration.',
    };
  }
  if (TALLY_BACKEND === 'express') {
    const r = await api.post('/tally/sync', config);
    return r.data;
  }
  throw new Error('Tally is not available on this deployment.');
}

export async function getStatus() {
  if (TALLY_BACKEND === 'express') {
    try { return (await api.get('/tally/status')).data; } catch { return null; }
  }
  // Supabase: return stateless placeholder. Full status requires persisting sync metadata.
  return { connected: false, source: 'mock', lastAttempt: null, lastError: null };
}

export async function getDataSummary() {
  if (TALLY_BACKEND === 'express') {
    try { return (await api.get('/tally/data-summary')).data; } catch { return null; }
  }
  return null;
}
