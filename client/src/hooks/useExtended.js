import { useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import { runExtended } from '../lib/extendedEngine';
import { loadLiveCustomers } from '../lib/liveData';
import { useAuth } from '../context/AuthContext';
import { useFilters, applyFilters } from '../context/FiltersContext';

// Extended analytics hook — only ever runs against real Tally-sync data.
// The demo fixture branch was removed: mock numbers showing up on real-
// looking pages is exactly what we're trying to prevent, and demo users
// hit the same gate (App.jsx) telling them to sync Tally first. Pages
// receiving `data: null` should render their empty state.
export function useExtended(endpoint) {
  const { user } = useAuth();
  const { year, dealerId } = useFilters();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (HAS_BACKEND) {
        const res = await api.get(`/extended/${endpoint}`, { params: { year, dealerId } });
        setData(res.data);
      } else {
        const live = loadLiveCustomers(user?.email);
        if (live && live.customers?.length) {
          const filtered = applyFilters(live.customers, { year, dealerId });
          setData(runExtended(endpoint, { customers: filtered }));
        } else {
          setData(null);
        }
      }
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [endpoint, user?.email, year, dealerId]);

  return { data, loading, error, refresh: fetchData };
}
