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
      /* `model` is deliberately not selected: the engine id stays in the DB for our own
         debugging and never travels to the browser, where it would answer the very
         question the companion is built to keep private — "how were you made?". */
      `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`,
    )
    .all(req.user.id)

  res.json({ object: 'list', data: rows })
})

router.post('/', (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().trim().max(120).optional(),
    })
    const body = schema.parse(req.body || {})
    const id = `conv_${nanoid(16)}`
    const stamp = nowIso()

    getDb()
      .prepare(
        `INSERT INTO conversations (id, user_id, title, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      /* The engine id is written by the chat path itself; a client-provided one used to
         be stored here, which only gave the plumbing another way to travel. */
      .run(id, req.user.id, body.title || 'New chat', null, stamp, stamp)

    res.status(201).json({
      id,
      title: body.title || 'New chat',
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
      `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations WHERE id = ? AND user_id = ?`,
    )
    .get(req.params.id, req.user.id)

  if (!conversation) {
    return res.status(404).json({ error: { message: 'Conversation not found', type: 'not_found' } })
  }

  const rows = db
    .prepare(
      `SELECT id, role, content, tokens, created_at AS createdAt, images_json, reply_to AS replyTo
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

/* Self-screenshots: when the assistant photographs her own live UI, the client
   uploads the PNG through POST /api/chat/images (same as any reference picture) and
   then hangs the resulting path on the assistant turn, so the shot survives a reload
   instead of being a one-frame trick. Only a real /uploads/img_* path is accepted —
   the same shape the chat schema allows — and only onto an assistant message. */
const attachSchema = z.object({
  images: z.array(z.string().trim().regex(/^\/uploads\/img_[\w.-]+$/)).min(1).max(4),
  /* The marker lines that were actually fulfilled. Small model, big appetite for
     forgetting instructions — the app captures anyway, and appending the marker here
     is what makes the "📸 a real screenshot of my settings" caption render identically
     live and after a reload. Nothing but the marker shape can be written. */
  markers: z.array(z.string().trim().regex(/^\[SCREENSHOT:[a-z]{3,16}\]$/i)).max(4).optional(),
})

router.patch('/:id/messages/:messageId', (req, res, next) => {
  try {
    const body = attachSchema.parse(req.body)
    const db = getDb()
    const thread = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!thread) {
      return res.status(404).json({ error: { message: 'Conversation not found', type: 'not_found' } })
    }
    const message = db.prepare('SELECT id, role, content FROM messages WHERE id = ? AND conversation_id = ?').get(req.params.messageId, thread.id)
    if (!message) {
      return res.status(404).json({ error: { message: 'Message not found', type: 'not_found' } })
    }
    if (message.role !== 'assistant') {
      return res.status(400).json({ error: { message: 'Only an assistant message can carry screenshots', type: 'invalid_request_error' } })
    }

    const stamp = nowIso()
    db.prepare('UPDATE messages SET images_json = ? WHERE id = ?').run(JSON.stringify(body.images), message.id)
    /* Idempotent: a marker the model already wrote is never duplicated. */
    const missing = [...new Set(body.markers || [])].filter((marker) => !String(message.content || '').includes(marker))
    if (missing.length) {
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(`${message.content}\n\n${missing.join('\n\n')}`, message.id)
    }
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(stamp, thread.id)
    res.json({ id: message.id, images: body.images, markers: missing, updatedAt: stamp })
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
