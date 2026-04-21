import { useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import { runExtended } from '../lib/extendedEngine';
import { useAuth } from '../context/AuthContext';

export function useExtended(endpoint) {
  const { isDemo } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (HAS_BACKEND) {
        const res = await api.get(`/extended/${endpoint}`);
        setData(res.data);
      } else if (isDemo) {
        setData(runExtended(endpoint));
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

  useEffect(() => { fetchData(); }, [endpoint, isDemo]);

  return { data, loading, error, refresh: fetchData };
}
