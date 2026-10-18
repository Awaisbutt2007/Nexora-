import { Router } from 'express'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

function titleFromPrompt(text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ')
  if (!clean) return 'New chat'
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean
}

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, title, model, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`,
    )
    .all(req.user.id)

  res.json({ object: 'list', data: rows })
})

router.post('/', (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().max(120).optional(),
      model: z.string().trim().max(80).optional(),
    })
    const body = schema.parse(req.body || {})
    const id = `conv_${nanoid(16)}`
    const stamp = nowIso()

    getDb()
      .prepare(
        `INSERT INTO conversations (id, user_id, title, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, req.user.id, body.title || 'New chat', body.model || null, stamp, stamp)

    res.status(201).json({
      id,
      title: body.title || 'New chat',
      model: body.model || null,
      createdAt: stamp,
      updatedAt: stamp,
      messages: [],
    })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', (req, res) => {
  const db = getDb()
  const conversation = db
    .prepare(
      `SELECT id, title, model, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations WHERE id = ? AND user_id = ?`,
    )
    .get(req.params.id, req.user.id)

  if (!conversation) {
    return res.status(404).json({ error: { message: 'Conversation not found', type: 'not_found' } })
  }

  const rows = db
    .prepare(
      `SELECT id, role, content, tokens, created_at AS createdAt, images_json
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
    )
    .all(conversation.id)

  /* camelCase contract: hand the client a parsed images array, never raw JSON. */
  const messages = rows.map(({ images_json, ...m }) => ({
    ...m,
    images: images_json ? JSON.parse(images_json) : null,
  }))

  res.json({ ...conversation, messages })
})

router.patch('/:id', (req, res, next) => {
  try {
    const schema = z.object({ title: z.string().trim().min(1).max(120) })
    const body = schema.parse(req.body)
    const db = getDb()
    const row = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!row) {
      return res.status(404).json({ error: { message: 'Conversation not found', type: 'not_found' } })
    }

    const stamp = nowIso()
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(body.title, stamp, req.params.id)
    res.json({ id: req.params.id, title: body.title, updatedAt: stamp })
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!row) {
    return res.status(404).json({ error: { message: 'Conversation not found', type: 'not_found' } })
  }
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id)
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

/* Delete every conversation the caller owns in one shot. Messages cascade through
   the FK, but we clear them explicitly first so the returned count is trustworthy
   and nothing is left behind even if foreign_keys were ever turned off. */
router.delete('/', (req, res) => {
  const db = getDb()
  db.prepare(
    'DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)',
  ).run(req.user.id)
  const info = db.prepare('DELETE FROM conversations WHERE user_id = ?').run(req.user.id)
  res.json({ object: 'list', deleted: info.changes })
})

export { titleFromPrompt }
export default router
