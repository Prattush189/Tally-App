#!/usr/bin/env bash
# One-time Supabase setup + deploy for the Tally Edge Function.
# Run from the repo root: bash supabase/deploy.sh
#
# Requires the Supabase CLI: https://supabase.com/docs/guides/cli
# macOS:   brew install supabase/tap/supabase
# Linux:   npm install -g supabase
# Windows: scoop install supabase

set -euo pipefail

PROJECT_REF="vqusztwxrjokjgkiebem"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found. Install it first — see the header of this script."
  exit 1
fi

echo "→ Logging in (skip if already logged in)..."
supabase login || true

echo "→ Linking project ${PROJECT_REF}..."
supabase link --project-ref "${PROJECT_REF}" || true

echo "→ Deploying 'tally' Edge Function..."
supabase functions deploy tally --project-ref "${PROJECT_REF}"

cat <<'EOF'

Done. Optional next step — set default Tally credentials as function secrets
so users don't have to type host/user/pass on every sync:

  supabase secrets set \
    TALLY_HOST=your.tally.host:9000 \
    TALLY_USERNAME=admin \
    TALLY_PASSWORD='yourpassword' \
    TALLY_COMPANY='UNITED AGENCIES DISTRIBUTORS LLP'

Per-request values from the Tally Sync UI always override the secrets.
EOF
