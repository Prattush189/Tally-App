import { useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import { runAnalytics } from '../lib/analyticsEngine';
import { loadLiveCustomers } from '../lib/liveData';
import { useAuth } from '../context/AuthContext';

export function useAnalytics(endpoint) {
  const { isDemo, user } = useAuth();
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
        const live = loadLiveCustomers(user?.email);
        if (live && live.customers.length) {
          setData(runAnalytics(endpoint, { customers: live.customers }));
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

  useEffect(() => { fetchData(); }, [endpoint, isDemo, user?.email]);

  return { data, loading, error, refresh: fetchData };
}
