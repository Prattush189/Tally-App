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

1. Create a project at [supabase.com](https://supabase.com). Copy the **Project URL** and **anon key** from Settings → API.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as GitHub Actions repo variables (see above).
3. Auth → Providers → Email: enable. Optionally disable email confirmation for easier demos.
4. (For Tally Sync) deploy the Edge Function:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase functions deploy tally
   # Optional defaults (can also be passed per-request from the UI):
   npx supabase secrets set TALLY_HOST=1.2.3.4:9000 TALLY_USERNAME=admin TALLY_PASSWORD=secret
   ```
5. Re-run the GitHub Pages workflow. Your dashboard now signs users into Supabase and — when you click **Tally Sync → Test Connection** — the browser calls the Edge Function, which reaches Tally on your behalf.

> Tally is proxied through the Edge Function so the browser never hits Tally's XML endpoint directly (no CORS, no credential exposure). The function accepts per-request overrides for `host`, `username`, `password`, `company`, and falls back to secrets when unset.

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
