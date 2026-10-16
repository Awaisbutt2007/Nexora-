import { randomUUID } from 'node:crypto'

/* Every running action gets a controller so it can be timed out individually or
   killed at once by the emergency STOP. Handlers receive an AbortSignal and are
   expected to (a) await cancellable operations and (b) poll `signal.aborted`
   inside any loop, so a stop actually halts work instead of just returning. */

const running = new Map() // planId → { controller, action, startedAt, timer }

export function stopAll() {
  const stopped = []
  for (const [id, entry] of running) {
    stopped.push({ id, action: entry.action })
    entry.controller.abort(new Error('Stopped by emergency STOP'))
  }
  return { stopped, count: stopped.length }
}

export function runningCount() {
  return running.size
}

/* Run `handler(signal)` under a hard timeout. On timeout or stop the promise
   rejects with a tagged error so the orchestrator records a clean cancellation
   rather than an unhandled crash. */
export async function runWithTimeout({ handler, timeoutMs, action, onCancel }) {
  const id = randomUUID()
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  running.set(id, { controller, action, startedAt: Date.now(), timer })

  let outcome
  try {
    outcome = await Promise.resolve(handler(controller.signal))
    clearTimeout(timer)
    running.delete(id)
    return { status: 'completed', result: outcome }
  } catch (err) {
    clearTimeout(timer)
    running.delete(id)
    const aborted = controller.signal.aborted
    const reason = aborted?.message || err?.message || String(err)
    if (onCancel) {
      try { await onCancel() } catch { /* cleanup is best-effort */ }
    }
    return { status: aborted ? 'cancelled' : 'failed', error: aborted ? 'cancelled' : 'error', reason }
  }
}
