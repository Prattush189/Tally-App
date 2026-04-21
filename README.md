# B2B Customer Intelligence Dashboard

Invoice-driven analytics platform for **UNITED AGENCIES DISTRIBUTORS LLP** — powered by Tally Prime 7.0 live data.

## Features

- **22+ Analytics Modules**: Overview, Churn Detection, Payment Health, Growth Engine, Opportunities, Revenue Metrics, Proactive System, Action Focus, Advanced Analytics, India Map, Purchase Forecast, Toy Categories, Area SKU Analysis, Contact Priority, New Dealer Suggestions, Payment Reminders, Revenue Suggestions, Customer Health, Inventory Budget, Marketing Budget, Dealer Analytics with AI Suggestions
- **Tally Prime 7.0 Integration**: Live XML API connection to pull real data (Sundry Debtors, Sales/Receipt Vouchers, Stock Items)
- **AI-Powered Suggestions**: Per-dealer retention, cross-sell, payment, and growth recommendations
- **Dark Theme Dashboard**: Professional glass-card UI with Recharts visualizations

## Quick Start

### Server
```bash
cd server
npm install
cp .env.example .env   # Edit with your Tally credentials
node server.js
```

### Client
```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173

### Login Credentials
- **Admin**: admin@b2bintel.com / admin123
- **Demo**: demo@b2bintel.com / demo2026

## Tally Connection

1. Ensure Tally Prime is running with XML Server enabled
2. Go to **Tally Sync** page in the dashboard
3. Enter your Tally Host, Port, Username, and Password
4. Click **Test Connection** → then **Sync Now**

## Tech Stack

- **Frontend**: React 18 + Vite + Tailwind CSS + Recharts + Lucide Icons
- **Backend**: Express.js + JWT Auth + Tally XML API Connector
- **Data**: Live from Tally Prime 7.0 (falls back to mock data if unreachable)
