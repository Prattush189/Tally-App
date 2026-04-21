# B2B Customer Intelligence Dashboard

Invoice-driven analytics platform for **UNITED AGENCIES DISTRIBUTORS LLP** — powered by Tally Prime 7.0 live data.

## Features

- **22+ Analytics Modules**: Overview, Churn Detection, Payment Health, Growth Engine, Opportunities, Revenue Metrics, Proactive System, Action Focus, Advanced Analytics, India Map, Purchase Forecast, Toy Categories, Area SKU Analysis, Contact Priority, New Dealer Suggestions, Payment Reminders, Revenue Suggestions, Customer Health, Inventory Budget, Marketing Budget, Dealer Analytics with AI Suggestions
- **Tally Prime 7.0 Integration**: Live XML API connection to pull real data (Sundry Debtors, Sales/Receipt Vouchers, Stock Items)
- **AI-Powered Suggestions**: Per-dealer retention, cross-sell, payment, and growth recommendations
- **Dark Theme Dashboard**: Professional glass-card UI with Recharts visualizations
- **Self-Serve Accounts**: Users register and sign in from the UI — no pre-seeded credentials.

## Accounts

There are no default accounts. Open the app and click **Create account** to register.

- The very first account created on a fresh server becomes an `admin`.
- Subsequent accounts are created with the `viewer` role by default.

## Quick Start

### Server
```bash
cd server
npm install
cp .env.example .env   # Edit and set JWT_SECRET + (optional) Tally credentials
npm start
```

### Client
```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173 and register your first account.

## GitHub Pages Deployment

The client can be deployed as a static site via GitHub Pages. On every push to `main`, the `Deploy client to GitHub Pages` workflow builds the client and publishes it.

To enable:

1. Go to **Settings → Pages** in your GitHub repository.
2. Under **Source**, select **GitHub Actions**.
3. Push to `main` (or run the workflow manually). The site publishes at `https://<your-username>.github.io/Tally-App/`.

### Static-only vs connected mode

- **Static-only (default for GitHub Pages)** — no backend is required. User registration and login run entirely in the browser using the Web Crypto API (PBKDF2-SHA256). Accounts live in the visitor's own `localStorage`.
- **Connected mode** — set the repository variable `VITE_API_URL` (Settings → Secrets and variables → Actions → Variables) to your deployed backend URL (for example, `https://api.example.com/api`). The workflow injects it at build time and the client will authenticate against your Express server.

## Tally Connection

1. Ensure Tally Prime is running with XML Server enabled.
2. Go to the **Tally Sync** page in the dashboard.
3. Enter your Tally Host, Port, Username, and Password.
4. Click **Test Connection** → then **Sync Now**.

## Tech Stack

- **Frontend**: React 18 + Vite + Tailwind CSS + Recharts + Lucide Icons
- **Backend**: Express.js + JWT Auth + Tally XML API Connector
- **Data**: Live from Tally Prime 7.0 (falls back to mock data if unreachable)
