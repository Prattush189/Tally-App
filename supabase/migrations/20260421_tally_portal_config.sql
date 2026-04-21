-- Portal + Tally credentials for the scheduled web-only sync.
--
-- Admins save creds once via the TallySync UI (gated on LOCAL_SYNC_TOKEN) and
-- from then on the hourly GitHub Actions cron + manual "Trigger Sync Now"
-- button both read the same row. Replaces the need for `supabase secrets set`
-- every time a password rotates.
--
-- Same RLS posture as tally_snapshots: zero policies, so only service_role
-- (used by the edge function) can read / write. The UI never touches this
-- table directly — it goes through the edge function's save-config action.
CREATE TABLE IF NOT EXISTS public.tally_portal_config (
  tenant_key TEXT PRIMARY KEY,
  portal_url TEXT NOT NULL,
  portal_user TEXT NOT NULL,
  portal_pass TEXT NOT NULL,
  tally_host TEXT NOT NULL DEFAULT '',
  tally_user TEXT NOT NULL DEFAULT '',
  tally_pass TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

ALTER TABLE public.tally_portal_config ENABLE ROW LEVEL SECURITY;
