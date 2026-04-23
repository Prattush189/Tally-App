import { Sparkles, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { useAISuggestions } from '../../hooks/useAISuggestions';

// Shared AI insights card. Any Actions & Outreach page drops <AIInsights
// task="action-focus" /> and gets: loading state, error state, not-
// configured state, cached badge, Gemini-generated bullets with Google
// Search citations, and a Regenerate button. The per-page deterministic
// content still renders above/below this card; AI augments it, it doesn't
// replace it.
//
// Styling matches the dark-glass vocabulary of the rest of the app. Icons
// and layout are lucide-react + tailwind only — no new deps.

const priorityStyles = {
  Critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  High: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  Medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Low: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
};

export default function AIInsights({ task, title = 'AI Insights', subtitle }) {
  const { loading, data, error, configured, cached, setupHint, refresh } = useAISuggestions(task);

  return (
    <div className="glass-card p-5 border-l-4 border-indigo-500/60">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-indigo-300" />
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-xs text-gray-400">
              {subtitle || 'Gemini 2.5 Flash with Google Search grounding — generated from your live Tally data.'}
            </p>
          </div>
        </div>
        <button onClick={refresh} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10 flex items-center gap-1.5 disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {cached && !loading ? 'Regenerate' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="text-xs text-gray-400 animate-pulse">Generating insights — grounded web search can take 15–40s…</div>
      )}

      {!loading && configured === false && (
        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-300">AI not configured</p>
            <p className="mt-1">{setupHint || 'Set GEMINI_API_KEY in Supabase secrets to enable AI insights.'}</p>
          </div>
        </div>
      )}

      {!loading && error && configured !== false && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-200">
          {error}
        </div>
      )}

      {!loading && data?.summary && (
        <p className="text-sm text-gray-200 leading-relaxed mb-3">{data.summary}</p>
      )}

      {!loading && Array.isArray(data?.suggestions) && data.suggestions.length > 0 && (
        <div className="space-y-3">
          {data.suggestions.map((s, i) => (
            <div key={i} className="p-3 rounded-lg bg-gray-900/40 border border-gray-700/40">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-sm font-semibold text-white">{s.title}</p>
                {s.priority && (
                  <span className={`px-2 py-0.5 rounded-full text-[11px] border ${priorityStyles[s.priority] || priorityStyles.Low}`}>
                    {s.priority}
                  </span>
                )}
              </div>
              {s.target && <p className="text-xs text-indigo-300 mb-1">{s.target}</p>}
              {s.rationale && <p className="text-xs text-gray-300 leading-relaxed mb-2">{s.rationale}</p>}
              {s.impact && <p className="text-xs text-emerald-300 mb-2">Impact: {s.impact}</p>}
              {Array.isArray(s.actions) && s.actions.length > 0 && (
                <ul className="text-xs text-gray-400 list-disc list-inside space-y-0.5">
                  {s.actions.map((a, ai) => <li key={ai}>{a}</li>)}
                </ul>
              )}
              {Array.isArray(s.citations) && s.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.citations.map((c, ci) => (
                    <a key={ci} href={c} target="_blank" rel="noreferrer"
                      className="text-[11px] text-cyan-300/80 hover:text-cyan-200 flex items-center gap-0.5 underline underline-offset-2">
                      source <ExternalLink size={10} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && Array.isArray(data?.citations) && data.citations.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700/40">
          <p className="text-[11px] text-gray-500 mb-1.5">Sources consulted via Google Search:</p>
          <div className="flex flex-wrap gap-2">
            {data.citations.slice(0, 8).map((c, i) => (
              <a key={i} href={c.uri || c} target="_blank" rel="noreferrer"
                className="text-[11px] text-cyan-300/80 hover:text-cyan-200 flex items-center gap-0.5 underline underline-offset-2 max-w-xs truncate">
                {c.title || c.uri || c} <ExternalLink size={10} />
              </a>
            ))}
          </div>
        </div>
      )}

      {cached && !loading && (
        <p className="text-[11px] text-gray-500 mt-3">Cached result — click Regenerate for a fresh pass.</p>
      )}
    </div>
  );
}
