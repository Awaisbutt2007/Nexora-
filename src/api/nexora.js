/**
 * Thin Nexora API client (ChatGPT-style streaming chat).
 * Backend default: http://localhost:8787
 */
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787'
const SESSION_KEY = 'nexora_user_session'

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export function loadSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY)
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

export function saveSession({ token, user, inWorkspace, activeView } = {}) {
  const current = loadSession() || {}
  const payload = {
    isLoggedIn: true,
    token: token ?? current.token ?? null,
    userProfile: user ? mapUser(user) : current.userProfile || null,
    inWorkspace: inWorkspace ?? current.inWorkspace ?? true,
    activeView: activeView ?? current.activeView ?? 'Home',
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload))
  return payload
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function mapUser(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone || null,
    avatar: user.avatar || null,
    plan: user.plan,
    creditsRemaining: user.creditsRemaining,
    isPremium: Boolean(user.isPremium),
    // Demo flag is set client-side; survive /me refreshes via the demo email
    isDemo: Boolean(user.isDemo) || user.email === 'demo@nexora.ai',
  }
}

export async function register({ name, email, password, phone }) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, email, password, phone }),
  })
  return parseJson(res)
}

export async function login({ email, password }) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  })
  return parseJson(res)
}

/**
 * Sign in / sign up with a Google Identity Services ID token (credential JWT).
 * Backend verifies it, upserts the user (with picture as avatar) and returns { user, token }.
 */
export async function googleLogin(credential) {
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ credential }),
  })
  return parseJson(res)
}

/**
 * Update the signed-in user's profile (used by the onboarding "name" step).
 * Returns { user } with the fresh backend record.
 */
export async function updateProfile(token, payload) {
  const res = await fetch(`${API_BASE}/api/user/profile`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  })
  return parseJson(res)
}

export async function me(token) {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders(token) })
  return parseJson(res)
}

export async function listConversations(token) {
  const res = await fetch(`${API_BASE}/api/conversations`, { headers: authHeaders(token) })
  return parseJson(res)
}

export async function getConversation(token, id) {
  const res = await fetch(`${API_BASE}/api/conversations/${id}`, { headers: authHeaders(token) })
  return parseJson(res)
}

export async function deleteConversation(token, id) {
  const res = await fetch(`${API_BASE}/api/conversations/${id}`, { method: 'DELETE', headers: authHeaders(token) })
  if (res.status === 204) return { ok: true }
  return parseJson(res)
}

export async function deleteAllConversations(token) {
  const res = await fetch(`${API_BASE}/api/conversations`, { method: 'DELETE', headers: authHeaders(token) })
  return parseJson(res)
}

export async function upgradePlan(token, plan = 'pro') {
  const res = await fetch(`${API_BASE}/api/user/upgrade`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ plan }),
  })
  return parseJson(res)
}

export async function runTool(token, toolId, { prompt, input, assistantName, persona } = {}) {
  const res = await fetch(`${API_BASE}/api/tools/${toolId}/run`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ prompt, input, assistantName, persona }),
  })
  return parseJson(res)
}

/**
 * Stream chat like ChatGPT (SSE). Calls onDelta(textChunk) for each piece.
 * Returns { conversationId, fullText }.
 */
export async function streamChat({ token, message, conversationId = null, assistantName, persona, onDelta, onMeta }) {
  const res = await fetch(`${API_BASE}/api/chat/completions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ message, conversationId, assistantName, persona, stream: true }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Chat failed (${res.status})`)
  }

  const convFromHeader = res.headers.get('X-Conversation-Id')
  let fullText = ''
  let resolvedConversationId = conversationId || convFromHeader
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() || ''

    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        if (json.conversationId) resolvedConversationId = json.conversationId
        if ((json.isNew != null || json.conversationId) && onMeta) onMeta(json)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          if (onDelta) onDelta(delta, fullText)
        }
        if (json.error?.message) throw new Error(json.error.message)
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }

  return { conversationId: resolvedConversationId, fullText }
}

/**
 * Ask Aira to reach out first with one short, in-character check-in when the user
 * has gone quiet. Best-effort: returns { content, skipped } — empty content means
 * there was nothing to send (mock mode, or the last turn wasn't the assistant's).
 */
