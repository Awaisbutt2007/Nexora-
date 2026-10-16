import fs from 'node:fs'
import path from 'node:path'
import { SCOPES } from './allowlist.js'

/* Default-deny permission model.
   - A SCOPE (browser/files/apps/system) is either granted or not. Nothing is
     granted out of the box; the user explicitly enables a scope, optionally
     bounded to specific targets (e.g. one allowed directory).
   - Even when a scope is granted, an action flagged `alwaysConfirm` (destructive
     or irreversible) STILL requires a per-action human approval. The two checks
     are independent: granted-scope can never silence an alwaysConfirm.
   - The model has no vote here. It cannot call grant(), and it can only ever
     request execution of an action that already exists in the allowlist. */

const GRANTS_VERSION = 1

export class PermissionManager {
  constructor(dataDir) {
    this.file = dataDir ? path.join(dataDir, 'permissions.json') : null
    this.state = this.#load()
  }

  #default() {
    return {
      version: GRANTS_VERSION,
      /* scope → boolean */
      scopes: Object.fromEntries(SCOPES.map((s) => [s, false])),
      /* extra directories the file layer may touch, granted at runtime */
      allowedDirs: [],
      /* app ids explicitly approved at runtime (union with config.approvedAppIds) */
      approvedAppIds: [],
      /* browser host allowlist; empty means "any http(s) host permitted by env" */
      allowedHosts: [],
    }
  }

  #load() {
    if (!this.file) return this.#default()
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      const base = this.#default()
      return {
        ...base,
        ...raw,
        scopes: { ...base.scopes, ...(raw.scopes || {}) },
        allowedDirs: Array.isArray(raw.allowedDirs) ? raw.allowedDirs : [],
        approvedAppIds: Array.isArray(raw.approvedAppIds) ? raw.approvedAppIds : [],
        allowedHosts: Array.isArray(raw.allowedHosts) ? raw.allowedHosts : [],
      }
    } catch {
      return this.#default()
    }
  }

  #persist() {
    if (!this.file) return
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2))
    } catch {
      /* in-memory only if the disk is unavailable (e.g. tests) */
    }
  }

  isScopeGranted(scope) {
    return Boolean(this.state.scopes[scope])
  }

  /* The gate every execute() passes through. Returns { allowed, reason }. */
  check({ scope, alwaysConfirm, approvedThisAction }) {
    if (!this.isScopeGranted(scope)) {
      return { allowed: false, reason: `Scope "${scope}" is not granted (default-deny). Grant it first.` }
    }
    if (alwaysConfirm && !approvedThisAction) {
      return { allowed: false, reason: 'This action is high-risk and needs explicit confirmation, even though the scope is granted.', needsConfirm: true }
    }
    return { allowed: true }
  }

  grantScope(scope, granted = true) {
    if (!SCOPES.includes(scope)) throw new Error(`Unknown scope "${scope}"`)
    this.state.scopes[scope] = granted
    this.#persist()
    return this.snapshot()
  }

  /* A one-shot, narrowly-scoped approval that does NOT flip the scope on: used
     for alwaysConfirm actions so the user approves THAT action, not the category. */
  addAllowedDir(dir) {
    const abs = path.resolve(dir)
    if (!this.state.allowedDirs.includes(abs)) this.state.allowedDirs.push(abs)
    this.#persist()
    return this.snapshot()
  }

  removeAllowedDir(dir) {
    const abs = path.resolve(dir)
    this.state.allowedDirs = this.state.allowedDirs.filter((d) => d !== abs)
    this.#persist()
    return this.snapshot()
  }

  addApprovedApp(appId) {
    if (!this.state.approvedAppIds.includes(appId)) this.state.approvedAppIds.push(appId)
    this.#persist()
    return this.snapshot()
  }

  addAllowedHost(host) {
    const h = host.toLowerCase()
    if (!this.state.allowedHosts.includes(h)) this.state.allowedHosts.push(h)
    this.#persist()
    return this.snapshot()
  }

  revoke(scope) {
    if (scope && SCOPES.includes(scope)) {
      this.state.scopes[scope] = false
      this.#persist()
      return this.snapshot()
    }
    /* no scope → reset everything (revoke-all) */
    this.state = this.#default()
    this.#persist()
    return this.snapshot()
  }

  snapshot() {
    return {
      scopes: { ...this.state.scopes },
      allowedDirs: [...this.state.allowedDirs],
      approvedAppIds: [...this.state.approvedAppIds],
      allowedHosts: [...this.state.allowedHosts],
    }
  }
}
