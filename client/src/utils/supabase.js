// Supabase client — created only if VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are both set.
// When unset the app falls back to the in-browser PBKDF2 auth and the client-side analytics
// engine, so GitHub Pages deployments without Supabase still work end-to-end (minus Tally).

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const HAS_SUPABASE = Boolean(url && anonKey);

export const supabase = HAS_SUPABASE
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'b2b_supabase_auth' },
    })
  : null;

function avatarInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function publicUser(supaUser) {
  if (!supaUser) return null;
  const meta = supaUser.user_metadata || {};
  const name = meta.name || supaUser.email.split('@')[0];
  return {
    id: supaUser.id,
    email: supaUser.email,
    name,
    role: meta.role || 'viewer',
    avatar: meta.avatar || avatarInitials(name),
  };
}

export async function supabaseRegister({ name, email, password }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name: name.trim(), avatar: avatarInitials(name), role: 'viewer' },
    },
  });
  if (error) throw new Error(error.message);
  return { token: data.session?.access_token || '', user: publicUser(data.user) };
}

export async function supabaseLogin({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { token: data.session.access_token, user: publicUser(data.user) };
}

export async function supabaseMe() {
  const { data } = await supabase.auth.getUser();
  return publicUser(data.user);
}

export async function supabaseLogout() {
  if (supabase) await supabase.auth.signOut();
}
