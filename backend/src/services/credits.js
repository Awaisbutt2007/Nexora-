import { getDb, nowIso } from '../db/index.js'
import { PLANS } from '../config.js'

export function ensureCredits(user, cost = 1) {
  if (user.isPremium || user.plan === 'pro' || user.plan === 'yearly_pro') {
    return { ok: true, unlimited: true }
  }
  if (user.creditsRemaining < cost) {
    const err = new Error('Insufficient credits. Upgrade to Pro for unlimited access.')
    err.status = 402
    err.type = 'insufficient_credits'
    throw err
  }
  return { ok: true, unlimited: false }
}

export function deductCredits(userId, cost = 1) {
  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user) return null
  if (user.is_premium) return user

  const next = Math.max(0, user.credits_remaining - cost)
  db.prepare(
    `UPDATE users SET credits_remaining = ?, updated_at = ? WHERE id = ?`,
  ).run(next, nowIso(), userId)

  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
}

export function upgradePlan(userId, planId) {
  const plan = PLANS[planId]
  if (!plan) {
    const err = new Error('Unknown plan')
    err.status = 400
    throw err
  }

  const isPremium = planId === 'pro' || planId === 'yearly_pro'
  const credits = isPremium ? 999999 : plan.credits

  getDb()
    .prepare(
      `UPDATE users SET plan = ?, is_premium = ?, credits_remaining = ?, updated_at = ? WHERE id = ?`,
    )
    .run(planId, isPremium ? 1 : 0, credits, nowIso(), userId)

  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId)
}
