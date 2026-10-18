/* Nexora backend integration tests — Node's built-in runner, zero extra deps.
   Run:  npm test   (from backend/)  or  npm run test:api  (from repo root)

   Isolated & deterministic by design:
     - throwaway SQLite file in the OS temp dir (never touches data/nexora.db)
     - OPENAI_API_KEY forced empty → mock mode → no network, no paid usage
     - auth rate buckets raised → functional tests can't trip the brute-force guard
   Every env value is set BEFORE the app module is imported so config.js reads it. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TEST_DB = path.join(os.tmpdir(), `nexora-test-${process.pid}-${Date.now()}.db`)
process.env.NODE_ENV = 'test'
process.env.DB_PATH = TEST_DB
process.env.OPENAI_API_KEY = ''
process.env.JWT_SECRET = 'nexora-test-secret'
process.env.CORS_ORIGIN = 'http://localhost:5173'
process.env.AUTH_RATE_LIMIT = '1000'
process.env.AUTH_IP_RATE_LIMIT = '1000'
process.env.AI_RATE_LIMIT_PER_MIN = '1000'
process.env.FREE_MONTHLY_CREDITS = '5000'
/* Pin strict auth so the contract below is the real one; the open demo mode
   (default ON in dev) is exercised separately via a runtime config toggle. */
process.env.AUTH_OPEN_MODE = '0'

let server
let BASE
let dbHandle

before(async () => {
  const { app } = await import('../src/index.js')
  const { getDb } = await import('../src/db/index.js')
  dbHandle = getDb()
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  BASE = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  /* Close the SQLite handle first so Windows releases the file lock, then clean
     the throwaway DB. Best-effort: a lingering lock must never fail the run. */
  try { dbHandle?.close() } catch { /* already closed */ }
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    try { fs.rmSync(f, { force: true }) } catch { /* ignore locked temp file */ }
  }
})

async function api(method, p, { token, body } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* SSE stream or empty body */ }
  return { status: res.status, headers: res.headers, json, text }
}

let seq = 0
const email = () => `t${Date.now()}-${(seq += 1)}@nexora.test`
async function newUser(name = 'Test User') {
  const e = email()
  const r = await api('POST', '/api/auth/register', { body: { name, email: e, password: 'secret123' } })
  return { token: r.json.token, email: e, user: r.json.user }
}

test('health reports mock mode (no key)', async () => {
  const r = await api('GET', '/health')
  assert.equal(r.status, 200)
  assert.equal(r.json.status, 'ok')
  assert.equal(r.json.ai, 'mock')
})

test('auth: register → duplicate → login ok → login bad', async () => {
  const e = email()
  const reg = await api('POST', '/api/auth/register', { body: { name: 'Ada', email: e, password: 'secret123' } })
  assert.equal(reg.status, 201)
  assert.ok(reg.json.token, 'register returns a token')
  assert.equal(reg.json.user.email, e.toLowerCase())

  assert.equal((await api('POST', '/api/auth/register', { body: { name: 'Ada', email: e, password: 'secret123' } })).status, 409)
  assert.equal((await api('POST', '/api/auth/login', { body: { email: e, password: 'secret123' } })).status, 200)

  const bad = await api('POST', '/api/auth/login', { body: { email: e, password: 'nope' } })
  assert.equal(bad.status, 401)
  assert.equal(bad.json.error.type, 'auth_error')
})

test('auth: open demo mode signs in ANY email/password and auto-provisions', async () => {
  const { config } = await import('../src/config.js')
  config.openAuth = true
  try {
    /* Unknown email → login IS the signup. */
    const e = email()
    const r = await api('POST', '/api/auth/login', { body: { email: e, password: 'x' } })
    assert.equal(r.status, 200)
    assert.ok(r.json.token, 'unknown email gets a real token')
    assert.equal(r.json.user.email, e.toLowerCase())
    const me = await api('GET', '/api/auth/me', { token: r.json.token })
    assert.equal(me.status, 200, 'the issued token works on protected routes')
    /* Existing account + wrong password → still let through. */
    const w = await api('POST', '/api/auth/login', { body: { email: e, password: 'totally-different' } })
    assert.equal(w.status, 200)
    /* Register skips format/length rules too. */
    const reg = await api('POST', '/api/auth/register', { body: { email: `p${Date.now()}`, password: '1' } })
    assert.equal(reg.status, 201)
    assert.ok(reg.json.user.name, 'name is derived from the email when omitted')
  } finally {
    config.openAuth = false
  }
})

