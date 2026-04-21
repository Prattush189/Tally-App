import axios from 'axios';
import { isLocalToken } from './localAuth';
import { HAS_SUPABASE } from './supabase';

// VITE_API_URL may be set at build time to point at a deployed Express backend.
// When unset (e.g. static GitHub Pages), requests fall back to either Supabase or
// the in-browser engines, so '/api' is never actually hit for data calls.
const baseURL = import.meta.env.VITE_API_URL || '/api';

export const API_BASE_URL = baseURL;
export const HAS_BACKEND = Boolean(import.meta.env.VITE_API_URL);
export { HAS_SUPABASE };

const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('b2b_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 || err.response?.status === 403) {
      // Only log out on auth failure from a real backend call. Local / Supabase
      // tokens are validated elsewhere; 401/403 from those shouldn't clobber the session.
      const token = localStorage.getItem('b2b_token');
      if (HAS_BACKEND && !isLocalToken(token)) {
        localStorage.removeItem('b2b_token');
        localStorage.removeItem('b2b_user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
