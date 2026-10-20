import { safeProviderMessage } from '../services/providerErrors.js'

export function notFound(_req, res) {
  res.status(404).json({ error: { message: 'Not found', type: 'not_found' } })
}

export function errorHandler(err, _req, res, _next) {
  /* Full detail stays in the server log; the client never gets an internal
     5xx message in production (it can leak paths, deps or provider text). */
  console.error('[nexora]', err)

  if (err?.name === 'ZodError') {
    return res.status(400).json({
      error: {
        message: 'Invalid request',
        type: 'invalid_request_error',
        details: err.issues,
      },
    })
  }

  const status = err.status || err.statusCode || 500
  const exposeMessage = status < 500 || process.env.NODE_ENV !== 'production'
  /* An explicitly-authored `clientMessage` is vendor-free by construction (still guarded
     against leaks) and is meant for the user even on a 5xx — e.g. "voice isn't configured
     on this server" beats the useless "Internal server error". Everything else keeps the
     hide-internal-5xx-in-production rule. */
  const message = err.clientMessage != null
    ? safeProviderMessage(err.clientMessage, 'Something went wrong on our side — please try that once more.')
    : exposeMessage
      ? safeProviderMessage(err, 'Request failed')
      : 'Internal server error'
  res.status(status).json({
    error: {
      /* Even a 4xx can be the provider's own text, which names the model, the
         vendor and the billing URL — scrub it, keep the status honest. */
      message,
      type: err.type || 'server_error',
    },
  })
}
