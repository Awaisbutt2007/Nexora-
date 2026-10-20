/**
 * Thin Nexora API client (ChatGPT-style streaming chat).
 * Every request is same-origin unless VITE_API_URL says otherwise.
 */
/* One rule for every surface: the page talks to whatever served it. Dev and `npm run preview`
   proxy /api and /uploads to the backend (vite.config.js), and a production build is HOSTED by
   that same backend (backend/src/index.js serves dist/), so no port rollover, LAN address,
   phone or stale tab can ever trip CORS — the failure class that read as "Failed to fetch"
   while creating an account. Set VITE_API_URL only when the frontend is deployed apart from
   its API (then the backend must list that origin in CORS_ORIGIN). */
const API_BASE = import.meta.env.VITE_API_URL ?? ''
const SESSION_KEY = 'nexora_user_session'

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/** The one instruction every "the API is not answering" path should end with. */
function backendUnreachableText() {
  if (API_BASE) {
    return `Can't reach ${API_BASE}. Start that API with "npm run dev:api" (port 8787) and try again.`
  }
  const how = import.meta.env.DEV
    ? 'nothing answered the /api requests this page proxies to port 8787'
    : 'the backend that serves this page is not running'
  return `Can't reach the Nexora API — ${how}. Run "npm run dev:all", then reload this page.`
}

/** A fetch that never reached the server (backend down, or CORS refused the port the
 *  page is served from) throws a bare TypeError whose message is "Failed to fetch" —
 *  which reads like a wrong password and sends users hunting for a bug that isn't there.
 *  Name the real cause and the fix instead. */
export function apiErrorText(err, fallback = 'Request failed — is the backend running?') {
  const msg = typeof err?.message === 'string' ? err.message : ''
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg)) {
    return backendUnreachableText()
  }
  return msg || fallback
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
    /* Companion choices (reply language, voice, name, persona, face) saved on the
       account — the workspace hydrates from it so the setting follows the user to
       any origin or device instead of silently resetting to 'auto'. */
    prefs: user.prefs && typeof user.prefs === 'object' ? user.prefs : null,
    // Demo flag is set client-side; survive /me refreshes via the demo email
    isDemo: Boolean(user.isDemo) || user.email === 'demo@nexora.ai',
  }
}

/* One quiet retry for the auth endpoints. `node --watch` restarts the backend on every
   edit, and any blip in that window reaches the browser as a bare TypeError ("Failed to
   fetch") — or, once the request goes through the dev-server proxy, as an empty 502.
   Either way a user reads it as "my login is broken", so try again ~700ms later. */
async function authFetch(path, payload) {
  const send = () => fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  try {
    const res = await send()
    if (res.status !== 502 && res.status !== 504) return res
    await new Promise((resolve) => setTimeout(resolve, 700))
    return send()
  } catch (err) {
    if (!(err instanceof TypeError)) throw err
    await new Promise((resolve) => setTimeout(resolve, 700))
    return send()
  }
}

export async function register({ name, email, password, phone }) {
  try {
    return await parseJson(await authFetch('/api/auth/register', { name, email, password, phone }))
  } catch (err) {
    /* That email already has an account — the user pressed Create Account, so honour it
       and sign them straight in instead of throwing a 409 at them. This is also what makes
       a double submit (retry, reload, second tab) land inside rather than error out. */
    if (err.status !== 409) throw err
    return login({ email, password })
  }
}

export async function login({ email, password }) {
  return parseJson(await authFetch('/api/auth/login', { email, password }))
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

/** Upload one downscaled reference image (data URL) for a chat attachment. */
export async function uploadChatImage(token, dataUrl) {
  const res = await fetch(`${API_BASE}/api/chat/images`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ dataUrl }),
  })
  return parseJson(res)
}

/** Turn a backend-relative resource path (/uploads/img_x.jpg) into a full URL. */
export function resourceUrl(path) {
  return path?.startsWith('/') ? `${API_BASE}${path}` : path
}

/**
 * Change the signed-in account's email. Requires the current password so a
 * stolen token alone can't hijack the account. Returns { user, token }.
 */
export async function updateEmail(token, { currentPassword, email }) {
  const res = await fetch(`${API_BASE}/api/auth/email`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ currentPassword, email }),
  })
  return parseJson(res)
}

