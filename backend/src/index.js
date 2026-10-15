import fs from 'node:fs'
import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { getDb } from './db/index.js'
import { errorHandler, notFound } from './middleware/error.js'
import authRoutes from './routes/auth.js'
import chatRoutes from './routes/chat.js'
import conversationRoutes from './routes/conversations.js'
import memoryRoutes from './routes/memory.js'
import toolsRoutes from './routes/tools.js'
import userRoutes from './routes/user.js'
import voiceRoutes from './routes/voice.js'

fs.mkdirSync(config.uploadsDir, { recursive: true })
getDb()

const app = express()

app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ['X-Conversation-Id'],
  }),
)
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'nexora-backend',
    time: new Date().toISOString(),
    ai: config.openaiApiKey ? 'openai' : 'mock',
    model: config.openaiModel,
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
      user: 'GET /api/user/profile  |  POST /api/user/upgrade',
      voice: 'POST /api/voice/enroll  |  POST /api/voice/verify  |  GET|DELETE /api/voice/prints',
    },
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/memory', memoryRoutes)
app.use('/api/tools', toolsRoutes)
app.use('/api/user', userRoutes)
app.use('/api/voice', voiceRoutes)

app.use(notFound)
app.use(errorHandler)

app.listen(config.port, config.host, () => {
  console.log(`Nexora backend listening on http://${config.host}:${config.port}`)
  console.log(`AI mode: ${config.openaiApiKey ? `OpenAI (${config.openaiModel})` : 'mock streaming (set OPENAI_API_KEY)'}`)
})
