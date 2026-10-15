---
name: nexora-backend-api
description: How to add or change an endpoint in the Nexora Express 5 + node:sqlite backend (backend/) — the route/middleware/services/db layering, zod validation and error-response contract, JWT auth helpers, credits debiting, ChatGPT-style SSE streaming, id prefixes and camelCase mapping, mock mode, and the CORS rule. Use when touching anything under backend/src, when a frontend fetch returns a network error, or when asked to add an API route.
---

# Nexora Backend API

Express 5 + `node:sqlite`, ESM only, no TypeScript, no ORM. Start with
`npm run dev:api` from the repo root (`node --watch src/index.js`, port **8787**).

## Layout — put new code in the layer that owns it

| Layer | Rule |
| --- | --- |
| `src/index.js` | CORS, `express.json({ limit: '2mb' })`, `/health`, `app.use('/api/<area>', router)`, then `notFound` + `errorHandler` LAST |
| `src/routes/*.js` | One `Router()` per area. Owns the zod schema, the SQL and the response shape. `router.use(requireAuth)` at the top of every authenticated area |
| `src/middleware/auth.js` | `signToken`, `requireAuth`, `optionalAuth`, `sanitizeUser` — never re-implement token parsing in a route |
| `src/services/` | `ai.js` (model calls + mock stream), `credits.js` (`ensureCredits`, `deductCredits`, `upgradePlan`) |
| `src/db/index.js` | `getDb()` singleton + the full `CREATE TABLE` migration + `ALTER TABLE` column adds; `nowIso()` for every timestamp |
| `src/config.js` | every env read happens here; routes import `config`, never `process.env` |

Relative ESM imports need the `.js` extension.

## Contract every route follows

- **Errors** are always `{ error: { message, type } }` with an explicit status; thrown
  errors reach `errorHandler`, which maps `ZodError` → 400 `invalid_request_error` (with
  `details`) and `err.status || 500`. Inside a handler: `try { … } catch (err) { next(err) }`.
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

- **CORS is an exact origin list.** `CORS_ORIGIN` (default `http://localhost:5173`) is
  split on commas. A second Vite instance on `:5174` gets a 204 preflight with no
  `Access-Control-Allow-Origin`, so every fetch dies as an opaque network error that looks
  like broken auth. Add the origin to `backend/.env` instead of debugging the frontend.
- `data/nexora.db` (+ `-wal`/`-shm`) and `uploads/` are runtime state.
  `npm --prefix backend run db:reset` **deletes** them; only run it when asked.
- There is no seeded user. The frontend's "Continue as Demo" does
  `login(demo@nexora.ai/demo1234)` and on failure `register()`s that account — a fresh DB
  needs one demo click before the user exists.
- Schema changes go in `migrate()` in `db/index.js` as `CREATE TABLE IF NOT EXISTS` plus a
  guarded `ALTER TABLE` (`PRAGMA table_info` check), so old databases upgrade in place.

## Related skills

`nexora-project-map`, `nexora-session-and-onboarding`, `browser-layout-verification`.
