/* Nexora security regression tests — locks in hardening that must NOT regress.
   Run with the rest of the suite: `npm test` (from backend/).

   Covers defects the functional suite does NOT assert:
     - baseline security headers are actually set on responses
     - cross-user IDOR isolation on conversations + the proactive endpoint
     - the production fail-fast guards (default / weak JWT_SECRET refused)
   Isolated env mirrors api.test.mjs: throwaway temp DB, mock AI, high auth limits. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = path.resolve(__dirname, '..')

const TEST_DB = path.join(os.tmpdir(), `nexora-sec-${process.pid}-${Date.now()}.db`)
process.env.NODE_ENV = 'test'
process.env.DB_PATH = TEST_DB
process.env.OPENAI_API_KEY = ''
process.env.JWT_SECRET = 'nexora-test-secret'
process.env.CORS_ORIGIN = 'http://localhost:5173'
process.env.AUTH_RATE_LIMIT = '1000'
process.env.AUTH_IP_RATE_LIMIT = '1000'
process.env.AI_RATE_LIMIT_PER_MIN = '5'
process.env.FREE_MONTHLY_CREDITS = '5000'

let server
let BASE
let dbHandle

before(async () => {
  const { app } = await import('../src/index.js')
  const { getDb } = await import('../src/db/index.js')
  dbHandle = getDb()
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  BASE = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { dbHandle?.close() } catch { /* already closed */ }
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    try { fs.rmSync(f, { force: true }) } catch { /* ignore locked temp file */ }
  }
})

async function api(method, p, { token, body } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* empty */ }
  return { status: res.status, headers: res.headers, json, text }
}

let seq = 0
async function newUser() {
  const e = `sec${Date.now()}-${(seq += 1)}@nexora.test`
  const r = await api('POST', '/api/auth/register', { body: { name: 'Sec User', email: e, password: 'secret123' } })
  return { token: r.json.token, email: e }
}

test('security: baseline hardening headers are present', async () => {
  const r = await api('GET', '/health')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
})

test('security: one user cannot read another user\'s conversation (IDOR)', async () => {
  const a = await newUser()
  const b = await newUser()
  const created = await api('POST', '/api/conversations', { token: a.token, body: { title: 'private thread' } })
  assert.equal(created.status, 201)
  const convId = created.json.id

  // Victim's id, attacker's token → 404 (existence is not confirmed either way).
  assert.equal((await api('GET', `/api/conversations/${convId}`, { token: b.token })).status, 404)
  assert.equal((await api('PATCH', `/api/conversations/${convId}`, { token: b.token, body: { title: 'hijacked' } })).status, 404)
  assert.equal((await api('DELETE', `/api/conversations/${convId}`, { token: b.token })).status, 404)

  // Owner still sees it (proves the 404 above was isolation, not a broken route).
  assert.equal((await api('GET', `/api/conversations/${convId}`, { token: a.token })).status, 200)
})

test('security: proactive endpoint refuses a conversation the caller does not own', async () => {
  const a = await newUser()
  const b = await newUser()
  const created = await api('POST', '/api/conversations', { token: a.token, body: { title: 'proactive target' } })
  const convId = created.json.id
  const r = await api('POST', '/api/chat/proactive', { token: b.token, body: { conversationId: convId } })
  assert.equal(r.status, 404)
  assert.equal(r.json?.error?.type, 'not_found')
})

test('privacy: one user cannot read OR write into another user\'s conversation via completions', async () => {
  const a = await newUser()
  const b = await newUser()
  const bConv = await api('POST', '/api/conversations', { token: b.token, body: { title: 'b private' } })
  const bId = bConv.json.id
  await api('POST', '/api/chat/completions', { token: b.token, body: { conversationId: bId, message: 'b secret', stream: false } })
  const before = await api('GET', `/api/conversations/${bId}`, { token: b.token })
  const beforeCount = before.json.messages.length

  // Attacker tries to inject a turn into the victim's thread → refused, nothing written.
  const inj = await api('POST', '/api/chat/completions', { token: a.token, body: { conversationId: bId, message: 'leak attempt', stream: false } })
  assert.equal(inj.status, 404, 'non-owner cannot post into a foreign conversation')

  const after = await api('GET', `/api/conversations/${bId}`, { token: b.token })
  assert.equal(after.json.messages.length, beforeCount, 'victim thread is untouched by the foreign write')
  assert.ok(!JSON.stringify(after.json.messages).includes('leak attempt'), 'injected text never lands in the victim thread')

  // Attacker cannot even read the victim's thread.
  assert.equal((await api('GET', `/api/conversations/${bId}`, { token: a.token })).status, 404)
})