test('auth never serializes the password hash', async () => {
  const { token } = await newUser()
  const me = await api('GET', '/api/auth/me', { token })
  assert.equal(me.status, 200)
  assert.ok(!('password' in me.json.user) && !('password_hash' in me.json.user))
})

test('protected routes reject missing / forged tokens', async () => {
  assert.equal((await api('GET', '/api/conversations')).status, 401)
  assert.equal((await api('GET', '/api/memory', { token: 'not.a.jwt' })).status, 401)
})

test('account: PATCH profile name reflects in /me', async () => {
  const { token } = await newUser('Old Name')
  const r = await api('PATCH', '/api/user/profile', { token, body: { name: 'New Name' } })
  assert.equal(r.status, 200)
  assert.equal(r.json.user.name, 'New Name')
  assert.equal((await api('GET', '/api/auth/me', { token })).json.user.name, 'New Name')
})

test('account: change email needs the current password, then only the new one logs in', async () => {
  const { token, email: oldEmail } = await newUser()
  const newEmail = email()
  assert.equal((await api('POST', '/api/auth/email', { token, body: { currentPassword: 'wrong', email: newEmail } })).status, 401)
  const ok = await api('POST', '/api/auth/email', { token, body: { currentPassword: 'secret123', email: newEmail } })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.user.email, newEmail.toLowerCase())
  assert.ok(ok.json.token, 'a fresh token is handed back')
  assert.equal((await api('POST', '/api/auth/login', { body: { email: newEmail, password: 'secret123' } })).status, 200)
  assert.equal((await api('POST', '/api/auth/login', { body: { email: oldEmail, password: 'secret123' } })).status, 401)
})

test('account: email change collides with an existing address (409)', async () => {
  const a = await newUser()
  const b = await newUser()
  const r = await api('POST', '/api/auth/email', { token: a.token, body: { currentPassword: 'secret123', email: b.email } })
  assert.equal(r.status, 409)
  assert.equal(r.json.error.type, 'conflict')
})

test('account: change password needs the current one, then the old stops working', async () => {
  const { token } = await newUser()
  assert.equal((await api('POST', '/api/auth/password', { token, body: { currentPassword: 'wrong', newPassword: 'brandnew1' } })).status, 401)
  const ok = await api('POST', '/api/auth/password', { token, body: { currentPassword: 'secret123', newPassword: 'brandnew1' } })
  assert.equal(ok.status, 200)
  const e = ok.json.user.email
  assert.equal((await api('POST', '/api/auth/login', { body: { email: e, password: 'secret123' } })).status, 401)
  assert.equal((await api('POST', '/api/auth/login', { body: { email: e, password: 'brandnew1' } })).status, 200)
})

test('chat streams SSE and terminates with [DONE]', async () => {
  const { token } = await newUser()
  const r = await api('POST', '/api/chat/completions', { token, body: { message: 'Hello there', stream: true } })
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /text\/event-stream/)
  assert.ok(r.headers.get('x-conversation-id'), 'conversation id exposed via header')
  assert.ok(r.text.includes('[DONE]'), 'stream terminates')
  assert.ok(/"delta"/.test(r.text), 'emits delta chunks')
})

test('clear image request returns a Flux URL (deterministic, no LLM)', async () => {
  const { token } = await newUser()
  const r = await api('POST', '/api/chat/completions', { token, body: { message: 'generate an image of a red fox in snow', stream: true } })
  assert.ok(r.text.includes('image.pollinations.ai'), 'image URL present')
  assert.ok(r.text.includes('model=flux'), 'upgraded to flux for quality')
})

test('adult image prompt is refused and builds no URL', async () => {
  const { token } = await newUser()
  const r = await api('POST', '/api/chat/completions', { token, body: { message: 'make an image of a nude person', stream: true } })
  assert.match(r.text, /adult\/NSFW/i)
  assert.ok(!r.text.includes('image.pollinations.ai'), 'no image URL for NSFW')
})

test('remember… auto-saves a memory visible via GET /api/memory', async () => {
  const { token } = await newUser()
  const marker = 'TestRiversideFC'
  await api('POST', '/api/chat/completions', { token, body: { message: `remember that my favorite club is ${marker}`, stream: true } })
  const list = await api('GET', '/api/memory', { token })
  assert.equal(list.status, 200)
  assert.ok(list.json.data.some((m) => String(m.value).includes(marker)), 'auto-memory stored the fact')
})

