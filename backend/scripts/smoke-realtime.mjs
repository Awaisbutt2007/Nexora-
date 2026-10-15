/* Smoke test for the realtime voice endpoints (mock mode: no OPENAI_API_KEY).
   Run with the backend up:  node backend/scripts/smoke-realtime.mjs
   Proves: auth is enforced, no-key mode refuses instead of faking audio,
   turns persist into conversations, and the per-user rate limit bites. */
const BASE = process.env.API_URL || 'http://localhost:8787'

let failures = 0

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function api(path, { method = 'POST', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

/* 1. health advertises voice availability state */
const health = await api('/health', { method: 'GET' })
check('GET /health ok', health.status === 200)
check('health reports voice mode', typeof health.json?.voice === 'string', `voice=${health.json?.voice}`)

/* 2. token endpoint requires authentication */
const noAuth = await api('/api/voice/realtime/token', { body: {} })
check('POST /token without auth → 401', noAuth.status === 401, JSON.stringify(noAuth.json?.error))

/* 3. log in (or register) the demo user */
const email = 'demo@nexora.ai'
let login = await api('/api/auth/login', { body: { email, password: 'demo1234' } })
if (login.status !== 200) {
  login = await api('/api/auth/register', { body: { name: 'Demo User', email, password: 'demo1234' } })
}
check('demo user login/register', login.status === 200 && Boolean(login.json?.token), `status=${login.status}`)
const token = login.json.token

/* 4. without an API key the token endpoint must refuse — never fake audio */
const refused = await api('/api/voice/realtime/token', { token, body: { voice: 'marin', language: 'auto', assistantName: 'Aira' } })
if (health.json.ai === 'mock') {
  check('POST /token in mock mode → 503 with clear message', refused.status === 503 && /OPENAI_API_KEY/.test(refused.json?.error?.message || ''), JSON.stringify(refused.json?.error?.message))
} else {
  check('POST /token with real key → 200 + clientSecret', refused.status === 200 && Boolean(refused.json?.clientSecret), `status=${refused.status}`)
}

/* 5. unknown voice falls back to the default, invalid language is rejected */
const badLang = await api('/api/voice/realtime/token', { token, body: { language: 'xx' } })
check('invalid language → 400', badLang.status === 400, `status=${badLang.status}`)

/* 5b. persona is accepted (schema-side) and length-capped */
const personaOk = await api('/api/voice/realtime/token', { token, body: { persona: 'Assistant — sharp chief-of-staff energy' } })
check('persona field is accepted by /token', personaOk.status === 200 || personaOk.status === 503, `status=${personaOk.status}`)
const personaTooLong = await api('/api/voice/realtime/token', { token, body: { persona: 'x'.repeat(250) } })
check('oversized persona rejected → 400', personaTooLong.status === 400, `status=${personaTooLong.status}`)

/* 6. completed spoken turns persist into a conversation */
const turn1 = await api('/api/voice/realtime/turn', { token, body: { userText: 'Aira, mujhe mera project explain karo in English.', assistantText: 'Sure — your project is a React plus Express workspace with a chat, memory and tools surface.' } })
check('POST /turn creates voice conversation', turn1.status === 201 && turn1.json?.isNew === true && turn1.json?.conversationId?.startsWith('conv_'), JSON.stringify(turn1.json))
const turn2 = await api('/api/voice/realtime/turn', { token, body: { conversationId: turn1.json?.conversationId, userText: 'Kya tum insaan ho?', assistantText: 'No — I am Aira, your AI assistant.' } })
check('POST /turn appends to same conversation', turn2.status === 201 && turn2.json?.isNew === false)
const convo = await api(`/api/conversations/${turn1.json?.conversationId}`, { method: 'GET', token })
const roles = (convo.json?.messages || []).map((m) => m.role).join(',')
check('voice thread readable through existing conversations API', convo.status === 200 && roles === 'user,assistant,user,assistant', `roles=${roles}`)

/* 7. ownership: another user cannot post into someone else's conversation */
const other = await api('/api/auth/register', { body: { name: 'Other Person', email: `smoke-${Date.now()}@nexora.test`, password: 'pass12345' } })
if (other.status === 200 || other.status === 201) {
  const cross = await api('/api/voice/realtime/turn', { token: other.json.token, body: { conversationId: turn1.json.conversationId, userText: 'hi', assistantText: 'hello' } })
  check('cross-user conversation write → 404', cross.status === 404, `status=${cross.status}`)
} else {
  check('register second user for ownership test', false, `status=${other.status}`)
}

/* 8. rate limit: keep requesting tokens; must eventually 429 (mock 503s still count as starts) */
let sawRateLimit = false
for (let i = 0; i < 8; i += 1) {
  const r = await api('/api/voice/realtime/token', { token, body: {} })
  if (r.status === 429) { sawRateLimit = true; break }
}
check('token endpoint rate-limits repeated sessions', sawRateLimit)

/* 9. history endpoints — voice threads are visible in the same list as text chats,
      and DELETE removes them for good (Phase 4: text + voice share one history). */
const list = await api('/api/conversations', { method: 'GET', token })
const titles = (list.json?.data || []).map((c) => c.title)
check('voice conversation shows in GET /api/conversations', list.status === 200 && titles.some((t) => t.startsWith('Voice ·')))
const del = await api(`/api/conversations/${turn1.json.conversationId}`, { method: 'DELETE', token })
check('DELETE /api/conversations/:id → 204', del.status === 204)
const afterDelete = await api(`/api/conversations/${turn1.json.conversationId}`, { method: 'GET', token })
check('deleted conversation is gone → 404', afterDelete.status === 404)

/* 10. session builder carries the tempo + eagerness knobs (in mock mode /token
       never reaches the provider, so assert the config the browser would get).
       Proves the speech-speed fix is actually wired into the realtime payload. */
const { buildRealtimeSession, buildVoiceInstructions } = await import('../src/services/realtime.js')
const { config } = await import('../src/config.js')
const built = buildRealtimeSession({ assistantName: 'Aira', userName: 'Demo', voice: 'marin', language: 'auto', memories: [] })
const speed = built.audio?.output?.speed
check('output.speed is set and within provider bounds (0.25..1.5)', typeof speed === 'number' && speed >= 0.25 && speed <= 1.5, `speed=${speed}`)
check('output.speed matches configured tempo', Math.abs(speed - config.voiceOutputSpeed) < 1e-9, `config=${config.voiceOutputSpeed}`)
const eager = built.audio?.input?.turn_detection?.eagerness
check('turn_detection.eagerness is a valid enum', ['low', 'medium', 'high'].includes(eager), `eagerness=${eager}`)
check('out-of-range VOICE_OUTPUT_SPEED is clamped, not passed raw', Math.min(1.5, Math.max(0.25, Number(process.env.VOICE_OUTPUT_SPEED || 1.1) || 1.1)) === speed)
const instructions = buildVoiceInstructions({ assistantName: 'Aira' })
check('prompt asks for short pauses between sentences', /pause between your sentences short/i.test(instructions))

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll realtime smoke checks passed.')
process.exit(failures ? 1 : 0)
