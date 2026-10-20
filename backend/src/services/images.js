/**
 * Image generation. The workspace has no paid image key (the chat runs on a free
 * Groq tier and the OpenAI key is quota-exhausted), so we use Pollinations — a
 * real, keyless image model — instead of the old mock placeholder. The endpoint
 * derives a picture straight from the URL, so we only ever build a URL here.
 *
 * Provider is kept in one place so a funded DALL·E / Flux key can replace it
 * later without touching routes or the UI.
 */

import { config } from '../config.js'

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt/'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* Requests that clearly want a picture. We require BOTH an action verb and an
   image noun so ordinary chat ("I have a picture in mind") is not hijacked.
   Covers English, Roman Urdu and Urdu script. */
const ACTION = /(bana|bna|banao|banado|ban\s?de|ban\s?do|kar\s?do|generate|create|make|draw|design|render|paint|sketch|imagine|dikha|dekhao|chahye|chaheye|chahiye|want|need)/i
const SUBJECT = /(image|img|picture|\bpics?\b|photo|photograph|tasveer|tasvir|poster|logo|wallpaper|illustration|artwork|drawing|عکس|تصویر|تصاویر)/i

/* Adult-content guard. Nexora is a all-ages product, so any image prompt that
   reads as sexual/nudity is refused before it ever reaches the model. The
   provider's own `safe=true` filter is a paid feature (returns 402), so the
   blocklist is the real gate. Matches English, Roman Urdu and Urdu script. */
const NSFW = /(nude|naked|nudity|nsfw|porn|porno|pornstar|sex|sexual|sexy|erotic|xxx|adult\s?video|hentai|boob|boobs|tit|tits|penis|vagina|breast|nipple|ass|butt|buttocks|anal|blowjob|handjob|orgasm|cum|slut|whore|strip(tease)?|topless|bra\b|lingerie|underwear|underpants|see[\s-]?through|wet[\s-]?t[\s-]?shirt|bikini|swimsuit|cleavage|genital|negligee|onlyfans|boudoir|make\s?love|bedroom\s?scene|kamuk|kaamo?kas|kamsutra|chudai|chudai?|chod|bhosra|bhosda|randi|haraami|lund|laura|gand|moot|nangi|nanga|nange|kapde?\s?(utaar|nikal|ke)?|without\s?clothes|half[\s-]?naked|bikini|chuchi|chuche|jism|jismani|shahwat|shervani|عورت\s?ki\s?nangi|ننگی|نangat|فحش|جنسی|عریا)/i

/** True when a prompt looks like adult/NSFW content that must be blocked. */
export function isNsfwPrompt(text) {
  return !!text && NSFW.test(String(text))
}

/* "Show me YOUR face / YOUR settings" is a demand to see the app's own live UI, not
   a picture to draw. Those are answered by the client capturing a real screenshot of
   itself (see src/selfCapture.js), so the generator must never hijack them — it used
   to reply with a made-up Pollinations portrait when the user asked to see her real
   face, which is exactly the dishonesty the user complained about. Both halves must
   match: a possessive pointing at HER, plus one of her own surfaces. */
const SELF_OWNER = /\b(apna|apni|apne|apsa|tumhara|tumhari|tumhare|tumhare|tera|teri|terey|teree|aapka|aapki|aapke|your|yours|self|khud|khud|apni\s?hi)\b/i
const SELF_UI = /\b(chehra|chehry|chehray|shakal|soorat|surat|face|avatar|profile\s?pic|dp|setting|settings|screen|screenshot|ui|interface|page|memory|memories|yaadein|yaaden|roop|look|appearance)\b/i

/** True when the user is asking the assistant to reveal its OWN face or UI. */
export function isSelfUiRequest(text) {
  if (!text || typeof text !== 'string') return false
  const t = text.trim()
  return !!t && SELF_OWNER.test(t) && SELF_UI.test(t)
}

/** Returns the prompt to draw, or null when the message is not an image request. */
export function detectImageRequest(text) {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null
  return ACTION.test(t) && SUBJECT.test(t) ? t : null
}

/**
 * Build the real, loadable Pollinations URL from a text prompt. Uses the Flux
 * model at 768² (1024² came out slow on the free tier) with `nologo`. When a
 * `POLLINATIONS_TOKEN` is configured it is appended here — so this function must
 * ONLY ever be called server-side (the proxy), never handed to the browser.
 */
export function buildImageUrl(prompt, { width = 768, height = 768 } = {}) {
  const clean = String(prompt || '').trim().slice(0, 900) || 'a beautiful scene'
  const params = new URLSearchParams({ width: String(width), height: String(height), nologo: 'true', model: 'flux' })
  if (config.pollinationsToken) params.set('token', config.pollinationsToken)
  return `${POLLINATIONS_BASE}${encodeURIComponent(clean)}?${params.toString()}`
}

/**
 * The client-facing path for a generated image. Both the chat and the Image
 * Generator tool embed THIS (never buildImageUrl) so the token stays on the
 * server and a rate-limited generation surfaces as an honest error rather than
 * Pollinations' "at its limit" card being rendered as a fake success.
 */
export function imageProxyPath(prompt, { width = 768, height = 768 } = {}) {
  const clean = String(prompt || '').trim().slice(0, 900) || 'a beautiful scene'
  return `/api/images/generate?prompt=${encodeURIComponent(clean)}&width=${width}&height=${height}`
}

/**
 * Generate server-side with retry. The free anonymous tier sheds most traffic
 * with 402/429/503; a configured token answers reliably. Resolves to
 * `{ buffer, contentType }` on a real image, or throws an Error carrying
 * `.status` so the route can report an honest failure (never a placeholder).
 */
export async function fetchGeneratedImage(prompt, { width = 768, height = 768, attempts = 4 } = {}) {
  const url = buildImageUrl(prompt, { width, height })
  let lastStatus = 502
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url)
      const ctype = res.headers.get('content-type') || ''
      if (res.ok && ctype.startsWith('image/')) {
        return { buffer: Buffer.from(await res.arrayBuffer()), contentType: ctype }
      }
      lastStatus = res.status || 502
      if (i < attempts) {
        const ra = Number(res.headers.get('retry-after'))
        await sleep(Math.min(12000, ra > 0 ? ra * 1000 : 2000 * i))
      }
    } catch {
      lastStatus = 502
      if (i < attempts) await sleep(2000 * i)
    }
  }
  const err = new Error('The image service is busy right now — please try again in a moment.')
  err.status = lastStatus === 402 ? 503 : (lastStatus || 502)
  err.retryable = true
  throw err
}
