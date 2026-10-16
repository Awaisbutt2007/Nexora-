/**
 * Image generation. The workspace has no paid image key (the chat runs on a free
 * Groq tier and the OpenAI key is quota-exhausted), so we use Pollinations — a
 * real, keyless image model — instead of the old mock placeholder. The endpoint
 * derives a picture straight from the URL, so we only ever build a URL here.
 *
 * Provider is kept in one place so a funded DALL·E / Flux key can replace it
 * later without touching routes or the UI.
 */

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt/'

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

/** Returns the prompt to draw, or null when the message is not an image request. */
export function detectImageRequest(text) {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null
  return ACTION.test(t) && SUBJECT.test(t) ? t : null
}

/**
 * Build a real, loadable image URL from a text prompt. Uses the high-quality
 * Flux model with prompt enhancement at 1024² — the earlier 896² default came
 * out soft/dull, which the user flagged. `nologo` drops the watermark where the
 * free tier honours it.
 */
export function buildImageUrl(prompt, { width = 1024, height = 1024 } = {}) {
  const clean = String(prompt || '').trim().slice(0, 900) || 'a beautiful scene'
  return `${POLLINATIONS_BASE}${encodeURIComponent(clean)}?width=${width}&height=${height}&nologo=true&enhance=true&model=flux`
}
