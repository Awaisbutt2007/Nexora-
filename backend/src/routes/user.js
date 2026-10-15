import { Router } from 'express'
import { z } from 'zod'
import { PLANS } from '../config.js'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth, sanitizeUser } from '../middleware/auth.js'
import { upgradePlan } from '../services/credits.js'

const router = Router()
router.use(requireAuth)

router.get('/profile', (req, res) => {
  res.json({ user: req.user, plans: Object.values(PLANS) })
})

router.patch('/profile', (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(2).max(80).optional(),
      phone: z.string().trim().max(32).optional().nullable(),
    })
    const body = schema.parse(req.body)
    const db = getDb()
    const stamp = nowIso()

    if (body.name) {
      db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(body.name, stamp, req.user.id)
    }
    if (body.phone !== undefined) {
      db.prepare('UPDATE users SET phone = ?, updated_at = ? WHERE id = ?').run(body.phone, stamp, req.user.id)
    }

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
    res.json({ user: sanitizeUser(row) })
  } catch (err) {
    next(err)
  }
})

router.get('/plans', (_req, res) => {
  res.json({ object: 'list', data: Object.values(PLANS) })
})

router.post('/upgrade', (req, res, next) => {
  try {
    const schema = z.object({
      plan: z.enum(['free', 'pro', 'yearly_pro']),
    })
    const body = schema.parse(req.body)
    const row = upgradePlan(req.user.id, body.plan)
    res.json({
      user: sanitizeUser(row),
      message:
        body.plan === 'free'
          ? 'Downgraded to Starter.'
          : `Upgraded to ${PLANS[body.plan].name}. Unlimited credits unlocked.`,
    })
  } catch (err) {
    next(err)
  }
})

export default router
