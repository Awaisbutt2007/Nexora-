import { Router } from 'express'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { config } from '../config.js'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth, sanitizeUser } from '../middleware/auth.js'
import { completeChat, estimateCredits, streamChatCompletion } from '../services/ai.js'
import { buildImageUrl, detectImageRequest, isNsfwPrompt } from '../services/images.js'
import { deductCredits, ensureCredits } from '../services/credits.js'
import { titleFromPrompt } from './conversations.js'

const router = Router()
router.use(requireAuth)

const chatSchema = z.object({
  message: z.string().trim().min(1).max(20000).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string(),
      }),
    )
    .optional(),
  conversationId: z.string().optional().nullable(),
  model: z.string().trim().max(80).optional(),
  assistantName: z.string().trim().max(40).optional(),
  persona: z.string().trim().max(400).optional(),
  stream: z.boolean().optional().default(true),
})

function writeSse(res, payload) {
  res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
}

/* "remember …" / "yad rakho …" — a lightweight, deterministic way for the user to
   teach the assistant, matching the onboarding promise. No LLM round-trip needed. */
const REMEMBER_RE = /(?:\bremember(?:\s+that)?\b|\bkeep\s+in\s+mind\b|\bnote\s+that\b|\bsave\s+that\b|\by[ae]d\s+ra[kc]ho\b|\bya?ad\s+ra[kc]h\b)\s*[-:]?\s*(.+)/i
function detectRememberRequest(text) {
  if (!text) return null
  const m = REMEMBER_RE.exec(text)
  if (!m) return null
  const fact = (m[1] || '').trim().replace(/[.!?]+$/, '')
  return fact.length >= 3 ? fact.slice(0, 500) : null
}

function saveMemory(db, userId, fact, stamp) {
  const key = fact.split(/\s+/).slice(0, 5).join(' ').slice(0, 60) || 'note'
  const existing = db.prepare('SELECT id FROM memories WHERE user_id = ? AND key = ?').get(userId, key)
  if (existing) {
    db.prepare('UPDATE memories SET value = ?, source = ?, updated_at = ? WHERE id = ?').run(fact, 'user', stamp, existing.id)
    return existing.id
  }
  const id = `mem_${nanoid(16)}`
  db.prepare(
    `INSERT INTO memories (id, user_id, key, value, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', ?, ?)`,
  ).run(id, userId, key, fact, stamp, stamp)
  return id
}