test('credits are deducted after a chat', async () => {
  const { token, user } = await newUser()
  const start = user.creditsRemaining
  await api('POST', '/api/chat/completions', { token, body: { message: 'count my credits please', stream: true } })
  const me = await api('GET', '/api/auth/me', { token })
  assert.ok(me.json.user.creditsRemaining < start, 'balance went down')
})

test('image tool runs for real; NSFW is blocked', async () => {
  const { token } = await newUser()
  const ok = await api('POST', '/api/tools/image_generator/run', { token, body: { prompt: 'a serene mountain lake at dawn' } })
  assert.equal(ok.status, 201)
  assert.ok(ok.json.output.imageUrl.includes('model=flux'))

  const bad = await api('POST', '/api/tools/image_generator/run', { token, body: { prompt: 'a nude portrait' } })
  assert.equal(bad.status, 201)
  assert.equal(bad.json.output.blocked, true)
  assert.equal(bad.json.output.imageUrl, null)
})

test('code tool returns a real model answer, not the TODO stub', async () => {
  const { token } = await newUser()
  const r = await api('POST', '/api/tools/code_assistant/run', { token, body: { prompt: 'write a python function to reverse a string' } })
  assert.equal(r.status, 201)
  assert.equal(r.json.output.type, 'text')
  assert.ok(typeof r.json.output.answer === 'string' && r.json.output.answer.length > 0)
  assert.ok(!r.json.output.answer.includes('// TODO: implement'), 'no canned placeholder')
})

test('unknown tool id → 404', async () => {
  const { token } = await newUser()
  assert.equal((await api('POST', '/api/tools/nope/run', { token, body: { prompt: 'x' } })).status, 404)
})

test('cross-user access is denied (404) on conversations', async () => {
  const a = await newUser('Ann')
  const b = await newUser('Bob')
  const conv = await api('POST', '/api/conversations', { token: a.token, body: { title: 'Private' } })
  const cid = conv.json.id
  assert.equal((await api('GET', `/api/conversations/${cid}`, { token: b.token })).status, 404)
  assert.equal((await api('GET', `/api/conversations/${cid}`, { token: a.token })).status, 200)
})

test('conversations: delete-all clears only the caller threads', async () => {
  const a = await newUser('Ann')
  const b = await newUser('Bob')
  await api('POST', '/api/conversations', { token: a.token, body: { title: 'A1' } })
  await api('POST', '/api/conversations', { token: a.token, body: { title: 'A2' } })
  await api('POST', '/api/conversations', { token: b.token, body: { title: 'B1' } })
  const del = await api('DELETE', '/api/conversations', { token: a.token })
  assert.equal(del.status, 200)
  assert.equal(del.json.deleted, 2)
  assert.equal((await api('GET', '/api/conversations', { token: a.token })).json.data.length, 0)
  assert.equal((await api('GET', '/api/conversations', { token: b.token })).json.data.length, 1)
})

test('validation: bad body → structured 400 with no internals', async () => {
  const { token } = await newUser()
  const r = await api('POST', '/api/conversations', { token, body: { title: 'x'.repeat(500) } })
  assert.equal(r.status, 400)
  assert.equal(r.json.error.type, 'invalid_request_error')
  assert.ok(!r.text.includes('node_modules'), 'no stack/paths in error body')
})

test('unknown route → clean 404 not_found', async () => {
  const { token } = await newUser()
  const r = await api('GET', '/api/does-not-exist', { token })
  assert.equal(r.status, 404)
  assert.equal(r.json.error.type, 'not_found')
})

/* ── Desktop agent bridge ──────────────────────────────────────────────────
   These run with DESKTOP_AGENT_SECRET unset (the test env never sets it), so
   they prove two things without needing a live agent: the proxy is behind
   requireAuth, and it fails CLOSED (503) rather than reaching for the network. */

test('desktop bridge: every route requires auth (401 without a token)', async () => {
  assert.equal((await api('GET', '/api/desktop/permissions')).status, 401)
  assert.equal((await api('POST', '/api/desktop/plan', { body: { action: 'system.info' } })).status, 401)
  assert.equal((await api('POST', '/api/desktop/execute', { body: { planId: 'x' } })).status, 401)
})

test('desktop bridge: fails closed when the shared secret is not set', async () => {
  const { token } = await newUser()
  const h = await api('GET', '/api/desktop/health', { token })
  assert.equal(h.status, 503)
  assert.equal(h.json.enabled, false, 'health reports the bridge OFF instead of faking a live agent')
  const g = await api('POST', '/api/desktop/permissions/grant', { token, body: { scope: 'files' } })
  assert.equal(g.status, 503)
  assert.equal(g.json.error.type, 'desktop_bridge_disabled')
  assert.ok(!/node_modules|at .*\.js:/.test(g.text), 'no internals in the disabled error')
})

