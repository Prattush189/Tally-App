import { createContext, useContext, useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import * as localAuth from '../utils/localAuth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('b2b_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('b2b_token');
    if (!token) {
      setLoading(false);
      return;
    }

    if (localAuth.isLocalToken(token)) {
      const u = localAuth.me(token);
      if (u) {
        setUser(u);
        localStorage.setItem('b2b_user', JSON.stringify(u));
      } else {
        localStorage.removeItem('b2b_token');
        localStorage.removeItem('b2b_user');
        setUser(null);
      }
      setLoading(false);
      return;
    }

    if (!HAS_BACKEND) {
      // Token looks remote but no backend configured — clear it.
      localStorage.removeItem('b2b_token');
      localStorage.removeItem('b2b_user');
      setUser(null);
      setLoading(false);
      return;
    }

    api.get('/auth/me')
      .then(res => { setUser(res.data); localStorage.setItem('b2b_user', JSON.stringify(res.data)); })
      .catch(() => {
        localStorage.removeItem('b2b_token');
        localStorage.removeItem('b2b_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const persist = (data) => {
    localStorage.setItem('b2b_token', data.token);
    localStorage.setItem('b2b_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const login = async (email, password) => {
    if (HAS_BACKEND) {
      const res = await api.post('/auth/login', { email, password });
      return persist(res.data);
    }
    const data = await localAuth.login({ email, password });
    return persist(data);
  };

  const register = async (name, email, password) => {
    if (HAS_BACKEND) {
      const res = await api.post('/auth/register', { name, email, password });
      return persist(res.data);
    }
    const data = await localAuth.register({ name, email, password });
    return persist(data);
  };

  const logout = () => {
    localStorage.removeItem('b2b_token');
    localStorage.removeItem('b2b_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, hasBackend: HAS_BACKEND }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
