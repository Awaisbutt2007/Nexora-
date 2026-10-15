/* Throwaway smoke test for /api/voice/* — run with the backend up on :8787 */
const BASE = 'http://localhost:8787'

const email = `voice_test_${Date.now()}@nexora.ai`
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Voice Tester', email, password: 'test1234' }),
}).then((r) => r.json())
const token = reg.token
if (!token) throw new Error('register failed: ' + JSON.stringify(reg))
const auth = { Authorization: `Bearer ${token}` }

/* Synthetic WAVs: same "voice" twice (pitch 110Hz), one different (440Hz + noise) */
function makeWav(freq, noise, seconds = 1.5, rate = 16000) {
  const n = Math.floor(rate * seconds)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i += 1) {
    const t = i / rate
    let s = Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(2 * Math.PI * freq * 2.7 * t)
    if (noise) s += (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.3
    data.writeInt16LE(Math.max(-32767, Math.min(32767, s * 9000)) | 0, i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function postForm(url, wav, label) {
  const form = new FormData()
  form.append('sample', new Blob([wav], { type: 'audio/wav' }), 'sample.wav')
  if (label) form.append('label', label)
  return fetch(url, { method: 'POST', headers: auth, body: form }).then(async (r) => ({ status: r.status, body: await r.json() }))
}

const voiceA = makeWav(110, false)
const voiceA2 = makeWav(110, false, 1.2)
const voiceB = makeWav(440, true)

console.log('enroll A :', await postForm(`${BASE}/api/voice/enroll`, voiceA, 'take 1'))
console.log('enroll A2:', await postForm(`${BASE}/api/voice/enroll`, voiceA2, 'take 2'))
console.log('verify A :', await postForm(`${BASE}/api/voice/verify`, voiceA2))
console.log('verify B :', await postForm(`${BASE}/api/voice/verify`, voiceB))
console.log('prints   :', await fetch(`${BASE}/api/voice/prints`, { headers: auth }).then((r) => r.json()))
console.log('no-auth  :', await fetch(`${BASE}/api/voice/verify`, { method: 'POST' }).then((r) => r.status))
