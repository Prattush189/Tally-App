// Supabase Edge Function — AI suggestion service for the Actions & Outreach
// pages. Calls Gemini 2.5 Flash with Google Search grounding over a compact
// summary of the user's live Tally data. The API key lives only in Supabase
// secrets (GEMINI_API_KEY), never in the browser.
//
// Deploy: supabase functions deploy ai-suggest
// Secrets: supabase secrets set GEMINI_API_KEY=...
//
// Actions:
//   { action: 'suggest', task: 'action-focus' | ..., context: {...} }
//     → returns { suggestions, citations, model, cached }
//
// Bodies are expected to be small — a summary, not the whole customer
// array — so we don't leak PII into the prompt and stay well under Gemini's
// 1M-token window. The client (client/src/lib/aiClient.js) trims before
// calling.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — AI insights don't need to refresh constantly
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

type Task = 'action-focus' | 'revenue-suggestions' | 'payment-reminders' | 'proactive' | 'contact-priority' | 'dealer-suggestions';

const KNOWN_TASKS: Task[] = [
  'action-focus', 'revenue-suggestions', 'payment-reminders',
  'proactive', 'contact-priority', 'dealer-suggestions',
];

// Per-task system prompts. Each one describes the role the model plays and
// the JSON shape the UI expects back. Output is parsed via
// generationConfig.responseMimeType=application/json so Gemini returns
// valid JSON consistently.
function systemPromptFor(task: Task): string {
  const base = `You are an analyst for an Indian B2B distribution business that runs on TallyPrime. ` +
    `The user has just synced their Tally data and needs concrete, immediately actionable advice grounded in what the numbers show. ` +
    `Use Google Search to verify facts and cite sources when you reference market trends, seasonal patterns, competitor behavior, or regulatory context. ` +
    `Respond in strict JSON conforming to the response schema. Keep language crisp — Indian English, no fluff, specific rupee figures, reference the dealer names and categories provided.`;

  const taskSpecific: Record<Task, string> = {
    'action-focus':
      `Produce the top 5 actions the user should take this week. Each action should identify WHO (specific dealer if applicable) and WHY (the signal from the data), plus expected impact.`,
    'revenue-suggestions':
      `Produce 4–6 concrete revenue-growth plays. Each should be a distinct strategy (geographic, category, bundle, seasonal, etc.) with estimated rupee uplift and the subset of dealers most likely to respond.`,
    'payment-reminders':
      `Produce per-urgency guidance for overdue invoices. Segment by critical/high/medium/upcoming and write the exact message (WhatsApp / email template) that should go out.`,
    'proactive':
      `Produce proactive triggers the user should act on BEFORE a problem shows up — declining orders, stretched payment cycles, category drift. Each with a specific dealer or segment named.`,
    'contact-priority':
      `Produce a ranked outreach plan for this week. Prioritize by churn-risk × value × days-since-last-contact. Include the opening line for each conversation.`,
    'dealer-suggestions':
      `Suggest new-dealer prospects. For each, name the city, why the market fit is good (cite Google Search findings on local demographics / competitors), and how to approach. Also flag dormant dealers from the provided list worth reactivating.`,
  };
  return `${base}\n\nTask: ${taskSpecific[task]}`;
}

// Structured-output schema passed to Gemini. Every task returns the same
// shape so the client can render uniformly. `citations` is a flat list of
// URLs the model used from Google Search.
const responseSchema = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          priority: { type: 'STRING', enum: ['Critical', 'High', 'Medium', 'Low'] },
          category: { type: 'STRING' },
          target: { type: 'STRING' },
          rationale: { type: 'STRING' },
          impact: { type: 'STRING' },
          actions: { type: 'ARRAY', items: { type: 'STRING' } },
          citations: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['title', 'priority', 'rationale', 'impact', 'actions'],
      },
    },
  },
  required: ['summary', 'suggestions'],
};

