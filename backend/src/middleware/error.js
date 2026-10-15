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
  res.status(status).json({
    error: {
      message: exposeMessage ? err.message || 'Request failed' : 'Internal server error',
      type: err.type || 'server_error',
    },
  })
}
