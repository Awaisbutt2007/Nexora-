import os from 'node:os'
import { execFile } from 'node:child_process'

/* System surface is intentionally tiny. There is NO unlock, NO credential
   handling, NO UAC bypass. `info` is read-only. `restart`/`shutdown` are the only
   power actions; the allowlist flags both alwaysConfirm, so they can never run
   without an explicit human approval, and the orchestrator additionally refuses
   them from free-text voice (see actions.js → fromVoice gate). */

const IS_WIN = process.platform === 'win32'

export function info() {
  return {
    platform: process.platform,
    release: os.release(),
    uptimeSeconds: Math.round(os.uptime()),
    hostname: os.hostname(),
    /* Whether the interactive desktop is usable. A locked console blocks UI
       automation (browser window, mouse/keyboard). We do not attempt to detect or
       — obviously — bypass the lock; we surface it so Aira can tell the user. */
    interactiveHint: IS_WIN
      ? 'If the PC is locked, launch/automation actions need an unlocked, active console session.'
      : 'non-Windows dev host',
  }
}

/* `shutdown`/`restart` accept a short grace delay so an accidental approval can
   be cancelled with the STOP (which runs `shutdown /a`). No command string ever
   reaches a shell — execFile with fixed argv only. */
function power(kind, delaySeconds) {
  return new Promise((resolve, reject) => {
    const delay = Math.max(5, Math.min(300, delaySeconds || 15))
    if (IS_WIN) {
      const flag = kind === 'restart' ? '/r' : '/s'
      execFile('shutdown', [flag, '/t', String(delay), '/c', `Nexora Aira ${kind} requested and confirmed`], (err) => {
        if (err) return reject(err)
        resolve({ scheduled: true, kind, inSeconds: delay, canCancelWith: 'STOP (runs shutdown /a) or "shutdown /a" in a terminal' })
      })
    } else {
      // Non-Windows is a dev/test box only; still fixed argv, no shell.
      const cmd = kind === 'restart' ? 'reboot' : 'poweroff'
      execFile('shutdown', ['-h', `+${Math.ceil(delay / 60)}`, cmd], (err) => {
        if (err) return reject(err)
        resolve({ scheduled: true, kind, inSeconds: delay })
      })
    }
  })
}

export function restart(_args, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('cancelled'))
  return power('restart', 15)
}

export function shutdown(_args, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('cancelled'))
  return power('shutdown', 15)
}

/* Called by the emergency STOP so a just-approved power action can be recalled. */
export function abortPower() {
  if (!IS_WIN) return Promise.resolve({ attempted: false })
  return new Promise((resolve) => {
    execFile('shutdown', ['/a'], (err) => resolve({ attempted: true, cancelled: !err, note: err ? 'nothing was scheduled' : 'scheduled power action cancelled' }))
  })
}
