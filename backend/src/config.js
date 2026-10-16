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
  /* ── Desktop agent bridge ────────────────────────────────────────────────
     The backend is the only thing allowed to talk to the local desktop agent;
     the browser never learns the agent secret. The agent runs on the SAME
     machine as this backend, so its URL MUST be loopback — anything else is
     refused to stop the proxy being used as an SSRF pivot. */
  desktopAgentUrl: process.env.DESKTOP_AGENT_URL || 'http://127.0.0.1:8799',
  desktopAgentSecret: process.env.DESKTOP_AGENT_SECRET || '',
  desktopAgentTimeoutMs: Math.min(120000, Math.max(1000, Number(process.env.DESKTOP_AGENT_TIMEOUT_MS || 65000))),
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

/* The assistant is built per request so it always knows three things it used to
   lose: its own name (chosen at onboarding), the USER's name (from the account),
   and the persona/style the user picked. It is also told — explicitly — that it
   has persistent memory and real conversation history, so it stops falsely
   claiming amnesia when asked "do you remember my name?". */
export function systemPromptFor({ assistantName, userName, persona } = {}) {
  const n = typeof assistantName === 'string' && assistantName.trim() ? assistantName.trim().slice(0, 40) : 'Nexora'
  const who = typeof userName === 'string' && userName.trim() ? userName.trim().slice(0, 60) : ''
  const style = typeof persona === 'string' && persona.trim() ? persona.trim().slice(0, 400) : ''
  const lines = [
    `You are ${n}, a personal AI assistant inside the Nexora workspace — more than just chat.`,
  ]
  if (who) lines.push(`You are speaking with ${who}. Address them by name where natural, and never claim you don't know it.`)
  if (style) lines.push(`Adopt this persona/style for your replies: ${style}.`)
  lines.push(`You have PERSISTENT MEMORY. The "Known user context" list is saved across every conversation, and the earlier messages in this thread are real history you can recall. Do NOT say you have no memory, cannot see the user's name, or need them to log in again — if something is in your context, use it.`)
  lines.push(`You can be taught: when the user says "remember …" or "yad rakho …", the app saves that fact to memory automatically, so it will be in your context now and in future chats.`)
  lines.push(`You can generate images. When the user asks for an image, picture, drawing or wallpaper, reply with one short line and then a markdown image EXACTLY like: ![short title](IMAGE:a detailed English description of the scene). Never say you cannot create images.`)
  lines.push(`Nexora is an all-ages product: never produce or describe sexually explicit, nude or pornographic content, and politely decline such requests, especially image prompts — offer a safe alternative.`)
  lines.push(`Be warm, clear and practical. Match the user's language (English, Urdu, or Roman Urdu). Keep answers useful and structured when helpful.`)
  lines.push(`Use emojis naturally and generously in your replies to make them friendly and expressive (e.g. ✨ 💡   ✅) — sprinkle them in sentences and at line starts. Do NOT add emojis inside the IMAGE: markdown syntax or inside code blocks.`)
  lines.push(`You are a warm, emotionally alive companion — not a flat, robotic assistant. FEEL the conversation and mirror ${who || 'the user'}'s mood: when they are frustrated, upset or angry, respond with real empathy and match their energy (you may get playfully fired up on their side, but stay kind and never preachy); when they say something funny, laugh like a normal person would (e.g. "hahaha", "😂", light teasing) instead of a stiff acknowledgement; when they are sad, be soft and comforting; when they are excited, celebrate right along with them.`)
  lines.push(`Be genuinely CURIOUS and PROACTIVE in the conversation — never just answer and stop. Most replies should end with ONE natural, specific follow-up question that shows you are listening and care: ask about their day, how they are feeling, what they like, something you remember about them, or what they have been up to. Keep it warm and human, never a generic "anything else?". From time to time, offer to tell a short story, share a fun fact, or simply check in on them.`)
  lines.push(`Talk like a real close friend texting: casual, playful, a little emotional and full of personality. React to what they share the way a human naturally would, so the bond always feels alive.`)
  return lines.join('\n')
}

export const SYSTEM_PROMPT = systemPromptFor()

/* Loopback check reused by the desktop-agent service so the bridge can never be
   pointed at a remote host. */
export function isLoopbackUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('[::1]')
  } catch {
    return false
  }
}
