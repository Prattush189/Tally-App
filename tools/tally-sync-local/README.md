# Tally sync

Pulls Tally data through the `103.76.213.243` RemoteApp portal and pushes a snapshot to Supabase. The same script runs in two modes — **scheduled web (recommended)** and **local laptop (debug / fallback)**.

## Why this exists

The Tally HTTP API (`:9007`) is only reachable **inside the portal's RemoteApp session**. A cloud Edge Function can't see it. This tool drives a real Chromium through the same login + click-TallyPrime flow a human does, queries Tally from within that session, and uploads the result. Dashboards then read the snapshot from Supabase.

## Web-only setup (scheduled, no laptop)

Runs hourly in GitHub Actions — zero user machine involvement after setup. Admins edit creds via the TallySync page.

1. **Set Supabase secrets** (one machine, once):
   ```
   supabase secrets set \
     LOCAL_SYNC_TOKEN=<long random string> \
     GITHUB_SYNC_PAT=<GitHub PAT with 'workflow' scope> \
     GITHUB_REPO_OWNER=Prattush189 \
     GITHUB_REPO_NAME=Tally-App
   ```
   `LOCAL_SYNC_TOKEN` gates the admin UI. `GITHUB_SYNC_PAT` powers the "Trigger Sync Now" button (https://github.com/settings/tokens → fine-grained → `Actions: read & write` on Tally-App repo).

2. **Add GitHub Actions secrets** (repo Settings → Secrets and variables → Actions):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   - `LOCAL_SYNC_TOKEN` (same value as Supabase secret)
   - `SUPABASE_DB_PASSWORD` (once, for migrations)

3. **In the web app → TallySync page → Scheduled Sync card**:
   - Paste `LOCAL_SYNC_TOKEN` into admin token (cached in localStorage after save)
   - Fill portal URL / user / password / Tally company
   - **Save Configuration**, then **Trigger Sync Now**
   - ~2 min later dashboards hydrate. Hourly cron keeps them fresh.

To watch a run live: GitHub → Actions → "Tally Scheduled Sync" → latest.

If the portal blocks GitHub runner IPs (HTTP 403 on login), fall back to local mode below.

## Local laptop mode (debug / fallback)

1. Install Node 18+ — `node -v` to check.
2. From this directory:
   ```
   npm install
   ```
   That pulls Playwright and downloads Chromium (~170 MB, one-time).
3. Copy `.env.example` → `.env` and fill in:
   ```
   SUPABASE_URL=https://vqusztwxrjokjgkiebem.supabase.co
   SUPABASE_ANON_KEY=<project anon key>
   LOCAL_SYNC_TOKEN=<matches the one set on the edge function>
   ```
4. On your machine that deploys the Edge Function, set the server-side secrets once:
   ```
   supabase secrets set \
     LOCAL_SYNC_TOKEN=<pick any long random string> \
     TALLY_PORTAL_URL=http://103.76.213.243 \
     TALLY_PORTAL_USER=united5 \
     TALLY_PORTAL_PASS='HBS@239' \
     TALLY_COMPANY='UNITED AGENCIES DISTRIBUTORS LLP'
   ```
   The `LOCAL_SYNC_TOKEN` must match the one you put in `.env` — it's the shared secret that gates `get-config` + `ingest` so random anon-key callers can't pull creds or overwrite snapshots.

## Running a sync

```
npm run sync
```

Headless browser, ~2 min wall clock. On success you'll see:
```
✓ Snapshot written. Counts:
  ledgers          42
  salesVouchers    318
  receiptVouchers  201
  stockItems       185
  stockGroups      27
```
Open the web app → TallySync page → the dashboards auto-load the snapshot, or hit **Load Cloud Snapshot** to force a refresh.

## Debugging

If the script can't find the "TallyPrime" icon on the launcher page (portal's DOM sometimes changes):
```
npm run sync:headed
```
Opens a visible Chromium. You'll see the login + launcher page; click TallyPrime manually and the script keeps polling `:9007` until it responds.

If you see `Portal login rejected`, the portal creds are wrong or expired. Reset via `supabase secrets set TALLY_PORTAL_PASS=...`.

## Making it run automatically

The script is stateless, idempotent, and safe to run on a cron. On macOS, launchd is simplest:

1. Save `~/Library/LaunchAgents/com.tally.sync.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key><string>com.tally.sync</string>
     <key>ProgramArguments</key>
     <array>
       <string>/usr/local/bin/node</string>
       <string>/Users/YOURNAME/path/to/tally-sync-local/sync.mjs</string>
     </array>
     <key>WorkingDirectory</key><string>/Users/YOURNAME/path/to/tally-sync-local</string>
     <key>StartInterval</key><integer>1800</integer>
     <key>StandardOutPath</key><string>/tmp/tally-sync.log</string>
     <key>StandardErrorPath</key><string>/tmp/tally-sync.err</string>
   </dict>
   </plist>
   ```
2. `launchctl load ~/Library/LaunchAgents/com.tally.sync.plist`
3. Tail `/tmp/tally-sync.log` for runs.

That gives you a fresh snapshot every 30 min while your Mac is awake.

## Data flow

```
 [Laptop: sync.mjs] -> GET portal/creds from Supabase (syncToken-gated)
        |
        v
 [Chromium via Playwright] -> POST /cgi-bin/hb.exe  (login)
                           -> GET  /software/html5.html
                           -> click TallyPrime
                           -> POST http://103.76.213.243:9007/  (XML × 5)
        |
        v
 [Laptop: sync.mjs] -> POST Supabase 'ingest' with {data, counts, errors}
        |
        v
 [Supabase] -> upsert tally_snapshots (tenant_key='default')
        |
        v
 [Web app] -> GET 'get-snapshot' on page load -> transforms into dashboard data
```
