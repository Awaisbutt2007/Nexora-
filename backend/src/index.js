import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { getDb } from './db/index.js'
import { errorHandler, notFound } from './middleware/error.js'
import authRoutes from './routes/auth.js'
import chatRoutes from './routes/chat.js'
import conversationRoutes from './routes/conversations.js'
import desktopRoutes from './routes/desktop.js'
import memoryRoutes from './routes/memory.js'
import realtimeRoutes from './routes/realtime.js'
import toolsRoutes from './routes/tools.js'
import userRoutes from './routes/user.js'
import voiceRoutes from './routes/voice.js'

fs.mkdirSync(config.uploadsDir, { recursive: true })
getDb()

const app = express()

/* Behind a reverse proxy, trust the first hop so req.ip (used by the auth rate
   limiter) is the real client, not the load balancer. Off by default in local dev. */
app.set('trust proxy', config.trustProxy ? 1 : false)

/* CORS is an exact origin list in production, but in development a request from any
   local origin is allowed too — see config.corsAllowLocalOrigins for why an unlisted
   origin is indistinguishable from a broken login on the client. */
const corsAllowlist = config.corsOrigin === '*' ? null : config.corsOrigin.split(',').map((s) => s.trim())
// localhost / 127.x.x.x / ::1, plus the RFC 1918 ranges a dev LAN lives in.
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|\[::1\]|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{2,5})?$/

app.use(
  cors({
    // cors v2 hands the custom resolver the request's Origin STRING, not the request.
    origin: (origin, callback) => {
      // No Origin header = not a CORS request (same-origin, curl, server-to-server).
      if (!origin) return callback(null, false)
      if (!corsAllowlist) return callback(null, true)
      if (corsAllowlist.includes(origin)) return callback(null, true)
      return callback(null, Boolean(config.corsAllowLocalOrigins && LOCAL_ORIGIN.test(origin)))
    },
    credentials: true,
    exposedHeaders: ['X-Conversation-Id'],
  }),
)
app.use(express.json({ limit: '2mb' }))

/* User-attached reference images are saved under uploads/ with unguessable
   nanoid names and served straight from here — plain <img src> tags cannot
   send an Authorization header. The files themselves stay outside /api. */
app.use('/uploads', express.static(config.uploadsDir, { index: false, maxAge: '7d' }))

/* Baseline security headers. This is a JSON API (no HTML is served or framed),
   so a small, dependency-free set is enough and never blocks the SSE stream. */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'nexora-backend',
    time: new Date().toISOString(),
    ai: config.openaiApiKey ? 'openai' : 'mock',
    model: config.openaiModel,
    voice: config.openaiApiKey ? config.voiceProvider : 'unavailable (set OPENAI_API_KEY)',
    voiceModel: config.voiceRealtimeModel,
  })
})

app.get('/', (_req, res) => {
  res.json({
    name: 'Nexora API',
    version: '1.0.0',
    docs: {
      health: 'GET /health',
      auth: ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me'],
      chat: 'POST /api/chat/completions  { message, stream?, conversationId? }',
      conversations: 'GET|POST /api/conversations',
      memory: 'GET|POST /api/memory',
      tools: 'GET /api/tools  |  POST /api/tools/:toolId/run',
      desktop: 'GET /api/desktop/health | POST /api/desktop/intent | POST /api/desktop/plan | POST /api/desktop/execute | POST /api/desktop/stop',
      user: 'GET /api/user/profile  |  POST /api/user/upgrade',
      voice: 'POST /api/voice/enroll  |  POST /api/voice/verify  |  GET|DELETE /api/voice/prints',
      realtime: 'POST /api/voice/realtime/token  |  POST /api/voice/realtime/turn',
    },
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/memory', memoryRoutes)
app.use('/api/desktop', desktopRoutes)
app.use('/api/tools', toolsRoutes)
app.use('/api/user', userRoutes)
app.use('/api/voice/realtime', realtimeRoutes)
app.use('/api/voice', voiceRoutes)

app.use(notFound)
app.use(errorHandler)

export { app }

/* Only bind a port when this file is the entry point (`node src/index.js` /
   `npm run dev`). Importing `app` from the test suite starts it on an ephemeral
   port instead, so the automated tests never fight the dev server for :8787. */
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  app.listen(config.port, config.host, () => {
    console.log(`Nexora backend listening on http://${config.host}:${config.port}`)
    console.log(`AI mode: ${config.openaiApiKey ? `OpenAI (${config.openaiModel})` : 'mock streaming (set OPENAI_API_KEY)'}`)
  })
}
