import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import analyticsRoutes from './routes/analytics.js';
import extendedRoutes from './routes/extended.js';
import tallyRoutes from './routes/tally.js';
import { getDashboardData, getDataStatus } from './tally/dataManager.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Attempt Tally connection on startup (non-blocking)
getDashboardData().then(data => {
  console.log(`  Data source: ${data.source.toUpperCase()} (${data.customers?.length || 0} customers)`);
}).catch(() => {
  console.log('  Data source: MOCK (Tally unreachable)');
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/extended', extendedRoutes);
app.use('/api/tally', tallyRoutes);

// Health check
app.get('/api/health', (req, res) => {
  const status = getDataStatus();
  res.json({
    status: 'ok',
    version: '2.0.0',
    dataSource: status.source,
    tallyConnected: status.connected,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  B2B Intelligence API Server v2.0`);
  console.log(`  Running on http://localhost:${PORT}`);
  console.log(`  Tally: ${process.env.TALLY_HOST ? `http://${process.env.TALLY_HOST}` : 'Not configured (set TALLY_HOST or use Tally Sync page)'}`);
  console.log(`  Health: http://localhost:${PORT}/api/health\n`);
});