test('privacy: the conversation list only ever returns the caller\'s own threads', async () => {
  const a = await newUser()
  const b = await newUser()
  await api('POST', '/api/conversations', { token: a.token, body: { title: 'alpha-only-thread' } })
  const bList = await api('GET', '/api/conversations', { token: b.token })
  assert.equal(bList.status, 200)
  assert.ok(!JSON.stringify(bList.json).includes('alpha-only-thread'), "other user's conversations are not listed")
})

test('privacy: tool-run history is isolated per user', async () => {
  const a = await newUser()
  const b = await newUser()
  await api('POST', '/api/tools/meeting_notes/run', { token: a.token, body: { prompt: 'confidential board meeting' } })
  const bRuns = await api('GET', '/api/tools/runs', { token: b.token })
  assert.equal(bRuns.status, 200)
  assert.ok(!JSON.stringify(bRuns.json).includes('confidential board meeting'), "other user's tool inputs are not listed")
})

test('security: memory of one user is invisible to another', async () => {
  const a = await newUser()
  const b = await newUser()
  const saved = await api('POST', '/api/memory', { token: a.token, body: { key: 'fav', value: 'biryani' } })
  assert.equal(saved.status, 201)
  const list = await api('GET', '/api/memory', { token: b.token })
  assert.equal(list.status, 200)
  assert.ok(!JSON.stringify(list.json).includes('biryani'), "other user's memory value is not leaked")
})

test('security: expensive AI endpoint is rate-limited per user (429 on burst)', async () => {
  // AI_RATE_LIMIT_PER_MIN is 5 for this suite; a 6th request must be throttled.
  const u = await newUser()
  let lastStatus = 0
  let saw429 = false
  for (let i = 0; i < 6; i += 1) {
    const r = await api('POST', '/api/chat/completions', { token: u.token, body: { message: `ping ${i}`, stream: false } })
    lastStatus = r.status
    if (r.status === 429) { saw429 = true; assert.equal(r.json?.error?.type, 'rate_limited'); assert.ok(r.headers.get('retry-after')) }
  }
  assert.ok(saw429, 'a rapid burst past the per-user AI limit must be throttled, not billed')
  assert.equal(lastStatus, 429)
})

/* The production guards run at module load, so exercise them in a fresh child
   process with NODE_ENV=production instead of the ambient test env. */
function loadConfigProd(env) {
  const script = `import('./src/config.js').then(()=>console.log('NO_THROW')).catch((e)=>{console.log('THREW');process.stderr.write(String(e&&e.message||e))})`
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', CORS_ORIGIN: 'https://app.nexora.example', ...env },
  })
}

test('security: production refuses the shipped default JWT_SECRET', () => {
  const r = loadConfigProd({ JWT_SECRET: 'nexora-dev-secret-change-me' })
  assert.match(r.stdout, /THREW/)
  assert.match(r.stderr, /JWT_SECRET/)
})

test('security: production refuses a missing JWT_SECRET', () => {
  const r = loadConfigProd({ JWT_SECRET: '' })
  assert.match(r.stdout, /THREW/)
})

test('security: production refuses a weak (short) JWT_SECRET', () => {
  const r = loadConfigProd({ JWT_SECRET: 'password123' })
  assert.match(r.stdout, /THREW/)
  assert.match(r.stderr, /too weak|at least 32/i)
})

test('security: production refuses a localhost CORS_ORIGIN', () => {
  const r = loadConfigProd({ JWT_SECRET: 'a'.repeat(48), CORS_ORIGIN: 'http://localhost:5173' })
  assert.match(r.stdout, /THREW/)
  assert.match(r.stderr, /CORS_ORIGIN|localhost/)
})

test('security: production boots with a strong secret + real origin', () => {
  const r = loadConfigProd({ JWT_SECRET: 'a'.repeat(48), CORS_ORIGIN: 'https://app.nexora.example' })
  assert.match(r.stdout, /NO_THROW/)
})