router.post('/completions', async (req, res, next) => {
  try {
    const body = chatSchema.parse(req.body)
    const db = getDb()
    const stamp = nowIso()

    let conversationId = body.conversationId || null
    let isNew = false

    const userMessage =
      body.message ||
      [...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content

    if (!userMessage) {
      return res.status(400).json({
        error: { message: 'Provide message or messages with a user turn', type: 'invalid_request_error' },
      })
    }

    ensureCredits(req.user, 1)

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
      ).run(conversationId, req.user.id, titleFromPrompt(userMessage), body.model || config.openaiModel, stamp, stamp)
    }

    const userMsgId = `msg_${nanoid(16)}`
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at)
       VALUES (?, ?, 'user', ?, 0, ?)`,
    ).run(userMsgId, conversationId, userMessage, stamp)

    /* Teach-on-demand: save any "remember …" fact before we load memories, so it
       is already in context for this very reply and every future chat. */
    const factToRemember = detectRememberRequest(userMessage)
    if (factToRemember) saveMemory(db, req.user.id, factToRemember, stamp)

    const history = db
      .prepare(
        `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      )
      .all(conversationId)

    const memories = db
      .prepare(`SELECT key, value FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20`)
      .all(req.user.id)

    const completionId = `chatcmpl_${nanoid(20)}`
    const created = Math.floor(Date.now() / 1000)
    const model = body.model || config.openaiModel

    if (body.stream === false) {
      const result = await completeChat({ history, memories, model, assistantName: body.assistantName, userName: req.user.name, persona: body.persona })
      const assistantId = `msg_${nanoid(16)}`
      const doneAt = nowIso()
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?)`,
      ).run(assistantId, conversationId, result.content, result.usage?.completion_tokens || 0, doneAt)

      db.prepare(`UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?`).run(
        doneAt,
        result.model,
        conversationId,
      )

      const cost = estimateCredits(result.usage)
      const updated = deductCredits(req.user.id, cost)

      return res.json({
        id: completionId,
        object: 'chat.completion',
        created,
        model: result.model,
        conversationId,
        isNew,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: result.content },
            finish_reason: 'stop',
          },
        ],
        usage: result.usage,
        creditsCharged: cost,
        user: sanitizeUser(updated),
      })
    }

    // --- ChatGPT-style SSE streaming ---
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Conversation-Id', conversationId)
    if (typeof res.flushHeaders === 'function') res.flushHeaders()

    writeSse(res, {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model,
      conversationId,
      isNew,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    })

    let fullText = ''
    let usage = null
    let usedModel = model

    try {
      /* Clear image requests are answered deterministically with a real picture
         (no LLM round-trip, so the free-tier token limits can't block it). The
         assistant also knows to emit an IMAGE: marker for subtler phrasings, which
         the client renders — this path just makes the common case bulletproof. */
      const imagePrompt = detectImageRequest(userMessage)
      if (imagePrompt && isNsfwPrompt(imagePrompt)) {
        /* Adult/NSFW requests are refused outright — Nexora is all-ages. We never
           build a URL, so nothing inappropriate can reach the model or the UI. */
        usedModel = 'nexora-image'
        fullText = "🚫 Sorry, I can't generate that image — it looks like adult/NSFW content, and Nexora doesn't allow that. Describe a different, safe scene and I'll make it for you right away."
        writeSse(res, {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: usedModel,
          conversationId,
          choices: [{ index: 0, delta: { content: fullText }, finish_reason: null }],
        })
      } else if (imagePrompt) {
        usedModel = 'nexora-image'
        fullText = `🖼️ Here's your image.\n\n![Generated image](${buildImageUrl(imagePrompt)})`
        writeSse(res, {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: usedModel,
          conversationId,
          choices: [{ index: 0, delta: { content: fullText }, finish_reason: null }],
        })
      } else {
        for await (const chunk of streamChatCompletion({ history, memories, model, assistantName: body.assistantName, userName: req.user.name, persona: body.persona })) {
          if (chunk.usage) usage = chunk.usage
          if (chunk.model) usedModel = chunk.model
          if (chunk.content) {
            fullText += chunk.content
            writeSse(res, {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: usedModel,
              conversationId,
              choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: null }],
            })
          }
        }
      }

      writeSse(res, {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: usedModel,
        conversationId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })

      if (usage) {
        writeSse(res, {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: usedModel,
          conversationId,
          choices: [],
          usage,
        })
      }

      const assistantId = `msg_${nanoid(16)}`
      const doneAt = nowIso()
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?)`,
      ).run(assistantId, conversationId, fullText, usage?.completion_tokens || 0, doneAt)
      db.prepare(`UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?`).run(
        doneAt,
        usedModel,
        conversationId,
      )

      const cost = estimateCredits(usage || { total_tokens: Math.ceil(fullText.length / 4) })
      deductCredits(req.user.id, cost)

      writeSse(res, '[DONE]')
      res.end()
    } catch (streamErr) {
      writeSse(res, {
        error: { message: streamErr.message || 'Stream failed', type: 'server_error' },
      })
      res.end()
    }
  } catch (err) {
    if (!res.headersSent) next(err)
    else {
      try {
        writeSse(res, { error: { message: err.message || 'Stream failed', type: 'server_error' } })
        res.end()
      } catch {
        // connection already closed
      }
    }
  }
})

export default router
