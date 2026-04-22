-- Per-collection sync metadata on tally_snapshots.
--
-- Shape: { ledgers: { updated_at, count, error }, salesVouchers: {...}, ... }
-- The edge function reads this to:
--   * skip collections synced within TTL on the next sync (idempotency —
--     same data isn't re-fetched every time)
--   * resume from where a previous sync was interrupted (only stale /
--     errored / never-synced collections get fetched)
--   * surface "ledgers synced 5 min ago" badges in the UI
--
-- ingest + sync-full both merge into this rather than overwriting the whole
-- row, so a partial success now accumulates across multiple runs instead of
-- clobbering prior good data.
ALTER TABLE public.tally_snapshots
  ADD COLUMN IF NOT EXISTS collection_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
