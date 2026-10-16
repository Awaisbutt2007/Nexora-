import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveWithinAllowed } from './fsops.js'

/* App control is an ALLOWLIST of named targets mapped to known executables —
   there is no field anywhere that accepts a command string, so the model can
   never run "powershell -c …". Programs are started with execFile (NO shell) and
   only from the resolved paths below. Any `targetPath` an app opens must be
   inside an approved directory. The agent only ever closes apps IT launched. */

const IS_WIN = process.platform === 'win32'

function firstExisting(candidates) {
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c } catch { /* ignore */ }
  }
  return null
}

/* Each approved app resolves to a concrete executable path (searching the usual
   Windows install locations) or a PATH command on non-Windows dev boxes. An
   unresolvable id is refused at launch — we never fall back to arbitrary lookup. */
const APP_MAP = {
  chrome: {
    label: 'Google Chrome',
    win: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    ],
    other: 'google-chrome',
  },
  edge: {
    label: 'Microsoft Edge',
    win: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    other: 'microsoft-edge',
  },
  vscode: {
    label: 'Visual Studio Code',
    win: [
      (process.env.LOCALAPPDATA || '') + '\\Programs\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    ],
    other: 'code',
  },
  notepad: {
    label: 'Notepad',
    win: ['C:\\Windows\\System32\\notepad.exe'],
    other: 'gedit',
  },
  explorer: {
    label: 'File Explorer',
    win: ['C:\\Windows\\explorer.exe'],
    other: 'xdg-open',
    opensPath: true,
  },
}

export function listApprovedApps() {
  return Object.entries(APP_MAP).map(([id, meta]) => ({ id, label: meta.label, resolved: resolveExe(id) !== null }))
}

export function resolveExe(appId) {
  const meta = APP_MAP[appId]
  if (!meta) return null
  if (IS_WIN) return firstExisting(meta.win)
  return meta.other // rely on PATH for non-Windows (dev/test only)
}

/* appId is checked against the approved set by the orchestrator; here we also
   re-check the executable resolves, so an approved-but-not-installed app fails
   with a clear message instead of a cryptic ENOENT. */
export function launch({ appId, targetPath }, { approvedAppIds, allowedDirs }) {
  return new Promise((resolve, reject) => {
    if (!approvedAppIds.includes(appId)) return reject(new Error(`App "${appId}" is not in the approved set.`))
    const meta = APP_MAP[appId]
    if (!meta) return reject(new Error(`No executable mapping for approved app "${appId}".`))
    const exe = resolveExe(appId)
    if (!exe) return reject(new Error(`${meta.label} is approved but not installed / not found on this machine.`))

    const args = []
    if (targetPath) {
      // Opening a path is itself a filesystem access — containment must hold.
      const real = resolveWithinAllowed(targetPath, allowedDirs)
      args.push(real)
    }
    execFile(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }, (err) => {
      if (err) return reject(err)
      // We can't capture the pid of a detached start cleanly across all launchers,
      // so we record the exe; close() only reaps processes we tracked.
      resolve({ appId, label: meta.label, exe: path.basename(exe), launched: true })
    })
  })
}

/* Only apps started through this exact launcher in this session are closeable,
   and only when we actually captured a handle. This prevents "close any process
   named chrome" behaviour that would nuke the user's real browser. */
const tracked = new Map() // appId → child
export function trackChild(appId, child) {
  tracked.set(appId, child)
}

export function close({ appId }) {
  const child = tracked.get(appId)
  if (!child) {
    return { appId, closed: false, note: 'This agent did not launch that app in this session, so it will not force-kill it. Close it manually if needed.' }
  }
  try {
    child.kill()
    tracked.delete(appId)
    return { appId, closed: true }
  } catch (err) {
    return { appId, closed: false, note: err.message }
  }
}
