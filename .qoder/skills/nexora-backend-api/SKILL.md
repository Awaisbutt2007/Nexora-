---
name: nexora-backend-api
description: How to add or change an endpoint in the Nexora Express 5 + node:sqlite backend (backend/) — the route/middleware/services/db layering, zod validation and error-response contract, JWT auth helpers, credits debiting, ChatGPT-style SSE streaming, id prefixes and camelCase mapping, mock mode, and the CORS rule. Use when touching anything under backend/src, when a frontend fetch returns a network error, or when asked to add an API route.
---

# Nexora Backend API

Express 5 + `node:sqlite`, ESM only, no TypeScript, no ORM. Start with
`npm run dev:api` from the repo root (`node --watch src/index.js`, port **8787**), or
`npm run dev:all` to run the API and Vite together so one is never left down.

## Layout — put new code in the layer that owns it

| Layer | Rule |
| --- | --- |
| `src/index.js` | CORS, `express.json({ limit: '2mb' })`, `/health`, hosts `../dist` when a build exists, `app.use('/api/<area>', router)`, then `notFound` + `errorHandler` LAST |
| `src/routes/*.js` | One `Router()` per area. Owns the zod schema, the SQL and the response shape. `router.use(requireAuth)` at the top of every authenticated area |
| `src/middleware/auth.js` | `signToken`, `requireAuth`, `optionalAuth`, `sanitizeUser` — never re-implement token parsing in a route |
| `src/services/` | `ai.js` (model calls, mock stream, reply-language script guard), `credits.js` (`ensureCredits`, `deductCredits`, `upgradePlan`) |
| `src/db/index.js` | `getDb()` singleton + the full `CREATE TABLE` migration + `ALTER TABLE` column adds; `nowIso()` for every timestamp |
| `src/config.js` | every env read happens here; routes import `config`, never `process.env`. Also owns `REPLY_LANGUAGES` / `REPLY_LANGUAGE_SCRIPTS` / `REPLY_LANGUAGE_NAMES` — the single list every language-aware schema and prompt must import |

Relative ESM imports need the `.js` extension.

## Contract every route follows

- **Errors** are always `{ error: { message, type } }` with an explicit status; thrown
  errors reach `errorHandler`, which maps `ZodError` → 400 `invalid_request_error` (with
  `details`) and `err.status || 500`. Inside a handler: `try { … } catch (err) { next(err) }`.
- **Never forward upstream provider text to the client.** A provider error message names the
  model, the vendor, the org id and a billing URL (`Rate limit reached for model
  \`qwen/…\` in organization \`org_…\` … https://console.groq.com/settings/billing`) and
  arrives with a 4xx, which `errorHandler` used to echo verbatim. Any message that comes out
  of `ai.js` / the OpenAI SDK goes through `safeProviderMessage(err, fallback)` in
  `services/providerErrors.js` first — it logs the truth and sends a vendor-free line, and it
  leaves our own crafted messages alone. Same rule inside an SSE error frame.
