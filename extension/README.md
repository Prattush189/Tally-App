# Tally Dashboard Sync — Chrome extension

A browser-only path to push Tally data to the dashboard. No terminal, no Node, no Playwright. You log into the portal, click TallyPrime as usual, then click one extra button on the page — the extension grabs the data and pushes it to Supabase.

## How it works

Extensions are allowed to bypass browser CORS / mixed-content rules for origins listed in `host_permissions`. That's the trick: a pure web app can't fetch `http://103.76.213.243:9007/` from `https://…github.io`, but an extension with `"host_permissions": ["http://103.76.213.243/*"]` can.

Flow:
1. You open `http://103.76.213.243/`, log in, click **TallyPrime**
2. The extension has already injected a teal **↻ Sync to Dashboard** button at bottom-right
3. Click it → the extension fetches the 5 XML collection queries from `:9007`, POSTs them to the Supabase edge function (`action: 'ingest'` with `rawXml`), edge function parses them server-side and upserts `tally_snapshots`
4. Toast: *"✓ Synced · 42 ledgers · 318 sales · 201 receipts · 185 stock items · 27 stock groups"*
5. Open the dashboard — data's there.

## Install (one-time, on any computer)

**Option A — Unpacked (for dev / first-time testing):**
1. Download this repo (or just the `extension/` folder)
2. Open `chrome://extensions` → toggle **Developer mode** on (top-right)
3. Click **Load unpacked** → select the `extension/` folder
4. The extension's icon now appears in the Chrome toolbar. Pin it for easy access.

**Option B — Chrome Web Store:** not yet published. Use Option A for now.

## Configure (one-time, per browser)

**Option A — auto-configure from the dashboard (recommended):**
1. Open the B2B Intelligence dashboard → **TallySync** page → **Scheduled Sync (Cloud)** card
2. Paste the sync token once in the admin token field (if not already there)
3. A green "Chrome extension detected" banner appears with a **Configure extension** button — click it
4. The dashboard pushes its Supabase URL, anon key, sync token, and company to the extension. Done.

**Option B — manual, via the extension popup:**
1. Click the extension's toolbar icon → settings popup opens
2. Fill in:
   - **Supabase URL** — `https://vqusztwxrjokjgkiebem.supabase.co`
   - **Supabase anon key** — from https://supabase.com/dashboard/project/vqusztwxrjokjgkiebem/settings/api (anon public)
   - **Sync token** — matches `LOCAL_SYNC_TOKEN` you set via `supabase secrets set`
   - **Tally company** — e.g. `UNITED AGENCIES DISTRIBUTORS LLP`
   - **Tenant key** — leave as `default`
3. Click **Save**

Config lives in `chrome.storage.local` — not synced to any cloud.

### How auto-configure works

The extension's `bridge.js` content script runs on the dashboard's origins (`prattush189.github.io` + `localhost` + `127.0.0.1` in dev). It listens for `window.postMessage` events whose `source` field is `tally-dashboard`. The dashboard sends a `setConfig` message containing everything except nothing already on the page won't know (the sync token still comes from the admin's paste). The extension stores it in `chrome.storage.local` — same place the manual popup writes to. Both flows produce identical state.

If you fork and host the dashboard elsewhere, add your origin to `extension/manifest.json` → `content_scripts[1].matches` and reload the extension.

## Using it

1. Visit `http://103.76.213.243/` in the same browser
2. Log in, go to the launcher page, click TallyPrime — wait for the RemoteApp session to open
3. Click **↻ Sync to Dashboard** (bottom-right floating button on the portal page)
4. Wait ~30 seconds. Toast confirms the counts.
5. Refresh your dashboard tab — fresh data.

If the button says Tally isn't responding, you haven't actually started TallyPrime yet — go back to the launcher and click it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sync button doesn't appear | Content script didn't inject | Make sure the URL is exactly `http://103.76.213.243/…`. Reload the tab. Check `chrome://extensions` → the extension is enabled. |
| "Configure the extension first" toast | No settings saved | Click the toolbar icon, fill the form, Save |
| "Invalid syncToken" | Token in extension ≠ Supabase `LOCAL_SYNC_TOKEN` | Copy both fresh from a single source |
| "Tally isn't responding on :9007" | RemoteApp not started | Go to launcher page → click TallyPrime → wait 10s → try again |
| All 5 collections have errors, first few succeeded | Portal connection limit | Retry; the extension paces at 1.5s between calls which usually avoids this |

## Files

- `manifest.json` — MV3 manifest, host_permissions list
- `queries.js` — Tally XML request builders (mirror of `tools/tally-sync-local/queries.mjs`)
- `content.js` — injects button, runs sync
- `content.css` — button + toast styles
- `popup.html` / `popup.js` / `popup.css` — settings form
