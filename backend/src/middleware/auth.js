import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { getDb } from '../db/index.js'

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, plan: user.plan },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: { message: 'Authentication required', type: 'auth_error' } })
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret)
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(payload.sub)
    if (!user) {
      return res.status(401).json({ error: { message: 'User not found', type: 'auth_error' } })
    }
    req.user = sanitizeUser(user)
    next()
  } catch {
    return res.status(401).json({ error: { message: 'Invalid or expired token', type: 'auth_error' } })
  }
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return next()

  try {
    const payload = jwt.verify(token, config.jwtSecret)
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(payload.sub)
    if (user) req.user = sanitizeUser(user)
  } catch {
    // ignore invalid optional token
  }
  next()
}

/* Companion preferences ride in one JSON column. Parsing is defensive because a
   hand-edited or half-written row must never take a login down with it. */
function parsePrefs(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function sanitizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone || null,
    avatar: row.avatar || null,
    plan: row.plan,
    creditsRemaining: row.credits_remaining,
    isPremium: Boolean(row.is_premium),
    prefs: parsePrefs(row.prefs_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
