#!/usr/bin/env node
/*
 * Nexora aggregate security gate (local + CI). Fails closed, never prints secrets.
 *
 *   1. Tracked-file guard — proves Git is NOT tracking any secret/personal path.
 *      This is the check `.gitignore` alone cannot give: a file committed before a
 *      rule was added stays tracked and silently ships to GitHub.
 *   2. Working-tree secret scan — delegates to secret-scan.mjs (redacted output).
 *   3. (with --history) full Git-history secret scan for every revision.
 *
 * Usage:  node scripts/security-check.mjs [--history]
 * Exit 0 = clean, 1 = at least one problem (usable as a pre-commit / CI gate).
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const WITH_HISTORY = process.argv.includes('--history')

// Path patterns that must NEVER appear in `git ls-files` (case-insensitive).
const FORBIDDEN_TRACKED = [
  { re: /(^|\/)\.env(\.|$)/i, why: 'live env / secret file' },
  { re: /(^|\/)[^/]*\.env$/i, why: 'live env / secret file' },
  { re: /\.(db|db-shm|db-wal|db-journal|sqlite3?)$/i, why: 'local database (personal data)' },
  { re: /(^|\/)uploads\//i, why: 'user uploads / voice recordings' },
  { re: /(^|\/)(recordings|voiceprints)\//i, why: 'biometric voice data' },
  { re: /\.wav$/i, why: 'audio recording' },
  { re: /\.(pem|key|p12|pfx|kdbx)$/i, why: 'private key / certificate' },
  { re: /(^|\/)(permissions\.json)$/i, why: 'runtime permission grants' },
  { re: /(^|\/)audit\//i, why: 'desktop-agent audit log' },
]

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

let failed = false

// ── 1. tracked-file guard ──────────────────────────────────────────────────
const ls = git(['ls-files'])
if (ls.status !== 0) {
  console.error('git ls-files failed — is this a git repository?')
  process.exit(1)
}
const tracked = ls.stdout.split(/\r?\n/).filter(Boolean)
const violations = []
for (const file of tracked) {
  const f = file.replace(/\\/g, '/')
  if (/\.env\.example$/i.test(f)) continue // sanitized templates are allowed
  for (const rule of FORBIDDEN_TRACKED) {
    if (rule.re.test(f)) { violations.push({ f, why: rule.why }); break }
  }
}
if (violations.length) {
  failed = true
  console.error(`❌ tracked-file guard: ${violations.length} sensitive file(s) are TRACKED in git:`)
  for (const v of violations) console.error(`   - ${v.f}  (${v.why})`)
  console.error('   Fix: git rm --cached <file>  (keeps your local copy), then commit the removal.\n')
} else {
  console.log(`✅ tracked-file guard: ${tracked.length} tracked files, no secrets/databases/uploads/keys committed\n`)
}

// ── 2 & 3. secret scans ────────────────────────────────────────────────────
function runScan(history) {
  const args = [path.join(HERE, 'secret-scan.mjs'), ...(history ? ['--history'] : [])]
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  if (r.status !== 0) {
    failed = true
    console.error((history ? '❌ history' : '❌ working-tree') + ' secret scan found issues (see above)\n')
  }
}
runScan(false)
if (WITH_HISTORY) runScan(true)

console.log(failed ? '\n🛑 SECURITY CHECK FAILED' : '\n🟢 SECURITY CHECK PASSED')
process.exit(failed ? 1 : 0)
