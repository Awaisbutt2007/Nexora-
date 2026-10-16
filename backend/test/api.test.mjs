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
process.env.FREE_MONTHLY_CREDITS = '5000'

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
