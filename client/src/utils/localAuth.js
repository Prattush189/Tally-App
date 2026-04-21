// Browser-only auth for static deployments (e.g. GitHub Pages).
// Users and password hashes are kept in localStorage. Hashing uses the
// Web Crypto API (PBKDF2-SHA256) so plaintext passwords never touch disk.

const USERS_KEY = 'b2b_local_users_v1';
const TOKEN_PREFIX = 'local.';
const PBKDF2_ITERATIONS = 120000;
const SALT_BYTES = 16;

const te = new TextEncoder();

function b64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password, saltBytes) {
  const key = await crypto.subtle.importKey(
    'raw', te.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return b64(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${hash}`;
}

async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const salt = fromB64(parts[2]);
  const expected = parts[3];
  const actual = await derive(password, salt);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function makeAvatar(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, avatar: u.avatar };
}

function makeToken(user) {
  return TOKEN_PREFIX + btoa(JSON.stringify({ id: user.id, email: user.email, iat: Date.now() }));
}

export function isLocalToken(token) {
  return typeof token === 'string' && token.startsWith(TOKEN_PREFIX);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function register({ email, password, name }) {
  if (!email || !password || !name) throw new Error('Name, email and password are required');
  if (!EMAIL_REGEX.test(email)) throw new Error('Invalid email address');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  if (name.trim().length < 2) throw new Error('Name must be at least 2 characters');

  const users = loadUsers();
  const normalizedEmail = email.toLowerCase().trim();
  if (users.find(u => u.email === normalizedEmail)) {
    throw new Error('An account with this email already exists');
  }

  const user = {
    id: users.length ? Math.max(...users.map(u => u.id)) + 1 : 1,
    email: normalizedEmail,
    password: await hashPassword(password),
    name: name.trim(),
    role: users.length === 0 ? 'admin' : 'viewer',
    avatar: makeAvatar(name),
  };
  users.push(user);
  saveUsers(users);

  const pub = publicUser(user);
  return { token: makeToken(pub), user: pub };
}

export async function login({ email, password }) {
  if (!email || !password) throw new Error('Email and password required');
  const users = loadUsers();
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) throw new Error('Invalid credentials');
  const ok = await verifyPassword(password, user.password);
  if (!ok) throw new Error('Invalid credentials');
  const pub = publicUser(user);
  return { token: makeToken(pub), user: pub };
}

export function me(token) {
  if (!isLocalToken(token)) return null;
  try {
    const payload = JSON.parse(atob(token.slice(TOKEN_PREFIX.length)));
    const user = loadUsers().find(u => u.id === payload.id);
    return user ? publicUser(user) : null;
  } catch {
    return null;
  }
}
