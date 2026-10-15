/* Security smoke test — proves the hardening is real, not just present.
   Run with the backend up:  node backend/scripts/smoke-security.mjs
   Covers: security headers, auth brute-force rate limit, cross-user access
   control, error responses that don't leak internals, and auth enforcement.
   Uses throwaway emails so it never exhausts the demo account's login bucket. */
import { config } from '../src/config.js'

const BASE = process.env.API_URL || 'http://localhost:8787'
let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function raw(path, { method, token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { res, status: res.status, json, headers: res.headers }
}

/* 1. baseline security headers on every response */
const health = await raw('/health')
check('X-Content-Type-Options: nosniff is set', health.headers.get('x-content-type-options') === 'nosniff')
check('X-Frame-Options is set (API is never framed)', Boolean(health.headers.get('x-frame-options')))
check('Referrer-Policy is set', Boolean(health.headers.get('referrer-policy')))
check('GET /health never echoes the API key value', !/sk-[A-Za-z0-9]/.test(JSON.stringify(health.json)))

/* 2. auth endpoints require no token but enforce rate limiting. Fire more than
      the per-account limit with a throwaway email — the guard must return 429. */
const sprayEmail = `spray-${Date.now()}@nexora.test`
let saw429 = false
let lastStatus = 0
for (let i = 0; i < config.authRateLimit + 4; i += 1) {
  const r = await raw('/api/auth/login', { body: { email: sprayEmail, password: 'wrongpass' } })
  lastStatus = r.status
  if (r.status === 429) { saw429 = true; break }
}
check('login brute-force is rate-limited (429 after threshold)', saw429, `limit=${config.authRateLimit}, last=${lastStatus}`)

/* 3. protected routes reject missing / bogus tokens */
const noTok = await raw('/api/conversations')
check('GET /api/conversations without token → 401', noTok.status === 401)
const badTok = await raw('/api/memory', { token: 'not-a-jwt' })
check('GET /api/memory with forged token → 401', badTok.status === 401)

/* 4. cross-user access control: user B cannot read user A's conversation */
const aEmail = `secA-${Date.now()}@nexora.test`
const bEmail = `secB-${Date.now()}@nexora.test`
const regA = await raw('/api/auth/register', { body: { name: 'Sec A', email: aEmail, password: 'pass12345' } })
const regB = await raw('/api/auth/register', { body: { name: 'Sec B', email: bEmail, password: 'pass12345' } })
const tokA = regA.json?.token
const tokB = regB.json?.token
check('two security users registered', Boolean(tokA && tokB), `A=${regA.status} B=${regB.status}`)
const convoA = await raw('/api/conversations', { token: tokA, method: 'POST', body: { title: 'Private A' } })
const convoId = convoA.json?.id
const crossGet = await raw(`/api/conversations/${convoId}`, { token: tokB })
check('user B reading user A conversation → 404', crossGet.status === 404, `status=${crossGet.status}`)
const crossDel = await raw(`/api/conversations/${convoId}`, { token: tokB, method: 'DELETE' })
check('user B deleting user A conversation → 404', crossDel.status === 404, `status=${crossDel.status}`)
const ownGet = await raw(`/api/conversations/${convoId}`, { token: tokA })
check('owner A can still read their conversation → 200', ownGet.status === 200)

/* 5. error responses are structured and leak no stack/internals */
const invalid = await raw('/api/conversations', { token: tokA, method: 'POST', body: { title: 'x'.repeat(500) } })
const bodyStr = JSON.stringify(invalid.json)
check('oversized title → 400 invalid_request_error', invalid.status === 400 && invalid.json?.error?.type === 'invalid_request_error')
check('error body carries no stack trace', !/at\s.*\(:?\d+/.test(bodyStr) && !bodyStr.includes('node_modules'))

/* 6. unknown route is a clean 404, not a thrown page */
const missing = await raw('/api/does-not-exist', { token: tokA })
check('unknown route → 404 not_found', missing.status === 404 && missing.json?.error?.type === 'not_found')

/* 7. realtime token endpoint is authenticated and mints nothing without auth */
const rtNoAuth = await raw('/api/voice/realtime/token', { method: 'POST', body: {} })
check('POST /api/voice/realtime/token without auth → 401', rtNoAuth.status === 401)

console.log(failures ? `\n${failures} security check(s) FAILED` : '\nAll security smoke checks passed.')
process.exit(failures ? 1 : 0)
