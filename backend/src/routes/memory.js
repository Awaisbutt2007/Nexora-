import { Router } from 'express'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, key, value, source, created_at AS createdAt, updated_at AS updatedAt
       FROM memories WHERE user_id = ? ORDER BY updated_at DESC`,
    )
    .all(req.user.id)
  res.json({ object: 'list', data: rows })
})

router.post('/', (req, res, next) => {
  try {
    const schema = z.object({
      key: z.string().trim().min(1).max(80),
      value: z.string().trim().min(1).max(2000),
      source: z.enum(['user', 'assistant', 'system']).optional().default('user'),
    })
    const body = schema.parse(req.body)
    const db = getDb()
    const stamp = nowIso()
    const existing = db
      .prepare('SELECT id FROM memories WHERE user_id = ? AND key = ?')
      .get(req.user.id, body.key)

    if (existing) {
      db.prepare(`UPDATE memories SET value = ?, source = ?, updated_at = ? WHERE id = ?`).run(
        body.value,
        body.source,
        stamp,
        existing.id,
      )
      return res.json({
        id: existing.id,
        key: body.key,
        value: body.value,
        source: body.source,
        updatedAt: stamp,
      })
    }

    const id = `mem_${nanoid(16)}`
    db.prepare(
      `INSERT INTO memories (id, user_id, key, value, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, req.user.id, body.key, body.value, body.source, stamp, stamp)

    res.status(201).json({
      id,
      key: body.key,
      value: body.value,
      source: body.source,
      createdAt: stamp,
      updatedAt: stamp,
    })
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT id FROM memories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!row) {
    return res.status(404).json({ error: { message: 'Memory not found', type: 'not_found' } })
  }
  db.prepare('DELETE FROM memories WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

export default router
