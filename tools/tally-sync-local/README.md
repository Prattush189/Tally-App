# Tally local sync

Pulls Tally data through the `103.76.213.243` RemoteApp portal and pushes a snapshot to Supabase. Runs on a laptop — no tunnel, no host cooperation, no public IP needed.

## Why this exists

The Tally HTTP API (`:9007`) is only reachable **inside the portal's RemoteApp session**. A cloud Edge Function can't see it. This tool drives a real browser through the same login + click-TallyPrime flow a human does, queries Tally from within that session, and uploads the result. Dashboards then read the snapshot from Supabase.

## One-time setup

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
