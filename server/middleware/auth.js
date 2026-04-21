import jwt from 'jsonwebtoken';
import crypto from 'crypto';

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set in production');
  }
  const ephemeral = crypto.randomBytes(48).toString('hex');
  console.warn('  JWT_SECRET not set — using an ephemeral development secret. Set JWT_SECRET in .env for production.');
  return ephemeral;
}

const JWT_SECRET = resolveJwtSecret();

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export { JWT_SECRET };
