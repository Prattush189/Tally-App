import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getDashboardData, getDataStatus, refreshFromTally } from '../tally/dataManager.js';
import { getCompanyInfo, updateConfig } from '../tally/tallyConnector.js';

const router = Router();
router.use(authenticateToken);

// GET /api/tally/status — current data source status
router.get('/status', (req, res) => {
  res.json(getDataStatus());
});

// POST /api/tally/test — test Tally connection (accepts config from frontend)
router.post('/test', async (req, res) => {
  try {
    const { host, username, password } = req.body || {};
    // Temporarily apply config for this test
    if (host || username) {
      updateConfig({ host, username, password });
    }
    const info = await getCompanyInfo();
    res.json({ connected: true, response: info });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// POST /api/tally/sync — force refresh from Tally (accepts config from frontend)
router.post('/sync', async (req, res) => {
  try {
    const { host, username, password } = req.body || {};
    if (host || username) {
      updateConfig({ host, username, password });
    }
    const data = await refreshFromTally();
    res.json({
      success: true,
      source: data.source,
      customers: data.customers?.length || 0,
      skus: data.skus?.length || 0,
      categories: data.categories?.length || 0,
      timestamp: data.timestamp,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tally/data-summary — summary of loaded data
router.get('/data-summary', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json({
      source: data.source,
      customerCount: data.customers?.length || 0,
      skuCount: data.skus?.length || 0,
      categoryCount: data.categories?.length || 0,
      categories: data.categories || [],
      topCustomers: (data.customers || [])
        .sort((a, b) => b.monthlyAvg - a.monthlyAvg)
        .slice(0, 10)
        .map(c => ({ name: c.name, segment: c.segment, monthlyAvg: c.monthlyAvg })),
      timestamp: data.timestamp,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
