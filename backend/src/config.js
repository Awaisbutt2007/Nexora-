import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const DEFAULT_DEV_JWT_SECRET = 'nexora-dev-secret-change-me'

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || DEFAULT_DEV_JWT_SECRET,
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
  /* Realtime voice calls (speech-to-speech). Provider kept pluggable so another
     vendor can replace openai-realtime without touching routes or the UI. */
  voiceProvider: process.env.VOICE_PROVIDER || 'openai-realtime',
  voiceRealtimeModel: process.env.VOICE_REALTIME_MODEL || 'gpt-realtime-2.1',
  voiceDefaultVoice: process.env.VOICE_VOICE || 'marin',
  voiceTranscribeModel: process.env.VOICE_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
  /* Speech tempo — the provider's documented post-processing multiple of the
     model's spoken response (1.0 default, 0.25..1.5). Nudged just above 1 so
     Aira doesn't drag; clamped so a bad env value can't warp the audio. */
  voiceOutputSpeed: Math.min(1.5, Math.max(0.25, Number(process.env.VOICE_OUTPUT_SPEED || 1.1) || 1.1)),
  /* How eagerly Aira starts replying once you stop: low(8s) medium(4s) high(2s)
     max wait. Stays 'medium' by default so she never cuts in on your pauses. */
  voiceTurnEagerness: ['low', 'medium', 'high'].includes(process.env.VOICE_TURN_EAGERNESS) ? process.env.VOICE_TURN_EAGERNESS : 'medium',
  /* Hard cap per voice session, well under the provider's 60-minute limit */
  voiceMaxSessionSeconds: Math.min(3600, Number(process.env.VOICE_MAX_SESSION_SECONDS || 1800)),
  /* Sliding-window guard: at most N fresh voice sessions per user per window */
  voiceRateLimit: Number(process.env.VOICE_RATE_LIMIT_PER_10MIN || 5),
  /* Auth brute-force guard (in-memory sliding window). Caps attempts per
     email+IP and per IP over the window so credential stuffing is throttled. */
  authRateLimit: Math.max(1, Number(process.env.AUTH_RATE_LIMIT || 8)),
  authIpRateLimit: Math.max(1, Number(process.env.AUTH_IP_RATE_LIMIT || 30)),
  authRateWindowMs: Math.max(60000, Math.round((Number(process.env.AUTH_RATE_WINDOW_SECONDS || 300) || 300) * 1000)),
  /* Behind a reverse proxy (Render/Fly/nginx) req.ip is the proxy unless trust
     proxy is on; defaults to on in production so the rate limiter sees real IPs. */
  trustProxy: process.env.TRUST_PROXY === 'true' || (process.env.NODE_ENV || 'development') === 'production',
}

/* Fail-fast on the two env mistakes that ship quietly to prod and turn into
   an auth bypass: leaving the demo JWT secret in place, or letting CORS
   default to localhost when the app is meant to be public. */
if (config.nodeEnv === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set to a strong random value in production (the shipped dev default is refused).')
  }
  if (/localhost|127\.0\.0\.1/.test(config.corsOrigin)) {
    throw new Error('CORS_ORIGIN still points at localhost in production — set it to the real frontend origin(s).')
  }
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
