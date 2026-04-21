import { Router } from 'express';
import { customers as mockCustomers, CATEGORIES as MOCK_CATEGORIES, SKUS as MOCK_SKUS } from '../data/mockData.js';
import { getDashboardData } from '../tally/dataManager.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

async function getData() {
  try {
    const data = await getDashboardData();
    return {
      customers: data.customers || mockCustomers,
      CATEGORIES: data.categories || MOCK_CATEGORIES,
      SKUS: data.skus || MOCK_SKUS,
    };
  } catch {
    return { customers: mockCustomers, CATEGORIES: MOCK_CATEGORIES, SKUS: MOCK_SKUS };
  }
}

// GET /api/customers — list all with optional filters
router.get('/', async (req, res) => {
  const { customers, CATEGORIES } = await getData();
  let result = [...customers];
  const { segment, region, churnRisk, paymentRisk, search, sortBy, sortDir, limit, offset } = req.query;

  if (segment) result = result.filter(c => c.segment === segment);
  if (region) result = result.filter(c => c.region === region);
  if (churnRisk) result = result.filter(c => c.churnRisk === churnRisk);
  if (paymentRisk) result = result.filter(c => c.paymentRisk === paymentRisk);
  if (search) result = result.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  if (sortBy) {
    const dir = sortDir === 'asc' ? 1 : -1;
    result.sort((a, b) => (a[sortBy] > b[sortBy] ? dir : -dir));
  }

  const total = result.length;
  if (offset) result = result.slice(parseInt(offset));
  if (limit) result = result.slice(0, parseInt(limit));

  res.json({ data: result, total, categories: CATEGORIES });
});

// GET /api/customers/:id — single customer detail
router.get('/:id', async (req, res) => {
  const { customers } = await getData();
  const customer = customers.find(c => c.id === parseInt(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer);
});

// GET /api/skus
router.get('/meta/skus', async (req, res) => {
  const { SKUS, CATEGORIES } = await getData();
  res.json({ skus: SKUS, categories: CATEGORIES });
});

export default router;
