import { Router } from 'express'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { config } from '../config.js'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import { ensureCredits, deductCredits } from '../services/credits.js'
import { buildRealtimeSession, consumeVoiceStart, createVoiceClientSecret, isSupportedVoice } from '../services/realtime.js'

const router = Router()
router.use(requireAuth)

/* Voice sessions are ephemeral provider state — transcripts are persisted to
   conversations/messages, raw audio is NEVER stored (no consent path for it). */

const tokenSchema = z.object({
  voice: z.string().trim().max(20).optional(),
  language: z.enum(['auto', 'en', 'ur']).optional().default('auto'),
  assistantName: z.string().trim().min(1).max(40).optional(),
  /* Short descriptor chosen at onboarding (e.g. "Assistant — sharp chief-of-staff energy").
     Not a secret; caps at 200 chars so a bad actor can't stuff the system prompt. */
  persona: z.string().trim().max(200).optional(),
  conversationId: z.string().trim().max(60).optional().nullable(),
})

/* Mint a short-lived, scoped client secret for the browser's WebRTC call. */
router.post('/token', async (req, res, next) => {
  try {
    const body = tokenSchema.parse(req.body || {})

    if (!consumeVoiceStart(req.user.id)) {
      const err = new Error(`Too many voice sessions — try again in a few minutes (max ${config.voiceRateLimit} per 10 min).`)
      err.status = 429
      err.type = 'rate_limited'
      throw err
    }
    ensureCredits(req.user, 1)

    const voice = body.voice && isSupportedVoice(body.voice) ? body.voice : config.voiceDefaultVoice
    const db = getDb()

    const memories = db
      .prepare('SELECT key, value FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20')
      .all(req.user.id)

    const session = buildRealtimeSession({
      assistantName: body.assistantName || 'Aira',
      userName: req.user.name,
      voice,
      language: body.language,
      memories,
      persona: body.persona,
    })

    const secret = await createVoiceClientSecret(session, req.user.id)

    /* Recent turns of the bound conversation, replayed into the realtime
       session by the client so Aira keeps context across calls. */
    let history = []
    if (body.conversationId) {
      const owned = db
        .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
        .get(body.conversationId, req.user.id)
      if (owned) {
        history = db
          .prepare(
            `SELECT role, content FROM messages WHERE conversation_id = ?
             ORDER BY created_at DESC LIMIT 8`,
          )
          .all(body.conversationId)
          .reverse()
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, text: m.content }))
      }
    }

    res.json({
      clientSecret: secret.clientSecret,
      sessionId: secret.sessionId,
      expiresAt: secret.expiresAt,
      provider: config.voiceProvider,
      model: config.voiceRealtimeModel,
      voice,
      language: body.language,
      maxSeconds: config.voiceMaxSessionSeconds,
      conversationId: body.conversationId || null,
      history,
    })
  } catch (err) {
    next(err)
  }
})

const turnSchema = z.object({
  conversationId: z.string().trim().max(60).optional().nullable(),
  userText: z.string().trim().min(1).max(4000),
  assistantText: z.string().trim().min(1).max(8000),
})

/* Persist one completed spoken exchange into a ChatGPT-style conversation. */
router.post('/turn', (req, res, next) => {
  try {
    const body = turnSchema.parse(req.body)
    const db = getDb()
    const stamp = nowIso()
    ensureCredits(req.user, 1)

    let conversationId = body.conversationId || null
    let isNew = false
    if (conversationId) {
      const owned = db
        .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
        .get(conversationId, req.user.id)
      if (!owned) {
        return res.status(404).json({ error: { message: 'Conversation not found', type: 'not_found' } })
      }
    } else {
      conversationId = `conv_${nanoid(16)}`
      isNew = true
      db.prepare(
        `INSERT INTO conversations (id, user_id, title, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        conversationId,
        req.user.id,
        `Voice · ${body.userText.slice(0, 40)}`,
        config.voiceRealtimeModel,
        stamp,
        stamp,
      )
    }

    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at)
       VALUES (?, ?, 'user', ?, 0, ?)`,
    ).run(`msg_${nanoid(16)}`, conversationId, body.userText, stamp)
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at)
       VALUES (?, ?, 'assistant', ?, ?, ?)`,
    ).run(`msg_${nanoid(16)}`, conversationId, body.assistantText, body.assistantText.length >> 2, stamp)
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(stamp, conversationId)

    deductCredits(req.user.id, 1)

    res.status(201).json({ conversationId, isNew, creditsCharged: 1 })
  } catch (err) {
    next(err)
  }
})

export default router
