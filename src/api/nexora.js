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

export async function upgradePlan(token, plan = 'pro') {
  const res = await fetch(`${API_BASE}/api/user/upgrade`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ plan }),
  })
  return parseJson(res)
}

export async function runTool(token, toolId, { prompt, input } = {}) {
  const res = await fetch(`${API_BASE}/api/tools/${toolId}/run`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ prompt, input }),
  })
  return parseJson(res)
}

/**
 * Stream chat like ChatGPT (SSE). Calls onDelta(textChunk) for each piece.
 * Returns { conversationId, fullText }.
 */
export async function streamChat({ token, message, conversationId = null, onDelta, onMeta }) {
  const res = await fetch(`${API_BASE}/api/chat/completions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ message, conversationId, stream: true }),
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

async function parseJson(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export { API_BASE, SESSION_KEY }
