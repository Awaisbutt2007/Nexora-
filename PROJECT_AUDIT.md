# PROJECT_AUDIT.md — Nexora / Aira

Evidence-based feature inventory. Every line below was **traced through the real
code** (frontend → API route → service → provider/DB), not inferred from file
names or UI labels. Status legend:

- ✅ **Implemented & verified** — code exists and is covered by a passing test or was run live.
- 🟡 **Partial** — works, but not to the full scope implied by its name/UI.
- 🟥 **Missing** — described in the master brief but not present in the codebase.
- ⚪ **Unverified** — code exists but could not be exercised here (needs real provider credentials or an external service).

Baseline captured before editing (this session):
- Frontend build: `npm run build` → ✅ built in < 1 s.
- Frontend lint: `npm run lint` → ✅ **0 errors**, 9 pre-existing warnings (all `react-hooks/exhaustive-deps`/`img`-onerror style, non-blocking).
- Backend tests: `npm test` (backend/) → ✅ **30 / 30** pass.
- Desktop-agent tests: `npm test` (desktop-agent/) → ✅ **22 / 22** pass (unchanged this session).
- Dependency audit: `npm audit --omit=dev` (root / backend / desktop-agent) → ✅ 0 vulnerabilities.
- Secret scan (working tree + 172 Git history blobs): ✅ clean — see `SECURITY_AUDIT_REPORT.md`.
- Real app entry is `src/main.jsx` → renders `src/Nexora.jsx`. `src/App.jsx` is leftover Vite boilerplate (dead code, harmless).

---

## 1. Frontend (React 19 + Vite 8, `src/`)

| Feature | Where | Status | Evidence |
|---|---|---|---|
| Landing / hero (3D + particles) | `Nexora.jsx`, `ThreeHero.jsx`, `NanoParticles.jsx`, `AnimeEffects.jsx`, `CursorTrail.jsx` | ✅ | Built; particle portrait engine documented in `.qoder/skills/particle-portrait-engine`. |
| Sign-in / register (email+password) | `SignIn.jsx` → `api/nexora.js` | ✅ | Hits `/api/auth/register`, `/api/auth/login`. |
| Google Sign-In | `SignIn.jsx` (`VITE_GOOGLE_CLIENT_ID`) | ⚪ | Client ID is public by design; real sign-in needs a configured Google OAuth client. Backend path verified in `routes/auth.js` (`tokeninfo` audience + issuer + email-verified checks). |
| Workspace: Chat / Tools / Memory views | `Nexora.jsx` (`view` state) | ✅ | |
| Onboarding flow | `Onboarding.jsx` | ✅ | Includes voice-print recording. |
| Voice call overlay | `VoiceCall.jsx` | ✅ (needs key) | See §4. |

## 2. Chat & conversation experience (Part 4)

| Capability | Status | Evidence / note |
|---|---|---|
| SSE streaming | ✅ | `streamChat()` in `src/api/nexora.js`; `POST /api/chat/completions`. |
| Markdown rendering | ✅ | Custom `renderMarkdown()` + `BLOCK_RE` in `Nexora.jsx` (~L558–711). |
| Fenced code blocks + copy button | ✅ | `CodeBlock` with `navigator.clipboard` + `execCommand` fallback. |
| Syntax highlighting | 🟥 | Code is shown plain (no token colouring). |
| Conversation create / rename / delete | ✅ | `routes/conversations.js`, ownership-gated. |
| History persisted across refresh | ✅ | DB + session keys; `X-Conversation-Id` header. |
| **Stop generation** | ✅ **(added this session)** | Frontend `AbortController` + Stop button; backend aborts provider on `req close`. |
| Regenerate last response | 🟥 | Not present. |
| Copy entire response | 🟥 | Only code blocks are copyable. |
| File / image attachments in chat | 🟥 | No upload path for chat input (voice uploads aside). |
| Web-search-grounded answers | 🟥 | No search integration (see §7). |
| Loading / empty / error states | ✅ | `streaming`, `error`, `notice` handling in `sendPrompt`. |

