import { useState, useEffect, useCallback } from 'react';
import { requestAISuggestions, AI_AVAILABLE } from '../lib/aiClient';
import { useTallyData } from '../context/TallyDataContext';

// React hook for the six Actions & Outreach pages. Calls the Gemini edge
// function with a live Tally snapshot summary, handles loading + error +
// not-configured states, and exposes a refresh function for a "Regenerate"
// button. The edge function caches for 1 hour, so repeated visits are
// cheap; forceRefresh=true asks for a fresh generation.
export function useAISuggestions(task) {
  const { customers } = useTallyData();
  const [state, setState] = useState({
    loading: AI_AVAILABLE,
    data: null,
    error: null,
    configured: null,
    cached: false,
  });

  const run = useCallback(async (forceRefresh = false) => {
    if (!AI_AVAILABLE) {
      setState({ loading: false, data: null, error: null, configured: false, cached: false });
      return;
    }
    if (!customers.length) {
      setState({ loading: false, data: null, error: 'Sync your Tally data first — AI needs real customers to reason about.', configured: null, cached: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const result = await requestAISuggestions({ task, customers, forceRefresh });
    const configured = result.configured !== false;
    setState({
      loading: false,
      data: result.error ? null : result,
      error: result.error || null,
      configured,
      cached: Boolean(result.cached),
      setupHint: result.setupHint || null,
    });
  }, [task, customers]);

  useEffect(() => { run(false); }, [run]);

  return { ...state, refresh: () => run(true) };
}
