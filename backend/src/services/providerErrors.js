/* Upstream provider errors are written for the developer who runs the server, not
   for the person chatting. Groq/OpenAI-style 429s arrive looking like:

   "Rate limit reached for model `qwen/qwen3.8-27b` in organization
    `org_01m5…` on tokens per day (TPD): Limit 200000, Used 199301 …
    Upgrade to Dev Tier at https://console.groq.com/settings/billing"

   Handing that to the client would name the model, the vendor, the org id and the
   billing dashboard — the exact plumbing the product must not advertise, and it
   shows up on every quota hiccup. So: keep the truth in the server log, send the
   user a vendor-free line. Our own crafted messages never match the pattern and
   pass through untouched, so real guidance ("attach an image first") still works. */

const PROVIDER_PLUMBING_RE = /(groq|openai|chatgpt|anthropic|claude|gemini|azure|deepseek|mistral|llama|perplexity|together\.ai|qwen|gpt-[0-9a-z.]*|\btpd\b|\brpm\b|service tier|tokens per (day|hour|min|minute)|rate limit reached|too many requests|insufficient_quota|organization\s|org_[0-9a-z]{6,}|api[_\- ]?key|sk-[a-z0-9_-]{8,}|request\s?id\b|req_[0-9a-z]{6,}|billing|console\.[a-z]+\.[a-z]{2,}|https?:\/\/|node_modules|[A-Za-z]:\\|\/usr\/|\/home\/|\b(error|status) code:?\s*4\d\d\b|\bcompletions\b)/i

const RATE_LIMIT_FLAVOURED_RE = /(rate.?limit|too many requests|tokens per (day|hour|min|minute)|insufficient_quota|quota|overload|capacity|try again in)/i

/* The scrubbed shape depends on the kind of failure: a limit is temporary and the
   user can act on it, everything else (a bad key, an outage) is ours to fix, so it
   must not be dressed up as theirs. */

const GENERIC = 'Something went wrong on our side — please try that once more.'
const BUSY = 'The AI is at its limit right now — please try again in a minute or two.'

/** A client-safe sentence for an upstream failure: our own wording passes through,
    provider text is replaced and logged in full. */
export function safeProviderMessage(err, fallback = GENERIC) {
  /* Only a real sentence can be judged — a thrown object with no message must not
     reach the client as "[object Object]". */
  const text = typeof err?.message === 'string'
    ? err.message.trim()
    : typeof err === 'string' ? err.trim() : ''
  if (!text) return fallback
  if (!PROVIDER_PLUMBING_RE.test(text)) return text
  console.error('[nexora] scrubbed upstream error sent to client:', text)
  return RATE_LIMIT_FLAVOURED_RE.test(text) ? BUSY : fallback
}
