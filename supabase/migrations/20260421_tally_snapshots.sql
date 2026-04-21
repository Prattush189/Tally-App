-- Persisted Tally sync output.
--
-- A single row per tenant holds the most recent raw XML-parsed JSON blobs
-- pulled from Tally (ledgers, salesVouchers, receiptVouchers, stockItems,
-- stockGroups) plus the per-collection counts / errors map. Dashboards read
-- this row on load so they don't need a live connection to Tally on every
-- page render, and the local Playwright sync tool writes into it.
--
-- The edge function's tally credentials live in Deno env secrets and the
-- function uses the service role to read/write this table, so RLS is kept
-- on with zero policies — anon/auth roles can't touch it at all.
CREATE TABLE IF NOT EXISTS public.tally_snapshots (
  tenant_key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'unknown',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tally_snapshots ENABLE ROW LEVEL SECURITY;