- **The client never learns which engine answers.** Any `model` value that leaves this
  server (SSE chunk, non-streaming body, tool-run payload) passes through
  `publicModelLabel(id)` in `config.js`, which maps anything that is not already a
  `nexora*` label to `nexora`; the real id is stored server-side in `conversations.model`.
  Request schemas therefore have **no `model` key** — a caller must not get to pick (and
  pay for) the engine — and `GET /health` reports readiness only (`HEALTH_VERBOSE=1` is
  the operator's own escape hatch, never set in public). `/api/voice/realtime/token`
  returns no `provider`/`model` either; the browser only needs the ephemeral secret.
- **Validation**: a module-scope `z.object({...})` per write endpoint,
  `const body = schema.parse(req.body)`.
- **Responses are camelCase** — alias in SQL: `SELECT created_at AS createdAt`. Never
  hand a snake_case row to the client; `sanitizeUser(row)` is the only user serializer.
- **IDs are prefixed nanoids**: `usr_` `conv_` `msg_` `mem_` `run_` `chatcmpl_`
  (`nanoid(16)`, `chatcmpl_` uses 20).
- **Ownership check on every `:id`**: `WHERE id = ? AND user_id = ?` → 404 `not_found`
  when the row is missing. Never filter by id alone.
- **Deletes answer `204` with no body**; creates answer `201`.

## Credits

`ensureCredits(user, cost)` BEFORE the work (throws 402 `insufficient_credits`),
`deductCredits(userId, cost)` AFTER it. Premium/`pro`/`yearly_pro` are unlimited and
`deductCredits` returns early. Chat charges `estimateCredits(usage)` ≈ `ceil(total_tokens/100)`,
minimum 1; tools charge the fixed `creditCost` from `TOOL_CATALOG` in `routes/tools.js`.

## SSE streaming (`POST /api/chat/completions`)

Headers first: `text/event-stream`, `no-cache, no-transform`, `keep-alive`, and
**`X-Conversation-Id`** (already in the CORS `exposedHeaders` list — add any new custom
header there too). Frames are `data: ${JSON.stringify(payload)}\n\n` in
OpenAI-chunk shape (`choices[].delta.content`), then a `finish_reason: 'stop'` chunk,
an optional `usage` chunk, then `data: [DONE]`.

Two rules that are easy to break:
1. Once headers are sent you can never call `next(err)` — emit
   `data: { error: {…} }` and `res.end()`.
2. Persist the assistant message and deduct credits **after** the stream loop, from the
   accumulated text, so a failed stream does not charge for nothing.

The client counterpart is `streamChat()` in `src/api/nexora.js`, which splits the buffer
on `\n`, keeps the remainder, and ignores non-`data:` lines.

## Reply language & companion prefs

`users.prefs_json` holds the five choices Settings owns (`voice`, `language`,
`assistantName`, `persona`, `gender`). `sanitizeUser` parses it defensively into
`prefs`, so register/login/`GET /api/user/me` all hand it back; `PATCH /api/user/profile`
with `{ prefs }` **merges key by key** onto the stored object (never replaces it, so a
partial client can't erase the rest). Validate with `z.enum(REPLY_LANGUAGES)`, not a
hand-written string list — chat, proactive and voice schemas must agree on valid choices.

A prompt line alone does not keep a weak model in the right *script*: told "Urdu script is
MANDATORY" it still answers a Roman-typed first message in Roman letters. `ai.js` therefore
enforces it in code — `guardedStream` buffers the first `SAMPLE_CHARS` characters,
classifies them with `scriptViolation(text, language)` (script ranges, not words) and,
on a mismatch, closes the doomed call and re-issues it once with a corrective `system`
directive appended last by `buildMessages(history, memories, ctx, extraDirective)`.
Consequences to remember: `streamChatCompletion`/`completeChat` now take `language` and
`signal`, the retry is capped at `MAX_SCRIPT_ATTEMPTS` (an imperfect answer beats silence),
the guard is **skipped in mock mode** (`!config.openaiApiKey`) because the canned reply is
always English, and it stays inert for `routes/tools.js` / `services/desktopNl.js` since
they never pass `language` — good, their output is structured JSON.

## Model / tool "mock mode"

No `OPENAI_API_KEY` → `createClient()` returns `null` and both `streamChatCompletion` and
`completeChat` fall through to `mockStream()` (model reported as `nexora-mock`). Tool runs
return canned `mockToolOutput()` objects. Keep that behaviour: the whole UI must stay
demonstrable without a key. `GET /health` reports which mode is live.

## Google sign-in

`/api/auth/google` verifies the ID token through Google's `tokeninfo` endpoint (no extra
dependency), rejects an `aud` mismatch when `GOOGLE_CLIENT_ID` is set, and upserts by
lower-cased email — new accounts get `bcrypt.hash(nanoid(24))` as an unusable password and
`picture` as the avatar.

## Gotchas

- **Nothing in the browser should be cross-origin — CORS is only a fallback.** The frontend
  uses relative URLs (`/api/...`, `/uploads/...`) unless `VITE_API_URL` is set, and each
  surface makes those resolve: Vite proxies them in dev/preview (`vite.config.js`), and this
  server HOSTS the built app itself when `../dist/index.html` exists (`config.clientDir`,
  `config.hostClient`; `HOSTED_CLIENT=0` disables it) so `http://localhost:8787` is a working
  single-process site. Why it matters: an origin CORS refuses makes every `fetch` die as an
  opaque `TypeError: Failed to fetch` that looks exactly like a broken login. If a request
  still has to come from elsewhere, `CORS_ORIGIN` (comma list, default
  `http://localhost:5173`) plus, in dev, `config.corsAllowLocalOrigins` (reflects loopback
  **and** RFC 1918 origins — `10.x`, `192.168.x`, `172.16-31.x` — on any port) handle it, and
  the frontend renders the failure readably via `apiErrorText()` in `src/api/nexora.js`.
  Note the `cors@2` callback contract: `origin: (originString, cb)` — NOT `(req, cb)`, and a
  falsy second arg means `next()` with no CORS headers (the correct deny).
- **A second copy on the same port exits loudly.** `app.listen` handles `EADDRINUSE` with a
  printed explanation instead of an uncaught stack in an unwatched terminal — leftover
  backends from earlier sessions silently owning `:8787` is how a user ends up running code
  they believe they changed. `npm run dev:all` checks the port first and reuses whatever is
  answering it.
- `data/nexora.db` (+ `-wal`/`-shm`) and `uploads/` are runtime state.
  `npm --prefix backend run db:reset` **deletes** them; only run it when asked.
- There is no seeded user. The frontend's "Continue as Demo" does
  `login(demo@nexora.ai/demo1234)` and on failure `register()`s that account — a fresh DB
  needs one demo click before the user exists.
- `POST /api/auth/register` answers **409** for a taken email. The client treats that as
  "you already have an account" and silently falls back to `login()` (`register()` in
  `src/api/nexora.js`), so a signed-up user landing on a pre-existing email still gets in
  instead of seeing an error.
- `sanitizeUser(row)` now returns `prefs` — a hand-built user object in a test or route will
  silently look like the account has no language saved.
- The proactive nudge in `routes/chat.js` takes the pinned language AND the composer state
  (`proactiveDirective(language, body)`, where `body` carries `composing` / `withdrewDraft`
  flags — facts only, the draft's text is never sent). Never reintroduce a bare "Match their
  language": it contradicts the MANDATORY rule above it and the model happily obeys the
  newer line.
- The creator identity and the "don't explain how you were built" rule live in ONE place:
  `creatorRules()` in `config.js`, pushed into `systemPromptFor()` and into the spoken
  instructions in `services/realtime.js` (`creatorRules({ spoken: true })`). The name comes
  from `config.developerName` (`AI_DEVELOPER_NAME`, default `Awais`). Any new prompt surface
  must include it, or that surface will name the API vendor as its maker.
- Surfaces that get the rule for free: every prose reply goes through `completeChat` /
  `streamChatCompletion`, and `buildMessages()` in `services/ai.js` is the only place a
  `role: 'system'` prompt is assembled there — so chat, `/proactive`, the scheduler reminders
  (`routes/schedule.js`) and the text tools (`routes/tools.js`) all inherit `systemPromptFor()`.
  A surface that hand-writes its own system prompt does NOT inherit it: `realtime.js` (covered
  above) and the desktop planner `plannerSystem()` in `services/desktopNl.js`, whose `clarify`
  sentence is shown to the user, so it carries its own refusal line.
- Schema changes go in `migrate()` in `db/index.js` as `CREATE TABLE IF NOT EXISTS` plus a
  guarded `ALTER TABLE` (`PRAGMA table_info` check), so old databases upgrade in place.

## Related skills

`nexora-project-map`, `nexora-session-and-onboarding`, `browser-layout-verification`.
