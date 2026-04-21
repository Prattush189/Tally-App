# B2B Customer Intelligence Dashboard

Invoice-driven analytics platform for **UNITED AGENCIES DISTRIBUTORS LLP** — powered by Tally Prime 7.0 live data.

## Features

- **22+ Analytics Modules**: Overview, Churn Detection, Payment Health, Growth Engine, Opportunities, Revenue Metrics, Proactive System, Action Focus, Advanced Analytics, India Map, Purchase Forecast, Toy Categories, Area SKU Analysis, Contact Priority, New Dealer Suggestions, Payment Reminders, Revenue Suggestions, Customer Health, Inventory Budget, Marketing Budget, Dealer Analytics with AI Suggestions
- **Tally Prime 7.0 Integration**: Live XML API connection to pull real data (Sundry Debtors, Sales/Receipt Vouchers, Stock Items)
- **AI-Powered Suggestions**: Per-dealer retention, cross-sell, payment, and growth recommendations
- **Dark Theme Dashboard**: Professional glass-card UI with Recharts visualizations
- **Self-Serve Accounts**: Users register and sign in from the UI — no pre-seeded credentials.

## Deployment modes

The client is a single Vite React app that picks its backend at build time. All modes are supported simultaneously — pick whichever env vars to set.

| Mode | Env vars at build time | Auth | Dashboards | Tally Sync |
|---|---|---|---|---|
| **Static (Pages default)** | _none_ | In-browser PBKDF2 (accounts in `localStorage`) | Client-side mock analytics | Disabled |
| **Supabase** | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase Auth (persistent across devices) | Client-side mock analytics | Via `tally` Edge Function |
| **Dedicated server** | `VITE_API_URL` | Express JWT | Express routes | Express → Tally |

Priority order if multiple are set: **Supabase > Dedicated server > Static**.

## GitHub Pages deployment

Push to `main` → the `Deploy client to GitHub Pages` workflow builds and publishes the client.

1. **Settings → Pages → Source** = **GitHub Actions** (one-time).
2. Add the env vars you need as **repository variables** (Settings → Secrets and variables → Actions → Variables):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` to enable Supabase Auth.
   - `VITE_API_URL` to point at a dedicated Express backend (e.g. `https://api.example.com/api`).
3. Push to `main` or run the workflow manually. The site publishes at `https://<your-username>.github.io/Tally-App/`.

## Supabase setup

The default Supabase project URL + anon key are hardcoded in `client/src/utils/supabase.js`
so the Pages build works with zero CI configuration. To point at a different project, set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as GitHub Actions repository variables
(they override the defaults).

> The anon key is safe to ship in the client bundle — Supabase's security is enforced by
> Row Level Security policies, not key secrecy. **Never** commit the postgres connection
> string or the `service_role` key; rotate them in the Supabase dashboard if they leak.

Auth → Providers → Email: enable. For easier demos, also disable "Confirm email".

### Tally Edge Function (one-time)

For Tally Sync to work, deploy the `tally` Edge Function. The project ref is pinned in
`supabase/config.toml`, so after the first `supabase link` every command is just:

```bash
bash supabase/deploy.sh
```

Or manually:
```bash
npm install -g supabase
supabase login
supabase link --project-ref vqusztwxrjokjgkiebem
supabase functions deploy tally
# Optional — set default Tally creds so users don't retype them:
supabase secrets set TALLY_HOST=1.2.3.4:9000 TALLY_USERNAME=admin TALLY_PASSWORD=secret
```

Tally is proxied through the Edge Function so the browser never hits Tally's XML endpoint
directly (no CORS, no credential exposure). The function accepts per-request overrides for
`host`, `username`, `password`, `company`, and falls back to secrets when unset. JWT
verification is on, so only signed-in dashboard users can invoke it.

## Dedicated Express server (optional)

The `server/` directory remains intact as an alternative backend. Deploy it to Railway, Fly.io, a VPS, etc. and set `VITE_API_URL` to the resulting origin (e.g. `https://api.example.com/api`).

```bash
cd server
npm install
cp .env.example .env   # Set JWT_SECRET (required in production), Tally creds, CORS_ORIGIN
npm start
```

## Local development

### Client only (no backend)
```bash
cd client && npm install && npm run dev
```
Open http://localhost:5173 and register — everything runs in the browser.

### Client + Express server
```bash
# Terminal 1
cd server && npm install && npm start
# Terminal 2 — proxies /api/* to :3001 via vite.config.js
cd client && npm install && npm run dev
```

## Accounts

There are no default accounts. Open the app and click **Create account** to register.

- In static / Express mode: the very first account becomes `admin`; subsequent accounts default to `viewer`.
- In Supabase mode: roles are stored in `user_metadata` — promote users to `admin` via the Supabase dashboard.

## Tech Stack

- **Frontend**: React 18 + Vite + Tailwind CSS + Recharts + Lucide Icons
- **Auth**: Supabase Auth or Express/JWT or in-browser PBKDF2-SHA256
- **Data**: Tally Prime 7.0 live (via Supabase Edge Function or Express) with mock fallback
- **CI/CD**: GitHub Actions (build + deploy to Pages, syntax check on PRs)
