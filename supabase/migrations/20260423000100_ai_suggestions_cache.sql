-- Cache table for Gemini-generated AI suggestions. Keyed by tenant + task +
-- a hash of the data slice the model was shown, so we only re-bill when the
-- underlying Tally snapshot actually changed. TTL is enforced in the edge
-- function (currently 1 hour) — the updated_at column is what the function
-- compares against the current time.

create table if not exists public.ai_suggestions (
  tenant_key text not null,
  task text not null,
  snapshot_hash text not null,
  result jsonb not null,
  citations jsonb,
  model text,
  updated_at timestamptz not null default now(),
  primary key (tenant_key, task, snapshot_hash)
);

create index if not exists ai_suggestions_tenant_task_idx
  on public.ai_suggestions (tenant_key, task, updated_at desc);

-- Row Level Security off by design: the edge function talks with the service-
-- role key only. Every other access path is blocked by RLS defaults on new
-- tables in the project.
alter table public.ai_suggestions enable row level security;
