export function notFound(_req, res) {
  res.status(404).json({ error: { message: 'Not found', type: 'not_found' } })
}

export function errorHandler(err, _req, res, _next) {
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
  res.status(status).json({
    error: {
      message: err.message || 'Internal server error',
      type: err.type || 'server_error',
    },
  })
}
