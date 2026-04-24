-- Per-key snapshot merge RPCs.
--
-- sync-full persists one collection at a time so the Deno worker only holds
-- one parse tree in memory. But the previous per-job path (merge via
-- SELECT + spread + UPSERT in the edge function) pulled the full existing
-- snapshot back on every merge. Once Day Book had been persisted, every
-- subsequent merge re-downloaded tens of MB of JSONB, spread-copied it,
-- and re-uploaded the full blob — which blew Supabase's 150 MB compute
-- cap and returned "Function failed due to not having enough compute
-- resources" even though the Tally queries themselves had succeeded.
--
-- These RPCs move the merge into PostgreSQL so the edge function only
-- sends the NEW key's data. jsonb || jsonb is O(keys) server-side; the
-- edge worker's peak memory becomes exactly one parse tree + its JSON
-- serialization, never the accumulated snapshot.

CREATE OR REPLACE FUNCTION public.merge_tally_snapshot_key(
  p_tenant_key text,
  p_company text,
  p_key text,
  p_data jsonb,
  p_count integer,
  p_source text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_meta jsonb := jsonb_build_object(
    p_key,
    jsonb_build_object('updated_at', v_now, 'count', p_count, 'error', null)
  );
BEGIN
  INSERT INTO public.tally_snapshots (
    tenant_key, company, data, counts, errors, collection_meta, source, updated_at
  ) VALUES (
    p_tenant_key,
    p_company,
    jsonb_build_object(p_key, p_data),
    jsonb_build_object(p_key, p_count),
    '{}'::jsonb,
    v_meta,
    p_source,
    v_now
  )
  ON CONFLICT (tenant_key, company) DO UPDATE SET
    data = COALESCE(tally_snapshots.data, '{}'::jsonb) || jsonb_build_object(p_key, p_data),
    counts = COALESCE(tally_snapshots.counts, '{}'::jsonb) || jsonb_build_object(p_key, p_count),
    errors = COALESCE(tally_snapshots.errors, '{}'::jsonb) - p_key,
    collection_meta = COALESCE(tally_snapshots.collection_meta, '{}'::jsonb) || v_meta,
    source = p_source,
    updated_at = v_now;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_tally_snapshot_key(text, text, text, jsonb, integer, text)
  TO service_role;

-- Batch-record per-collection errors without touching `data` or `counts`.
-- Used by sync-full at the end of a run to flush aggregated failures
-- (previously another full-row download + spread + upsert).
CREATE OR REPLACE FUNCTION public.record_tally_snapshot_errors(
  p_tenant_key text,
  p_company text,
  p_errors jsonb,
  p_source text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_meta jsonb := '{}'::jsonb;
  v_key text;
  v_err text;
BEGIN
  IF p_errors IS NULL OR jsonb_typeof(p_errors) <> 'object' THEN
    RETURN;
  END IF;
  FOR v_key, v_err IN SELECT key, value::text FROM jsonb_each_text(p_errors) LOOP
    v_meta := v_meta || jsonb_build_object(
      v_key,
      jsonb_build_object('error', v_err)
    );
  END LOOP;

  INSERT INTO public.tally_snapshots (
    tenant_key, company, data, counts, errors, collection_meta, source, updated_at
  ) VALUES (
    p_tenant_key,
    p_company,
    '{}'::jsonb,
    '{}'::jsonb,
    p_errors,
    v_meta,
    p_source,
    v_now
  )
  ON CONFLICT (tenant_key, company) DO UPDATE SET
    errors = COALESCE(tally_snapshots.errors, '{}'::jsonb) || p_errors,
    collection_meta = COALESCE(tally_snapshots.collection_meta, '{}'::jsonb) || v_meta,
    source = p_source,
    updated_at = v_now;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_tally_snapshot_errors(text, text, jsonb, text)
  TO service_role;