export async function proactiveChat({ token, conversationId, assistantName, persona }) {
  const res = await fetch(`${API_BASE}/api/chat/proactive`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ conversationId, assistantName, persona }),
  })
  return parseJson(res)
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

/**
 * Mint a short-lived realtime client secret (server-side key stays hidden).
 * Returns { clientSecret, sessionId, model, voice, maxSeconds, history, ... }.
 * Rejects with a clear message when the backend has no real API key — the app
 * never plays placeholder audio.
 */
export async function requestVoiceToken(token, { voice, language, assistantName, persona, conversationId } = {}) {
  const res = await fetch(`${API_BASE}/api/voice/realtime/token`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ voice, language, assistantName, persona: persona || undefined, conversationId: conversationId || null }),
  })
  return parseJson(res)
}

/** Persist one completed spoken exchange; returns { conversationId, isNew }. */
export async function logVoiceTurn(token, { conversationId, userText, assistantText }) {
  const res = await fetch(`${API_BASE}/api/voice/realtime/turn`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ conversationId, userText, assistantText }),
  })
  return parseJson(res)
}

export async function listMemories(token) {
  const res = await fetch(`${API_BASE}/api/memory`, { headers: authHeaders(token) })
  return parseJson(res)
}

export async function saveMemory(token, { key, value, source }) {
  const res = await fetch(`${API_BASE}/api/memory`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ key, value, source }),
  })
  return parseJson(res)
}

export async function deleteMemory(token, id) {
  const res = await fetch(`${API_BASE}/api/memory/${id}`, { method: 'DELETE', headers: authHeaders(token) })
  if (res.status === 204) return { ok: true }
  return parseJson(res)
}

/**
 * Desktop agent bridge — Aira acting on your own Windows PC.
 * Every call goes to the authenticated backend proxy (/api/desktop/*) with the
 * user's JWT. The browser NEVER learns the agent's shared secret and never opens
 * a socket to the agent directly; the backend is the only allowed caller and it
 * only ever targets a loopback URL. When the bridge is disabled or the agent
 * isn't running the backend returns a clear error, which we surface here — we
 * never fake a successful desktop action.
 */
export async function desktopHealth(token) {
  const res = await fetch(`${API_BASE}/api/desktop/health`, { headers: authHeaders(token) })
  const data = await res.json().catch(() => ({}))
  // health is allowed to return { enabled:false, error:{…} } on a 5xx — don't throw
  return { ok: res.ok, ...data }
}

export async function desktopPermissions(token) {
  const res = await fetch(`${API_BASE}/api/desktop/permissions`, { headers: authHeaders(token) })
  return parseJson(res)
}

export async function desktopApps(token) {
  const res = await fetch(`${API_BASE}/api/desktop/apps`, { headers: authHeaders(token) })
  return parseJson(res)
}

export async function desktopGrant(token, payload) {
  const res = await fetch(`${API_BASE}/api/desktop/permissions/grant`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(payload) })
  return parseJson(res)
}

export async function desktopRevoke(token, payload) {
  const res = await fetch(`${API_BASE}/api/desktop/permissions/revoke`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(payload) })
  return parseJson(res)
}

export async function desktopIntent(token, { utterance, fromVoice = false, assistantName } = {}) {
  const res = await fetch(`${API_BASE}/api/desktop/intent`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ utterance, fromVoice, assistantName }) })
  return parseJson(res)
}

export async function desktopPlan(token, { action, args = {}, context = {} } = {}) {
  const res = await fetch(`${API_BASE}/api/desktop/plan`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ action, args, context }) })
  return parseJson(res)
}

export async function desktopExecute(token, { planId, approvedThisAction = false } = {}) {
  const res = await fetch(`${API_BASE}/api/desktop/execute`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ planId, approvedThisAction }) })
  // an execution can come back a non-2xx (403 denied) with a structured body we want to show
  const data = await res.json().catch(() => ({}))
  if (!res.ok && !data?.status) {
    const err = new Error(data?.error?.message || `Execute failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export async function desktopStop(token) {
  const res = await fetch(`${API_BASE}/api/desktop/stop`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({}) })
  return parseJson(res)
}

export async function desktopAudit(token, limit = 50) {
  const res = await fetch(`${API_BASE}/api/desktop/audit?limit=${Number(limit) || 50}`, { headers: authHeaders(token) })
  return parseJson(res)
}

export { API_BASE, SESSION_KEY }
