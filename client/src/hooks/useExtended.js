import { useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import { runExtended } from '../lib/extendedEngine';

export function useExtended(endpoint) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (HAS_BACKEND) {
        const res = await api.get(`/extended/${endpoint}`);
        setData(res.data);
      } else {
        setData(runExtended(endpoint));
      }
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [endpoint]);

  return { data, loading, error, refresh: fetchData };
}