/** Change the account password (needs the current one). Returns { user }. */
export async function updatePassword(token, { currentPassword, newPassword }) {
  const res = await fetch(`${API_BASE}/api/auth/password`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ currentPassword, newPassword }),
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

/** Hang self-captured screenshots (/uploads paths from uploadChatImage) on an
 *  assistant turn so the picture is part of the thread and not just a live trick.
 *  `markers` are the [SCREENSHOT:…] lines actually fulfilled, so the caption survives
 *  a reload even when the model never wrote one. */
export async function attachMessageImages(token, conversationId, messageId, images, markers) {
  const res = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ images, ...(markers?.length ? { markers } : {}) }),
  })
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
export async function streamChat({ token, message, conversationId = null, assistantName, persona, gender, language, images, replyTo, replyToText, onDelta, onMeta, signal }) {
  const res = await fetch(`${API_BASE}/api/chat/completions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ message, conversationId, assistantName, persona, gender, language, images, replyTo, replyToText, stream: true }),
    signal,
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
    let result
    try {
      result = await reader.read()
    } catch (e) {
      // User pressed Stop: keep the partial answer already rendered, don't throw.
      if (e?.name === 'AbortError') break
      throw e
    }
    const { done, value } = result
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
 * `composing` / `withdrewDraft` describe what the composer was doing when the clock
 * ran out, so she can ask about a half-written message instead of ignoring it.
 * Flags only — the draft's text never leaves the page.
 */
export async function proactiveChat({ token, conversationId, assistantName, persona, gender, language, composing, withdrewDraft }) {
  const res = await fetch(`${API_BASE}/api/chat/proactive`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ conversationId, assistantName, persona, gender, language, ...(composing ? { composing: true } : {}), ...(withdrewDraft ? { withdrewDraft: true } : {}) }),
  })
  return parseJson(res)
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    /* A dev-server proxy whose target refused the connection answers 502/504 with an empty
       body, so "the backend is not running" would otherwise arrive as a bare number. */
    const deadGateway = (res.status === 502 || res.status === 504) && !data?.error?.message
    const err = new Error(
      data?.error?.message || (deadGateway ? backendUnreachableText() : `Request failed (${res.status})`),
    )
    err.status = res.status
    throw err
  }
  return data
}

/**
 * Mint a short-lived realtime client secret (server-side key stays hidden).
 * Returns { clientSecret, sessionId, voice, maxSeconds, history, ... } — deliberately
 * no provider or model name: the client authenticates with the secret, and the engine
 * behind a call is not information the browser (or its network tab) needs.
 * Rejects with a clear message when the backend has no real API key — the app
 * never plays placeholder audio.
 */
export async function requestVoiceToken(token, { voice, language, assistantName, persona, gender, conversationId } = {}) {
  const res = await fetch(`${API_BASE}/api/voice/realtime/token`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ voice, language, assistantName, persona: persona || undefined, gender, conversationId: conversationId || null }),
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

/* Scheduled tasks ("Schedule" section): plain CRUD plus the reminder pair —
   POST /reminders asks what needs saying right now (day-before + day-of), and
   the app immediately acks so the same nudge never fires twice per phase. */
export async function listSchedule(token) {
  const res = await fetch(`${API_BASE}/api/schedule`, { headers: authHeaders(token) })
  return parseJson(res)
}

export async function createScheduleTask(token, { title, notes, dueAt }) {
  const res = await fetch(`${API_BASE}/api/schedule`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ title, notes, dueAt }),
  })
  return parseJson(res)
}

export async function updateScheduleTask(token, id, patch) {
  const res = await fetch(`${API_BASE}/api/schedule/${id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  })
  return parseJson(res)
}

export async function deleteScheduleTask(token, id) {
  const res = await fetch(`${API_BASE}/api/schedule/${id}`, { method: 'DELETE', headers: authHeaders(token) })
  if (res.status === 204) return { ok: true }
  return parseJson(res)
}

export async function fetchScheduleReminders(token, meta) {
  const res = await fetch(`${API_BASE}/api/schedule/reminders`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(meta),
  })
  return parseJson(res)
}

export async function ackScheduleReminders(token, ids) {
  const res = await fetch(`${API_BASE}/api/schedule/reminders/ack`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ ids }),
  })
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
