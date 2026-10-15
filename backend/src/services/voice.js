import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

/* Voice embeddings.
   Primary path: a SpeechBrain-style speaker service (set SPEECHBRAIN_URL) returns a
   real x-vector. Fallback (mock mode, like ai.js): a deterministic 64-dim DSP feature
   vector — loudness, zero-crossings, pitch, formant-band energies and spectral texture
   — extracted from the decoded PCM so the enroll → verify pipeline is fully
   demonstrable without any external model. */

const DIM = 64

export async function extractEmbedding(samplePath) {
  if (config.speechbrainUrl) {
    try {
      return await remoteEmbedding(samplePath)
    } catch (err) {
      console.warn('[voice] speaker service failed, falling back to DSP embedding:', err.message)
    }
  }
  return localEmbedding(samplePath)
}

export function serializeEmbedding(vector) {
  return new Uint8Array(new Float32Array(vector).buffer)
}

export function deserializeEmbedding(blob) {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

export function cosineSimilarity(a, b) {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function remoteEmbedding(samplePath) {
  const form = new FormData()
  form.append('audio', new Blob([fs.readFileSync(samplePath)]), path.basename(samplePath))
  const res = await fetch(`${config.speechbrainUrl.replace(/\/$/, '')}/embed`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`speaker service responded ${res.status}`)
  const json = await res.json()
  if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
    throw new Error('speaker service returned no embedding')
  }
  return Float32Array.from(json.embedding)
}

function localEmbedding(samplePath) {
  const samples = readPcmMono(samplePath)
  if (samples.length < 256) {
    const err = new Error('Audio sample is too short to build a voice print')
    err.status = 422
    err.type = 'invalid_audio'
    throw err
  }

  const n = samples.length
  const rate = estimateSampleRate(samplePath)

  /* Group 1 (24 dims): spectral shape — log energies at 24 log-spaced frequencies.
     Each frequency via two cascaded Goertzel bins (one division per sample). */
  const spectral = new Float64Array(24)
  const step = Math.max(1, Math.floor(n / 8000)) /* decimate for speed */
  const count = Math.floor(n / step)
  for (let k = 0; k < 24; k += 1) {
    const hz = 80 * Math.pow(2, k / 3) /* 80Hz → ~12.8kHz */
    const w = (2 * Math.PI * hz) / rate
    const c = 2 * Math.cos(w)
    let s1 = 0
    let s2 = 0
    let q1 = 0
    let q2 = 0
    for (let i = 0; i < n; i += step) {
      const s0 = samples[i] + c * s1 - s2
      s2 = s1
      s1 = s0
      const q0 = s0 + c * q1 - q2
      q2 = q1
      q1 = q0
    }
    const re = s1 - c * s2
    const im = q1 - c * q2
    spectral[k] = Math.log1p((re * re + im * im) / (count * count) * 1e6)
  }

  /* Group 2 (8 dims): frame statistics — loudness, buzziness, pitch, spectral
     centroid / spread / flatness, and how fast the spectrum moves. */
  const stats = new Float64Array(8)
  let rms = 0
  let zcr = 0
  for (let i = 0; i < n; i += 1) {
    const s = samples[i]
    rms += s * s
    if (i > 0 && samples[i - 1] * s < 0) zcr += 1
  }
  stats[0] = Math.log1p(Math.sqrt(rms / n) * 1e3)
  stats[1] = zcr / n
  stats[2] = autocorrPitch(samples)
  const freqs = Array.from({ length: 24 }, (_, k) => 80 * Math.pow(2, k / 3))
  const total = spectral.reduce((a, b) => a + Math.exp(b), 0) || 1
  let mean = 0
  for (let k = 0; k < 24; k += 1) mean += freqs[k] * Math.exp(spectral[k])
  mean /= total
  let spread = 0
  let logSum = 0
  for (let k = 0; k < 24; k += 1) {
    const e = Math.exp(spectral[k])
    spread += (freqs[k] - mean) ** 2 * e
    logSum += Math.log(e + 1e-9)
  }
  stats[3] = mean / rate
  stats[4] = Math.sqrt(spread / total) / rate
  stats[5] = Math.exp(logSum / 24) / (total / 24 + 1e-9)
  stats[6] = Math.abs(freqs[11] - mean) / rate /* skew proxy */
  stats[7] = spectral[23] - spectral[0]   /* spectral tilt */

  /* Group 3 (16 dims): temporal envelope — RMS of 16 equal slices (rhythm) */
  const envelope = new Float64Array(16)
  const sliceLen = Math.floor(n / 16)
  for (let si = 0; si < 16; si += 1) {
    let e = 0
    const start = si * sliceLen
    for (let i = start; i < start + sliceLen; i += 1) e += samples[i] * samples[i]
    envelope[si] = Math.log1p(Math.sqrt(e / Math.max(1, sliceLen)) * 1e3)
  }

  /* Group 4 (16 dims): texture — coarse byte-nibble distribution of the file */
  const texture = new Float64Array(16)
  const buf = fs.readFileSync(samplePath)
  const span = Math.max(1, Math.floor(buf.length / 1024))
  for (let i = 0; i < buf.length; i += span) texture[buf[i] >> 4] += 1

  /* Unit-norm each group so no bucket count can drown the spectral shape */
  const features = new Float64Array(DIM) /* 24 + 8 + 16 + 16 = 64 */
  features.set(normalizeGroup(spectral), 0)
  features.set(normalizeGroup(stats), 24)
  features.set(normalizeGroup(envelope), 32)
  features.set(normalizeGroup(texture), 48)

  return l2Normalize(features)
}

function normalizeGroup(vec) {
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm)
  return norm > 0 ? Float64Array.from(vec, (v) => v / norm) : vec
}

