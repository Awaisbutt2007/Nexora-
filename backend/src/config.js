import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'nexora-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  freeMonthlyCredits: Number(process.env.FREE_MONTHLY_CREDITS || 5000),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'nexora.db'),
  uploadsDir: path.join(root, 'uploads'),
  rootDir: root,
  /* Speaker verification (Section 8): cosine-similarity pass mark, 0..1 */
  voiceMatchThreshold: Number(process.env.VOICE_MATCH_THRESHOLD || 0.8),
  /* Optional SpeechBrain-style x-vector service; empty → local DSP embeddings */
  speechbrainUrl: process.env.SPEECHBRAIN_URL || '',
}

export const PLANS = {
  free: {
    id: 'free',
    name: 'Starter',
    pricePkr: 6000,
    credits: config.freeMonthlyCredits,
    features: ['helpful_ai', 'everyday_tools', 'basic_memory'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    pricePkr: 10000,
    credits: null,
    features: ['premium_models', 'faster_tools', 'unlimited_credits', 'priority'],
  },
  yearly_pro: {
    id: 'yearly_pro',
    name: 'Yearly Pro',
    pricePkr: 80000,
    credits: null,
    features: ['premium_models', 'faster_tools', 'unlimited_credits', 'priority', 'yearly_discount'],
  },
}

export const SYSTEM_PROMPT = `You are Nexora, a personal AI assistant — more than just chat.
You help with conversation, creative work, code, planning, files, and memory.
Be warm, clear, and practical. Match the user's language (English, Urdu, or Roman Urdu).
Keep answers useful and structured when helpful. You are part of the Nexora workspace.`