test('desktop bridge: validates the NL intent request before calling the model (400)', async () => {
  const { token } = await newUser()
  const r = await api('POST', '/api/desktop/intent', { token, body: { utterance: '' } })
  assert.equal(r.status, 400)
  assert.equal(r.json.error.type, 'invalid_request_error')
})

test('stream cancellation: a pre-aborted signal produces no deltas (mock mode)', async () => {
  const { streamChatCompletion } = await import('../src/services/ai.js')
  const c = new AbortController()
  c.abort()
  let count = 0
  for await (const _ch of streamChatCompletion({ history: [{ role: 'user', content: 'hi' }], signal: c.signal })) count++
  assert.equal(count, 0, 'an aborted stream must stop yielding immediately, not keep billing tokens')
})

/* ---- User-attached reference images (Ctrl+V / 📎 in the composer) ---- */

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function uploadOnePng(token) {
  const r = await api('POST', '/api/chat/images', { token, body: { dataUrl: PNG_1PX } })
  assert.equal(r.status, 201)
  assert.match(r.json.url, /^\/uploads\/img_[\w-]+\.png$/)
  return r.json.url
}

test('images: upload requires auth and rejects non-image data URLs', async () => {
  assert.equal((await api('POST', '/api/chat/images', { body: { dataUrl: PNG_1PX } })).status, 401)
  const { token } = await newUser()
  const bad = await api('POST', '/api/chat/images', { token, body: { dataUrl: 'data:text/plain;base64,SGVsbG8gd29ybGQh' } })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.type, 'invalid_request_error')
})

test('images: a stored upload is served back from /uploads with the right type', async () => {
  const { token } = await newUser()
  const url = await uploadOnePng(token)
  const res = await fetch(`${BASE}${url}`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  const { config } = await import('../src/config.js')
  try { fs.rmSync(path.join(config.uploadsDir, url.split('/').pop()), { force: true }) } catch { /* best effort */ }
})

test('images: an image turn persists on the message and survives in history', async () => {
  const { token } = await newUser()
  const url = await uploadOnePng(token)
  const chat = await api('POST', '/api/chat/completions', { token, body: { message: 'what is in this image?', images: [url], stream: false } })
  assert.equal(chat.status, 200)
  assert.ok(chat.json.choices[0].message.content.length > 0, 'mock mode must still answer an image turn')
  const convo = await api('GET', `/api/conversations/${chat.json.conversationId}`, { token })
  const userMsg = convo.json.messages.find((m) => m.role === 'user')
  assert.deepEqual(userMsg.images, [url], 'GET conversation returns camelCase images, never raw images_json')
})

test('images: image-only turns are legal, empty turns are not', async () => {
  const { token } = await newUser()
  const url = await uploadOnePng(token)
  const only = await api('POST', '/api/chat/completions', { token, body: { images: [url], stream: false } })
  assert.equal(only.status, 200, 'a bare paste with no caption still reaches the model')
  const empty = await api('POST', '/api/chat/completions', { token, body: { stream: false } })
  assert.equal(empty.status, 400)
  assert.match(empty.json.error.message, /message or attach/i)
})

test('cors: local origins are reflected in dev, foreign origins never', async () => {
  const { config } = await import('../src/config.js')
  const acao = async (origin) => {
    const res = await fetch(`${BASE}/health`, { headers: { Origin: origin } })
    return res.headers.get('access-control-allow-origin')
  }
  assert.equal(await acao('http://localhost:5173'), 'http://localhost:5173', 'listed origin')
  assert.equal(await acao('http://localhost:6789'), 'http://localhost:6789', 'Vite rolled to a spare port')
  assert.equal(await acao('http://127.0.0.1:5173'), 'http://127.0.0.1:5173', 'loopback by IP')
  assert.equal(await acao('http://192.168.100.107:5173'), 'http://192.168.100.107:5173', 'served over the LAN')
  assert.equal(await acao('http://evil.example.com'), null, 'foreign origin gets no header')
  assert.equal(await acao('http://11.0.0.9:5173'), null, 'look-alike outside RFC 1918 stays blocked')
  config.corsAllowLocalOrigins = false
  try {
    assert.equal(await acao('http://localhost:6789'), null, 'production keeps the strict list')
    assert.equal(await acao('http://localhost:5173'), 'http://localhost:5173', 'the list itself still works')
  } finally {
    config.corsAllowLocalOrigins = true
  }
})
