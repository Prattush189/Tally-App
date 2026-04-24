import { useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import { runAnalytics } from '../lib/analyticsEngine';
import { useTallyData } from '../context/TallyDataContext';
import { useFilters, applyFilters } from '../context/FiltersContext';

// Core analytics hook — never uses mock data. Returns `data: null` when no
// real Tally sync has landed yet; dashboards should render their empty
// state. The top-level gate in App.jsx catches unsynced users and routes
// them to the Tally Sync page before individual dashboards mount.
export function useAnalytics(endpoint) {
  const { customers, syncedAt } = useTallyData();
  const { year, dealerId } = useFilters();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (HAS_BACKEND) {
        const res = await api.get(`/analytics/${endpoint}`, { params: { year, dealerId } });
        setData(res.data);
      } else if (customers.length) {
        const filtered = applyFilters(customers, { year, dealerId });
        setData(runAnalytics(endpoint, { customers: filtered }));
      } else {
        setData(null);
      }
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [endpoint, syncedAt, year, dealerId]);

  return { data, loading, error, refresh: fetchData };
}
