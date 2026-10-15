import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { config } from '../config.js'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth, sanitizeUser, signToken } from '../middleware/auth.js'

const router = Router()

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(6).max(128),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
})

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})

const googleSchema = z.object({
  credential: z.string().min(10),
})

// Verify a Google ID token via Google's tokeninfo endpoint (no extra deps needed).
async function verifyGoogleToken(credential) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`)
  if (!res.ok) throw Object.assign(new Error('Invalid Google credential'), { status: 401 })
  const payload = await res.json()
  if (config.googleClientId && payload.aud !== config.googleClientId) {
    throw Object.assign(new Error('Google token audience mismatch'), { status: 401 })
  }
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    throw Object.assign(new Error('Google email is not verified'), { status: 401 })
  }
  return payload
}

router.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body)
    const db = getDb()
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email.toLowerCase())
    if (existing) {
      return res.status(409).json({ error: { message: 'Email already registered', type: 'conflict' } })
    }

    const id = `usr_${nanoid(16)}`
    const stamp = nowIso()
    const passwordHash = await bcrypt.hash(body.password, 10)

    db.prepare(
      `INSERT INTO users (id, email, name, phone, password_hash, plan, credits_remaining, is_premium, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'free', ?, 0, ?, ?)`,
    ).run(
      id,
      body.email.toLowerCase(),
      body.name,
      body.phone || null,
      passwordHash,
      config.freeMonthlyCredits,
      stamp,
      stamp,
    )

    const user = sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
    const token = signToken(user)
    res.status(201).json({ user, token })
  } catch (err) {
    next(err)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body)
    const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(body.email.toLowerCase())
    if (!row) {
      return res.status(401).json({ error: { message: 'Invalid email or password', type: 'auth_error' } })
    }

    const ok = await bcrypt.compare(body.password, row.password_hash)
    if (!ok) {
      return res.status(401).json({ error: { message: 'Invalid email or password', type: 'auth_error' } })
    }

    const user = sanitizeUser(row)
    res.json({ user, token: signToken(user) })
  } catch (err) {
    next(err)
  }
})

router.post('/google', async (req, res, next) => {
  try {
    const { credential } = googleSchema.parse(req.body)
    const googleUser = await verifyGoogleToken(credential)
    const db = getDb()
    const email = String(googleUser.email || '').toLowerCase()
    if (!email) {
      return res.status(400).json({ error: { message: 'Google account has no email', type: 'auth_error' } })
    }

    let row = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    const stamp = nowIso()

    if (row) {
      // Refresh avatar/name and link the Google subject on returning users
      db.prepare('UPDATE users SET avatar = ?, name = ?, google_sub = ?, updated_at = ? WHERE id = ?')
        .run(googleUser.picture || row.avatar, row.name || googleUser.name || email, googleUser.sub, stamp, row.id)
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)
    } else {
      const id = `usr_${nanoid(16)}`
      // Google-only accounts get an unusable random password
      const passwordHash = await bcrypt.hash(nanoid(24), 10)
      db.prepare(
        `INSERT INTO users (id, email, name, phone, password_hash, avatar, google_sub, plan, credits_remaining, is_premium, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 'free', ?, 0, ?, ?)`,
      ).run(
        id,
        email,
        googleUser.name || email.split('@')[0],
        passwordHash,
        googleUser.picture || null,
        googleUser.sub,
        config.freeMonthlyCredits,
        stamp,
        stamp,
      )
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    }

    const user = sanitizeUser(row)
    res.json({ user, token: signToken(user) })
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({ error: { message: err.message, type: 'auth_error' } })
    }
    next(err)
  }
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
