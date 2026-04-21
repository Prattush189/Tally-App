import { useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import { runAnalytics } from '../lib/analyticsEngine';
import { useAuth } from '../context/AuthContext';

export function useAnalytics(endpoint) {
  const { isDemo } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (HAS_BACKEND) {
        const res = await api.get(`/analytics/${endpoint}`);
        setData(res.data);
      } else if (isDemo) {
        setData(runAnalytics(endpoint));
      } else {
        // Real account with no backend — dashboards stay empty until a real
        // data pipeline lands. Components render the NoData placeholder.
        setData(null);
      }
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [endpoint, isDemo]);

  return { data, loading, error, refresh: fetchData };
}