function l2Normalize(vec) {
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  return Float32Array.from(vec, (v) => v / norm)
}

function autocorrPitch(samples) {
  const n = Math.min(samples.length, 8192)
  /* Search lags 2..128 on a decimated window → coarse but stable */
  const step = Math.max(1, Math.floor(n / 2048))
  const x = []
  for (let i = 0; i < n; i += step) x.push(samples[i])
  let bestLag = 0
  let best = -Infinity
  for (let lag = 2; lag < Math.min(128, x.length >> 1); lag += 1) {
    let sum = 0
    for (let i = 0; i + lag < x.length; i += 1) sum += x[i] * x[i + lag]
    if (sum > best) {
      best = sum
      bestLag = lag
    }
  }
  return bestLag / 128
}

function readPcmMono(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    return parseWavMono(buf)
  }
  /* Browser MediaRecorder blobs (webm/opus) have no dependency-free decoder here;
     treat bytes as a coarse unsigned PCM signal — deterministic and comparable. */
  const n = buf.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) out[i] = buf[i] - 128
  return out
}

function parseWavMono(buf) {
  let offset = 12
  let channels = 1
  let bits = 16
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') channels = buf.readUInt16LE(offset + 10) || 1
    if (id === 'data') {
      const start = offset + 8
      const end = Math.min(start + size, buf.length)
      const count = Math.floor((end - start) / (bits / 8))
      const out = new Float64Array(count)
      for (let i = 0; i < count; i += 1) {
        let s = 0
        for (let ch = 0; ch < channels; ch += 1) {
          s += buf.readInt16LE(start + (i * channels + ch) * 2) / 32768
        }
        out[i] = s / channels
      }
      return out
    }
    offset += 8 + size + (size % 2)
  }
  const n = buf.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) out[i] = buf[i] - 128
  return out
}

function estimateSampleRate(filePath) {
  /* Only meaningful for WAV; the byte-fallback path uses the nominal 16k anyway. */
  try {
    const buf = fs.readFileSync(filePath)
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return buf.readUInt32LE(24) || 16000
  } catch {
    /* fall through */
  }
  return 16000
}
