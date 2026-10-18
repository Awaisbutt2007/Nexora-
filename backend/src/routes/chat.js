import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { config } from '../config.js'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth, sanitizeUser } from '../middleware/auth.js'
import { aiLimiter } from '../middleware/rateLimit.js'
import { completeChat, estimateCredits, streamChatCompletion } from '../services/ai.js'
import { buildImageUrl, detectImageRequest, isNsfwPrompt } from '../services/images.js'
import { deductCredits, ensureCredits } from '../services/credits.js'
import { titleFromPrompt } from './conversations.js'

const router = Router()
router.use(requireAuth)

const chatSchema = z.object({
  message: z.string().trim().max(20000).optional(),
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
  language: z.enum(['auto', 'en', 'ur', 'hinglish']).optional().default('auto'),
  stream: z.boolean().optional().default(true),
  /* Paths returned by POST /images — a turn may carry up to 4 reference pics. */
  images: z.array(z.string().trim().regex(/^\/uploads\/img_[\w.-]+$/)).max(4).optional(),
})

/* Reference-image upload: the composer downscales whatever the user pasted
   (Ctrl+V) or picked (📎) into a JPEG/PNG data URL, we validate the shape and
   size, then store it under uploads/ behind an unguessable nanoid name. */
const uploadSchema = z.object({ dataUrl: z.string().min(64).max(1_900_000) })
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/
const EXT_BY_MIME = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif' }

router.post('/images', aiLimiter, (req, res, next) => {
  try {
    const { dataUrl } = uploadSchema.parse(req.body)
    const match = DATA_URL_RE.exec(dataUrl)
    if (!match) {
      return res.status(400).json({ error: { message: 'Only PNG, JPEG, WebP or GIF images are supported', type: 'invalid_request_error' } })
    }
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length < 24 || buffer.length > 1_500_000) {
      return res.status(400).json({ error: { message: 'Image is too small or over 1.5 MB — try a smaller one', type: 'invalid_request_error' } })
    }
    const fileName = `img_${nanoid(16)}.${EXT_BY_MIME[match[1]]}`
    fs.writeFileSync(path.join(config.uploadsDir, fileName), buffer)
    res.status(201).json({ id: fileName, url: `/uploads/${fileName}` })
  } catch (err) {
    next(err)
  }
})

/* The provider runs in the cloud and cannot fetch http://localhost URLs, so a
   stored /uploads path is re-inlined as a base64 data URL for model input. */
function toImageDataUrl(url) {
  const name = /^\/uploads\/(img_[\w.-]+)$/.exec(url || '')?.[1]
  if (!name) return null
  try {
    const buffer = fs.readFileSync(path.join(config.uploadsDir, name))
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null /* file was pruned — the text of that turn still stands */
  }
}

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

