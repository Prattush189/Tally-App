import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { users } from '../data/mockData.js';
import { JWT_SECRET, authenticateToken } from '../middleware/auth.js';

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function makeAvatar(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

router.post('/register', (req, res) => {
  const { email, password, name } = req.body || {};

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (name.trim().length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (users.find(u => u.email === normalizedEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const user = {
    id: users.length ? Math.max(...users.map(u => u.id)) + 1 : 1,
    email: normalizedEmail,
    password: bcrypt.hashSync(password, 10),
    name: name.trim(),
    role: users.length === 0 ? 'admin' : 'viewer',
    avatar: makeAvatar(name),
  };
  users.push(user);

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, avatar: user.avatar },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, avatar: user.avatar },
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, avatar: user.avatar },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, avatar: user.avatar } });
});

router.get('/me', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, avatar: user.avatar });
});

export default router;