## 3. AI backend, personality & memory (Parts 5–6)

| Capability | Status | Evidence |
|---|---|---|
| Model integration (OpenAI-compatible) | ✅/⚪ | `services/ai.js`. Runs live with a key; mock stream when `OPENAI_API_KEY` empty. Real output verified end-to-end last session. |
| Emotional mirroring + proactive reach-out | ✅ | System prompt in `config.js`; `POST /api/chat/proactive` (ownership-guarded). Verified live last session. |
| Configurable assistant name / persona / language | ✅ | `assistantName`, `persona` threaded through chat + tools. |
| Memory CRUD (add / list / update / delete) | ✅ | `routes/memory.js`, scoped per `user_id`. |
| Cross-user memory isolation | ✅ | Regression test in `backend/test/security.test.mjs`. |
| Memory retrieved into prompts | ✅ | `buildMessages(history, memories)`. |
| Duplicate detection / retention policy | 🟡 | Upsert by key exists; no age-out / retention limit. |
| Prompt-injection defence on tool/doc input | 🟡 | Tool briefs constrain output; no explicit untrusted-content hardening (Part 5/9). |

## 4. Voice / realtime (Part 7)

| Capability | Status | Evidence |
|---|---|---|
| Realtime speech-to-speech | ⚪ | `routes/realtime.js` + `services/realtime.js` (OpenAI Realtime). Needs a real key — no mock; cannot be exercised in this environment. |
| Mic permission / device errors | ✅ | `VoiceCall.jsx` getUserMedia + track teardown. |
| Mute / interrupt / stop | ✅ | `muted` state, `interrupted` handling, `response.created` events. |
| Listening / speaking / thinking indicators | ✅ | `micState` machine in `VoiceCall.jsx`. |
| Transcript persistence + safe storage | ✅ | WAV uploads (`routes/voice.js`), nanoid filenames, extension whitelist, 10 MB cap. |
| Voice-print / speaker verification | 🟡 | `services/voice.js`, threshold config; real model quality ⚪ unverified. |
| Text-to-speech speed / voice choice | ✅ (config) | `VOICE_VOICE`, `VOICE_OUTPUT_SPEED`, `VOICE_TURN_EAGERNESS`. |
| Graceful fallback when voice unavailable | ✅ | Bridge returns a clear disabled/unavailable error; no fake audio. |

## 5. Desktop agent & computer control (Part 8) — `desktop-agent/`

| Capability | Status | Evidence |
|---|---|---|
| Loopback-only agent (no remote-control exposure) | ✅ | `config.js` refuses non-loopback bind; backend `isLoopbackUrl` SSRF guard. |
| Shared-secret bearer auth, fail-closed | ✅ | `timingSafeEqual`, `requireAgent` → 503 when unset. |
| Least-privilege scope model | ✅ | `permissions.js` default-deny; `allowlist.js`. |
| File-op path containment (no `..`/symlink escape) | ✅ | `fsops.js` `resolveWithinAllowed` (realpath). |
| Destructive actions require explicit confirm | ✅ | `alwaysConfirm` scopes; audit log (`audit.js`). |
| Playwright browser automation | 🟡 | Present; ⚪ not exercised here. |
| Backend bridge to agent | ✅ (disabled by default) | `services/desktopAgent.js`; `/api/desktop/*` returns 503 without `DESKTOP_AGENT_SECRET`. |

## 6. AI tools (Part 9) — `routes/tools.js`

All six tools run a **real** `completeChat` model call (no canned placeholder),
charged in credits, results persisted to `tool_runs`.

