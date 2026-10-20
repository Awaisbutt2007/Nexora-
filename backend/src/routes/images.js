import { Router } from 'express'
import { config } from '../config.js'
import { buildImageUrl, fetchGeneratedImage, isNsfwPrompt } from '../services/images.js'

const router = Router()

/* Clamp a requested dimension into a sane band so nobody asks for a 8000² image
   and pins the server while Pollinations renders it. */
const clampInt = (raw, fallback) => {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(1280, Math.max(256, Math.round(n))) : fallback
}

/* GET /api/images/generate?prompt=… — the ONE image endpoint the chat and the
   Image Generator tool point at. It exists so a Pollinations token never reaches
   the browser, and so a rate-limited generation returns an HONEST error instead
   of Pollinations' "at its limit" card being rendered as a fake success.

   - No token (default): 302-redirect straight to Pollinations so the request
     leaves from the USER's own IP — a residential line clears the anonymous
     limit far more often than this server's datacenter IP does.
   - Token configured: generate server-side (with retry) and stream the bytes. */
router.get('/generate', async (req, res, next) => {
  try {
    const prompt = String(req.query.prompt || '').trim().slice(0, 900)
    if (!prompt) {
      return res.status(400).json({ error: { message: 'A prompt is required.', type: 'invalid_request_error' } })
    }
    if (isNsfwPrompt(prompt)) {
      return res.status(400).json({ error: { message: 'Adult/NSFW content is not allowed on Nexora.', type: 'invalid_request_error' } })
    }
    const width = clampInt(req.query.width, 768)
    const height = clampInt(req.query.height, 768)

    if (!config.pollinationsToken) {
      return res.redirect(302, buildImageUrl(prompt, { width, height }))
    }

    const { buffer, contentType } = await fetchGeneratedImage(prompt, { width, height })
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(buffer)
  } catch (err) {
    if (res.headersSent) return next(err)
    res.status(err.status || 502).json({
      error: { message: err.message || 'Image generation failed.', type: 'image_unavailable' },
    })
  }
})

export default router
