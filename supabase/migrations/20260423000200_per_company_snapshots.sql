-- Multi-company support: snapshot per (tenant, company) pair.
--
-- Context: the user's Tally portal has 4 companies loaded (GIRNAR KIDS PLAY
-- LLP, UNITED AGENCIES DISTRIBUTORS LLP, ...). Before this migration the
-- snapshot was keyed by tenant_key alone, so syncing a second company would
-- overwrite the first. Extend the primary key to (tenant_key, company) so
-- every company has its own row and dashboards can switch between them
-- without re-syncing.
--
-- Strategy:
-- 1. Add a `company` column with a placeholder default so existing rows
--    don't fail the NOT NULL constraint on upgrade.
-- 2. Drop the existing PK on tenant_key.
-- 3. Add a new composite PK (tenant_key, company).
--
-- The ingest + sync-full actions key on body.company || (fallback)
-- tally_portal_config.company, so existing callers keep working: they just
-- start writing to tenant_key + the company they're already using.

ALTER TABLE public.tally_snapshots
  ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT '';

-- Drop old PK (was on tenant_key alone) and re-add as composite. IF EXISTS
-- makes the migration idempotent.
ALTER TABLE public.tally_snapshots
  DROP CONSTRAINT IF EXISTS tally_snapshots_pkey;

ALTER TABLE public.tally_snapshots
  ADD PRIMARY KEY (tenant_key, company);

-- Cache of companies seen on the portal for a given tenant_key. Written by
-- the list-companies action after a successful Tally ping; read by the UI
-- to populate the company dropdown. One row per tenant.
CREATE TABLE IF NOT EXISTS public.tally_companies (
  tenant_key TEXT PRIMARY KEY,
  companies JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_company TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tally_companies ENABLE ROW LEVEL SECURITY;
