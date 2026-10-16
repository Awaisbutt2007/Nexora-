import fs from 'node:fs'
import path from 'node:path'

/* The file layer may ONLY touch paths that resolve inside one of the allowed
   roots (config.allowedDirs ∪ runtime grants). Containment is checked AFTER
   realpath, so `..`, and symlinks that point outside the sandbox are refused —
   the classic escapes. There is deliberately no delete and no overwrite. */

export class PathEscapeError extends Error {
  constructor(p) {
    super(`Path is outside the approved directories: ${p}`)
    this.name = 'PathEscapeError'
  }
}

function isWithin(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/* Resolve a requested path and prove it lives inside an allowed root.
   - If the target exists, realpath it (defeats symlink escapes) and re-check.
   - If it does not exist (a write target), realpath the nearest existing parent
     and re-attach the remaining segments, so a symlinked parent can't escape. */
export function resolveWithinAllowed(rawPath, allowedRoots) {
  if (!allowedRoots.length) throw new Error('No approved directories are configured — file access is denied by default.')
  const abs = path.resolve(rawPath)

  let real
  if (fs.existsSync(abs)) {
    real = fs.realpathSync(abs)
  } else {
    // walk up to the nearest existing ancestor
    let cur = abs
    const trailing = []
    while (!fs.existsSync(cur) && cur !== path.dirname(cur)) {
      trailing.unshift(path.basename(cur))
      cur = path.dirname(cur)
    }
    const realBase = fs.existsSync(cur) ? fs.realpathSync(cur) : cur
    real = path.resolve(realBase, ...trailing)
  }

  const realRoots = allowedRoots.map((r) => {
    try { return fs.realpathSync(r) } catch { return path.resolve(r) }
  })
  const ok = realRoots.some((r) => isWithin(r, real))
  if (!ok) throw new PathEscapeError(rawPath)
  return real
}

export function list({ dir, recursive, limit }, allowedRoots) {
  const root = resolveWithinAllowed(dir, allowedRoots)
  const out = []
  const stack = [{ dir: root, depth: 0 }]
  while (stack.length && out.length < limit) {
    const { dir: d, depth } = stack.pop()
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (out.length >= limit) break
      const full = path.join(d, e.name)
      out.push({ name: path.relative(root, full).split(path.sep).join('/'), type: e.isDirectory() ? 'dir' : 'file', size: e.isFile() ? safeSize(full) : null })
      if (recursive && e.isDirectory() && depth < 8) stack.push({ dir: full, depth: depth + 1 })
    }
  }
  return { root: path.basename(root), count: out.length, entries: out }
}

function safeSize(p) { try { return fs.statSync(p).size } catch { return null } }

export function read({ path: p, maxBytes }, allowedRoots) {
  const real = resolveWithinAllowed(p, allowedRoots)
  const st = fs.statSync(real)
  if (st.isDirectory()) throw new Error('Path is a directory, not a file.')
  const fd = fs.openSync(real, 'r')
  try {
    const len = Math.min(st.size, maxBytes)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, 0)
    return { path: path.basename(real), truncated: st.size > len, bytes: len, text: buf.toString('utf8') }
  } finally {
    fs.closeSync(fd)
  }
}

/* Create a NEW file. Overwriting an existing one is refused outright — the user
   asked for organization and reading, not silent data loss. */
export function writeNew({ path: p, content }, allowedRoots) {
  const real = resolveWithinAllowed(p, allowedRoots)
  if (fs.existsSync(real)) throw new Error('Refusing to overwrite an existing file. Choose a new name.')
  fs.mkdirSync(path.dirname(real), { recursive: true })
  fs.writeFileSync(real, content, 'utf8')
  return { path: path.basename(real), bytes: Buffer.byteLength(content), created: true }
}

/* Group files into per-extension subfolders. DRY-RUN by default: it computes the
   moves and returns them without touching disk; only `apply:true` (which forces
   an alwaysConfirm in the allowlist) performs the moves. Never clobbers. */
export function organize({ dir, strategy, apply }, allowedRoots) {
  const root = resolveWithinAllowed(dir, allowedRoots)
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile())
  const moves = []
  for (const e of entries) {
    const ext = path.extname(e.name).replace(/^\./, '').toLowerCase() || 'no-extension'
    const bucket = strategy === 'by-date' ? dateBucket(path.join(root, e.name)) : strategy === 'flatten' ? '.' : ext
    if (bucket === '.' && !e.name.includes('.')) continue
    const targetDir = bucket === '.' ? root : path.join(root, bucket)
    const target = path.join(targetDir, e.name)
    if (target === path.join(root, e.name)) continue
    moves.push({ from: e.name, to: path.join(bucket, e.name), collision: fs.existsSync(target) })
  }

  let applied = 0
  if (apply) {
    for (const m of moves) {
      if (m.collision) continue
      const from = path.join(root, m.from)
      const to = path.join(root, m.to)
      if (!isWithin(root, path.resolve(to))) throw new PathEscapeError(m.to)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.renameSync(from, to)
      applied++
    }
  }
  return { root: path.basename(root), strategy, dryRun: !apply, wouldMove: moves.length, applied, moves: moves.slice(0, 200) }
}

function dateBucket(fullPath) {
  try {
    const d = fs.statSync(fullPath).mtime
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  } catch {
    return 'unknown'
  }
}
