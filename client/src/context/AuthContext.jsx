import { createContext, useContext, useState, useEffect } from 'react';
import api, { HAS_BACKEND } from '../utils/api';
import * as localAuth from '../utils/localAuth';
import {
  HAS_SUPABASE, supabase,
  supabaseRegister, supabaseLogin, supabaseMe, supabaseLogout,
} from '../utils/supabase';
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_NAME, isDemoUser } from '../utils/demo';

const AuthContext = createContext(null);

// Auth priority: Supabase > Express backend > in-browser PBKDF2 fallback.
// Each layer is independent — pick whichever is configured at build time.

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('b2b_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (HAS_SUPABASE) {
        const me = await supabaseMe();
        if (cancelled) return;
        if (me) {
          setUser(me);
          localStorage.setItem('b2b_user', JSON.stringify(me));
          const { data } = await supabase.auth.getSession();
          if (data.session?.access_token) {
            localStorage.setItem('b2b_token', data.session.access_token);
          }
        } else {
          localStorage.removeItem('b2b_token');
          localStorage.removeItem('b2b_user');
          setUser(null);
        }
        setLoading(false);

        supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token) {
            localStorage.setItem('b2b_token', session.access_token);
          } else {
            localStorage.removeItem('b2b_token');
            localStorage.removeItem('b2b_user');
            setUser(null);
          }
        });
        return;
      }

      const token = localStorage.getItem('b2b_token');
      if (!token) { setLoading(false); return; }

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
        localStorage.removeItem('b2b_token');
        localStorage.removeItem('b2b_user');
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const res = await api.get('/auth/me');
        setUser(res.data);
        localStorage.setItem('b2b_user', JSON.stringify(res.data));
      } catch {
        localStorage.removeItem('b2b_token');
        localStorage.removeItem('b2b_user');
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []);

  const persist = (data) => {
    if (data.token) localStorage.setItem('b2b_token', data.token);
    localStorage.setItem('b2b_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const login = async (email, password) => {
    if (HAS_SUPABASE) {
      const data = await supabaseLogin({ email, password });
      return persist(data);
    }
    if (HAS_BACKEND) {
      const res = await api.post('/auth/login', { email, password });
      return persist(res.data);
    }
    const data = await localAuth.login({ email, password });
    return persist(data);
  };

  const register = async (name, email, password) => {
    if (HAS_SUPABASE) {
      const data = await supabaseRegister({ name, email, password });
      if (!data.token) {
        // Supabase email confirmation required — no session yet.
        const err = new Error('Check your email to confirm your account, then sign in.');
        err.needsConfirmation = true;
        throw err;
      }
      return persist(data);
    }
    if (HAS_BACKEND) {
      const res = await api.post('/auth/register', { name, email, password });
      return persist(res.data);
    }
    const data = await localAuth.register({ name, email, password });
    return persist(data);
  };

  const logout = async () => {
    if (HAS_SUPABASE) await supabaseLogout();
    localStorage.removeItem('b2b_token');
    localStorage.removeItem('b2b_user');
    setUser(null);
  };

  // One-click demo login. Tries to sign in with the fixed creds; if the account
  // doesn't exist yet, registers it first then signs in. The demo user sees
  // mock data on all dashboards and has Tally Sync locked to view-only.
  const loginAsDemo = async () => {
    try {
      return await login(DEMO_EMAIL, DEMO_PASSWORD);
    } catch (loginErr) {
      try {
        const data = await register(DEMO_NAME, DEMO_EMAIL, DEMO_PASSWORD);
        return data;
      } catch (registerErr) {
        if (registerErr?.needsConfirmation) {
          throw new Error('Demo account needs email confirmation in Supabase. Disable "Confirm email" under Authentication → Providers → Email, then try again.');
        }
        // If the account exists but password is wrong, or some other issue, surface the login error.
        throw loginErr;
      }
    }
  };

  const isDemo = isDemoUser(user);

  return (
    <AuthContext.Provider value={{
      user, login, register, logout, loginAsDemo, loading,
      isDemo,
      hasBackend: HAS_BACKEND, hasSupabase: HAS_SUPABASE,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