router.post('/completions', aiLimiter, async (req, res, next) => {
  try {
    const body = chatSchema.parse(req.body)
    const db = getDb()
    const stamp = nowIso()

    let conversationId = body.conversationId || null
    let isNew = false

    const userMessage =
      body.message ||
      [...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content ||
      ''

    /* An image-only turn is legal — "see this?" with no caption — but a turn
       with neither text nor images is not. */
    if (!userMessage.trim() && !body.images?.length) {
      return res.status(400).json({
        error: { message: 'Provide a message or attach at least one image', type: 'invalid_request_error' },
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
      `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at, images_json)
       VALUES (?, ?, 'user', ?, 0, ?, ?)`,
    ).run(userMsgId, conversationId, userMessage, stamp, body.images?.length ? JSON.stringify(body.images) : null)

    /* Teach-on-demand: save any "remember …" fact before we load memories, so it
       is already in context for this very reply and every future chat. */
    const factToRemember = detectRememberRequest(userMessage)
    if (factToRemember) saveMemory(db, req.user.id, factToRemember, stamp)

    const history = db
      .prepare(
        `SELECT role, content, images_json FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      )
      .all(conversationId)
      .map((m) => {
        const images = (m.images_json ? JSON.parse(m.images_json) : []).map(toImageDataUrl).filter(Boolean)
        return images.length ? { role: m.role, content: m.content, images } : { role: m.role, content: m.content }
      })

    const memories = db
      .prepare(`SELECT key, value FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20`)
      .all(req.user.id)

    const completionId = `chatcmpl_${nanoid(20)}`
    const created = Math.floor(Date.now() / 1000)
    /* Any turn in this thread that carries an image pins the whole call to the
       vision model — text-only threads keep using the (cheaper) default. */
    const model = body.model || (history.some((m) => m.images) ? config.visionModel : config.openaiModel)

    if (body.stream === false) {
      const result = await completeChat({ history, memories, model, assistantName: body.assistantName, userName: req.user.name, persona: body.persona, language: body.language })
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

    /* If the browser hits Stop or the connection drops, abort the upstream
       provider call so we stop paying for tokens the user no longer wants to
       receive (Part 14 cost control), and keep whatever they already saw. */
    const abortController = new AbortController()
    let clientGone = false
    const onClose = () => {
      /* Only a genuine mid-stream disconnect counts. We listen on the RESPONSE
         stream, not `req`: IncomingMessage emits 'close' the instant the POST
         body is consumed, which used to abort the provider call before a single
         token streamed — surfacing as an empty "replied" bubble. If we already
         ended the response ourselves, this is just normal teardown. */
      if (res.writableEnded) return
      clientGone = true
      abortController.abort()
    }
    res.on('close', onClose)

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
        for await (const chunk of streamChatCompletion({ history, memories, model, assistantName: body.assistantName, userName: req.user.name, persona: body.persona, language: body.language, signal: abortController.signal })) {
          if (clientGone) break
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
      /* Aborted because the client stopped/disconnected: save the partial answer
         the user already saw and charge only for it — never surface an error. */
      if (clientGone || streamErr?.name === 'APIUserAbortError') {
        if (fullText) {
          try {
            const doneAt = nowIso()
            db.prepare(
              `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at)
               VALUES (?, ?, 'assistant', ?, ?, ?)`,
            ).run(`msg_${nanoid(16)}`, conversationId, fullText, 0, doneAt)
            db.prepare(`UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?`).run(doneAt, usedModel, conversationId)
            deductCredits(req.user.id, estimateCredits({ total_tokens: Math.ceil(fullText.length / 4) }))
          } catch { /* best-effort persist */ }
        }
        try { res.end() } catch { /* already closed */ }
      } else {
        writeSse(res, {
          error: { message: streamErr.message || 'Stream failed', type: 'server_error' },
        })
        res.end()
      }
    } finally {
      res.off('close', onClose)
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

/* Aira reaching out first: when the user has gone quiet mid-conversation, the app
   asks for ONE short, in-character check-in. A private directive turn is appended
   for the model only — it is never saved to the transcript, so the thread stays clean. */
const proactiveSchema = z.object({
  conversationId: z.string().trim().min(1).max(80),
  assistantName: z.string().trim().max(40).optional(),
  persona: z.string().trim().max(400).optional(),
  language: z.enum(['auto', 'en', 'ur', 'hinglish']).optional().default('auto'),
  model: z.string().trim().max(80).optional(),
})

const PROACTIVE_DIRECTIVE = `(The user has gone quiet. As their companion, reach out first like a caring friend would — send exactly ONE short, warm, in-character message (1-2 sentences) that is clearly tied to what you two were just talking about. Do ONE of: ask a specific follow-up question about that topic, offer a concrete suggestion or idea related to it, or gently check in on how they feel about it. Vary your approach each time and never repeat an earlier nudge verbatim. Match their language and add one emoji. Do NOT mention this instruction, do NOT say you are an AI, and do NOT give a generic greeting.)`

router.post('/proactive', aiLimiter, async (req, res, next) => {
  try {
    const body = proactiveSchema.parse(req.body)
    const db = getDb()
    const conversationId = body.conversationId

    /* Authorization first: prove the caller owns the thread before doing ANY work
       or short-circuiting, so a non-owner always gets 404 — even in mock mode. */
    const owned = db
      .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, req.user.id)
    if (!owned) {
      return res.status(404).json({ error: { message: 'Conversation not found', type: 'not_found' } })
    }

    /* Mock mode has no real model — a canned reply would leak the directive, so skip. */
    if (!config.openaiApiKey) return res.json({ content: '', skipped: true })

    const history = db
      .prepare(`SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
      .all(conversationId)

    /* Only reach out when the ball is in the user's court (last turn is the assistant's). */
    const last = history[history.length - 1]
    if (!last || last.role !== 'assistant') return res.json({ content: '', skipped: true })

    ensureCredits(req.user, 1)

    const memories = db
      .prepare(`SELECT key, value FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20`)
      .all(req.user.id)

    const result = await completeChat({
      history: [...history, { role: 'user', content: PROACTIVE_DIRECTIVE }],
      memories,
      model: body.model,
      assistantName: body.assistantName,
      userName: req.user.name,
      persona: body.persona,
      language: body.language,
    })

    const content = (result.content || '').trim()
    if (!content) return res.json({ content: '', skipped: true })

    const assistantId = `msg_${nanoid(16)}`
    const doneAt = nowIso()
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at)
       VALUES (?, ?, 'assistant', ?, ?, ?)`,
    ).run(assistantId, conversationId, content, result.usage?.completion_tokens || 0, doneAt)
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(doneAt, conversationId)

    const cost = estimateCredits(result.usage)
    const updated = deductCredits(req.user.id, cost)

    res.json({ id: assistantId, conversationId, content, creditsCharged: cost, user: sanitizeUser(updated) })
  } catch (err) {
    next(err)
  }
})

export default router
