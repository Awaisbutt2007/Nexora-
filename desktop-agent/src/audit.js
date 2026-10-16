import fs from 'node:fs'
import path from 'node:path'

/* The audit trail is one JSON object per line. It deliberately records the
   SHAPE of what happened (who/what/outcome) but NEVER the private content: no
   form values, no file bodies, no tokens, no secrets, no cookie/password data.
   Anything matching a secret-ish key, or that the caller explicitly redacts, is
   replaced with "[redacted]" before it is written. */

const SECRET_KEY_RE = /(pass(word)?|secret|token|cookie|authorization|api[-_]?key|credential|value|content|body)/i
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+/gi
const LONG_OPACITY_RE = /\b[0-9a-f]{24,}\b/gi

/* Deep-clone + strip. `dropKeys` are argument names the caller already knows are
   private (from allowlist.secretArgKeys); they are replaced regardless of shape. */
export function redact(input, dropKeys = []) {
  const drop = new Set(dropKeys.map((k) => k.toLowerCase()))
  const seen = new WeakSet()

  function walk(node) {
    if (typeof node === 'string') {
      return node.replace(BEARER_RE, 'Bearer [redacted]').replace(LONG_OPACITY_RE, '[redacted]')
    }
    if (node === null || typeof node !== 'object') return node
    if (seen.has(node)) return '[circular]'
    seen.add(node)
    if (Array.isArray(node)) return node.map(walk)
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (drop.has(k.toLowerCase()) || SECRET_KEY_RE.test(k)) {
        out[k] = typeof v === 'string' || typeof v === 'number' ? '[redacted]' : '[redacted]'
      } else {
        out[k] = walk(v)
      }
    }
    return out
  }
  return walk(input)
}

let FILE = null
let BUFFER = []

export function initAudit(dir) {
  fs.mkdirSync(dir, { recursive: true })
  FILE = path.join(dir, `audit-${new Date().toISOString().slice(0, 10)}.jsonl`)
}

export function audit(event) {
  const entry = {
    ts: new Date().toISOString(),
    ...redact(event, event.__dropKeys || []),
  }
  delete entry.__dropKeys
  BUFFER.push(entry)
  if (FILE) {
    try {
      fs.appendFileSync(FILE, JSON.stringify(entry) + '\n')
    } catch {
      /* never let a logging failure break the safety path — keep it in memory */
    }
  }
  return entry
}

/* Most recent entries (in memory), newest first, for GET /audit. */
export function recentAudit(limit = 50) {
  return BUFFER.slice(-limit).reverse()
}

export function auditFilePath() {
  return FILE
}