// FNV-1a hash of the stringified context, used as the cache key. Stable
// across edge-function invocations.
function hashContext(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

async function callGemini(task: Task, context: unknown, apiKey: string) {
  const url = `${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPromptFor(task) }] },
    contents: [{
      role: 'user',
      parts: [{ text: `Here is the real Tally data summary to analyze (JSON):\n\n${JSON.stringify(context)}\n\nProduce the response now.` }],
    }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema,
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text);
    const part = parsed?.candidates?.[0]?.content?.parts?.[0];
    const raw = part?.text;
    if (!raw) throw new Error('Gemini returned no text');
    let structured;
    try { structured = JSON.parse(raw); }
    catch { throw new Error('Gemini response was not valid JSON'); }

    // Grounding metadata is where the actual web-search citations live.
    // Pull out the URLs for the UI to render beside each suggestion.
    const grounding = parsed?.candidates?.[0]?.groundingMetadata;
    const citations = (grounding?.groundingChunks || [])
      .map((c: { web?: { uri?: string; title?: string } }) => c.web ? { uri: c.web.uri, title: c.web.title } : null)
      .filter(Boolean);

    return { structured, citations, groundingMetadata: grounding || null };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
  let body: Record<string, unknown> = {};
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Request body must be JSON' }), { status: 400, headers: jsonHeaders });
  }

  const action = (body.action as string) || 'suggest';
  if (action !== 'suggest') {
    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: jsonHeaders });
  }

  const task = body.task as Task;
  if (!KNOWN_TASKS.includes(task)) {
    return new Response(JSON.stringify({ error: `Unknown task. Must be one of: ${KNOWN_TASKS.join(', ')}` }), { status: 400, headers: jsonHeaders });
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY') || '';
  if (!apiKey) {
    // Return a specific, non-error shape so the client can render a "add
    // your Gemini key" inline note instead of a toast.
    return new Response(JSON.stringify({
      error: 'GEMINI_API_KEY is not configured on the server.',
      setupHint: 'Run: supabase secrets set GEMINI_API_KEY=<key> to enable AI insights.',
      configured: false,
    }), { status: 200, headers: jsonHeaders });
  }

  const tenantKey = (body.tenantKey as string) || 'default';
  const context = body.context || {};
  const snapshotHash = hashContext({ task, context });

  // Cache lookup. Service role required — this table is RLS-locked.
  const dbUrl = Deno.env.get('SUPABASE_URL') || '';
  const dbRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const db = (dbUrl && dbRole) ? createClient(dbUrl, dbRole, { auth: { persistSession: false } }) : null;

  const forceRefresh = body.forceRefresh === true;
  if (db && !forceRefresh) {
    const { data: cached } = await db
      .from('ai_suggestions')
      .select('result, citations, model, updated_at')
      .eq('tenant_key', tenantKey)
      .eq('task', task)
      .eq('snapshot_hash', snapshotHash)
      .maybeSingle();
    if (cached?.updated_at && (Date.now() - new Date(cached.updated_at as string).getTime()) < CACHE_TTL_MS) {
      return new Response(JSON.stringify({
        ...(cached.result as Record<string, unknown>),
        citations: cached.citations || [],
        model: cached.model,
        cached: true,
        updatedAt: cached.updated_at,
      }), { headers: jsonHeaders });
    }
  }

  try {
    const { structured, citations, groundingMetadata } = await callGemini(task, context, apiKey);
    if (db) {
      await db.from('ai_suggestions').upsert({
        tenant_key: tenantKey,
        task,
        snapshot_hash: snapshotHash,
        result: structured,
        citations,
        model: GEMINI_MODEL,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_key,task,snapshot_hash' });
    }
    return new Response(JSON.stringify({
      ...structured,
      citations,
      groundingMetadata,
      model: GEMINI_MODEL,
      cached: false,
    }), { headers: jsonHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `AI call failed: ${message}`, configured: true }), {
      status: 500, headers: jsonHeaders,
    });
  }
});
