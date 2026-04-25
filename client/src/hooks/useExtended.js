import { useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import { runExtended } from '../lib/extendedEngine';
import { useTallyData } from '../context/TallyDataContext';
import { useFilters, applyFilters } from '../context/FiltersContext';

// Extended analytics hook — only ever runs against real Tally-sync data.
// Pages receiving `data: null` should render their empty state; App.jsx's
// top-level gate keeps unsynced users on the Tally page anyway.
export function useExtended(endpoint) {
  const { customers, syncedAt, financials } = useTallyData();
  const { dateFrom, dateTo, dealerId } = useFilters();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (HAS_BACKEND) {
        const res = await api.get(`/extended/${endpoint}`, { params: { dateFrom, dateTo, dealerId } });
        setData(res.data);
      } else if (customers.length) {
        const filtered = applyFilters(customers, { dateFrom, dateTo, dealerId });
        setData(runExtended(endpoint, { customers: filtered, financials }));
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

  useEffect(() => { fetchData(); }, [endpoint, syncedAt, dateFrom, dateTo, dealerId]);

  return { data, loading, error, refresh: fetchData };
}