| Tool | Status | Reality |
|---|---|---|
| Code Assistant | ✅ | Real model run with a strict "full code, no stubs" brief. |
| Image Generator | ✅ | Real Pollinations (Flux) URL; NSFW blocklist gate. ⚪ external service not fetched here. |
| PDF Reader | 🟡 | **Name oversells.** It summarises/answers **pasted text only** — no PDF upload or text extraction, and it tells the user so. See §10. |
| YouTube Notes | 🟡 | **Name oversells.** Transcript **paste only** — no transcript retrieval. See §11. |
| Meeting Notes | ✅ | Paste notes → decisions / actions / open questions. |
| Social Studio | ✅ | Idea → platform-native drafts (no auto-publish). |

## 7. Web search & research (Part 11) — 🟥 MISSING
No provider integration exists. Aira does not browse or cite live sources.

## 8. File uploads / knowledge / RAG (Part 10) — 🟥 MISSING
Uploads exist **only** for voice audio. No document store, chunking, retrieval,
or per-user document access.

## 9. Database & reliability (Part 12)
- Engine: **SQLite via `node:sqlite`** (single file `backend/data/nexora.db`). Confirmed in `db/index.js`.
- Queries: 100% parameterized (`.prepare(...).get/all/run`) → injection-safe.
- User isolation: enforced on conversations, messages, memory, tools, voice.
- 🟡 No migration framework (schema created in code); 🟥 no Postgres path; 🟥 no automated backup; 🟡 account-deletion cascade partial.

## 10. Usage, cost & reliability (Part 14)
- Server-side credit enforcement: ✅ `services/credits.js` (`ensureCredits` before work, `deductCredits` after).
- Per-user request-rate limit on expensive AI endpoints: ✅ **(added this session)** `aiLimiter` on `/chat/completions`, `/proactive`, `/tools/:id/run`.
- Provider call timeouts: 🟡 agent bridge bounded; OpenAI client uses SDK defaults.
- Health endpoint: ✅ present and ✅ **no longer a disclosure** — `/health` reports readiness only; engine/voice model ids require `HEALTH_VERBOSE=1` (see security report F5).
- 🟥 No metrics/monitoring/alerting.
- 🟡 `/api/user/upgrade` grants premium with **no payment gate** (feature stub).

## 11. Auth & account security (Part 3)
- Email/password (bcrypt cost 10), JWT (7d expiry): ✅
- Google ID-token verification (audience + issuer + verified-email): ✅ (⚪ needs real client to fully exercise)
- Login/register brute-force rate limit: ✅ `authLimiter`
- Session invalidation on logout: 🟡 stateless JWT — no server-side revocation list.
- 🟥 Password reset & 🟥 email verification (email/password) flows.

## 12. Security, CI & secrets (Parts 2, 7, 15)
- Headers (nosniff / DENY / no-referrer / prod HSTS), CORS allowlist, error redaction: ✅
- Production fail-fast (missing/default/**weak JWT_SECRET**, localhost CORS): ✅ + tests
- IDOR/ownership + memory isolation + AI rate limit: ✅ regression tests (`backend/test/security.test.mjs`)
- Local secret scanner + aggregate check + Git-history scan: ✅ `scripts/`
- GitHub Actions security gate: ✅ `.github/workflows/security.yml`
- Full findings & remediation: see **`SECURITY_AUDIT_REPORT.md`**.

## 13. UI/UX & design (Part 13)
Dark premium theme, responsive breakpoints (desktop / 420px / mobile), reduced
the established branding. 🟡 Accessibility (ARIA/focus/skeletons) is partially
met; no light theme; design-system tokens not centralised.

## 14. Testing & deployment (Parts 15, 16)
- Tests: backend 30/30 (functional + security + cancellation + rate limit), agent 22/22, build+lint gate, `npm audit`. ✅ local.
- CI: security workflow runs the above as blocking gates. ✅
- 🟥 No deployment manifest / IaC / rollback runbook yet → see `docs/DEPLOYMENT.md` for the prepared, not-yet-executed plan.
