---
name: nexora-project-map
description: Maps the Nexora repo — which file is the real app entry, where the landing page, workspace, onboarding, particle effects and the Express/SQLite backend live, plus npm scripts, ports, localStorage session keys and the CORS rule. Use when starting any task in this project, when locating where a feature lives, or when the app or its API fails to load.
---

# Nexora Project Map

React 19 + Vite frontend and an Express 5 + `node:sqlite` backend in one repo. No git
repository, so there is nothing to commit — never plan a commit step.

## Frontend entry chain

`index.html` → `src/main.jsx` → **`src/Nexora.jsx`** (default export = the whole app).

`src/App.jsx` and `src/App.css` are unused Vite boilerplate. Never edit them and never
wire anything new through them.

| File | Owns |
| --- | --- |
| `src/Nexora.jsx` | `Landing()` (marketing page + animated nav indicator), `Workspace()` (dashboard + account dock), `Nexora()` root (auth/session/onboarding routing) |
| `src/Nexora.css` | All landing + workspace styles, written as compact one-line rules |
| `src/Onboarding.jsx` / `Onboarding.css` | 5-stage new-user wizard |
| `src/SignIn.jsx` / `SignIn.css` | Login / sign-up / Google / "Continue as Demo" |
| `src/ThreeHero.jsx` | Landing 3D companion (lazy-loaded) |
| `src/NanoParticles.jsx` (used by Onboarding) | Photo-based particle portrait |
| `src/CursorTrail.jsx`, `src/AnimeEffects.jsx` | Ambient motion (anime.js) |
| `src/typography.css` | Global type scale; per-component font-size overrides |
| `src/api/nexora.js` | The only place that talks to the backend + session storage |
| `public/` | Static assets, copied verbatim into `dist/` by Vite |

## Backend (`backend/`)

| File | Owns |
| --- | --- |
| `src/index.js` | Express app, CORS, `/health`, route mounting, and serving `../dist` when a build exists |
| `src/config.js` | Env → `config`, `PLANS`, `SYSTEM_PROMPT` |
| `src/db/index.js` | `DatabaseSync` from `node:sqlite` (`getDb()`, `nowIso()`), schema in `src/db/reset.js` |
| `src/middleware/auth.js` | `signToken`, `requireAuth`, `optionalAuth`, `sanitizeUser` |
| `src/services/ai.js` | `streamChatCompletion`, `completeChat`, `estimateCredits` (mock mode when no key) |
| `src/routes/*` | `auth`, `chat`, `conversations`, `memory`, `tools`, `user` |
| `data/nexora.db`, `uploads/` | Runtime state — do not delete unless asked |

## Commands (PowerShell — use `;`, never `&&`)

| Task | Command |
| --- | --- |
| Both servers at once | `npm run dev:all` (`scripts/dev-all.mjs`: API + Vite, `[api]`/`[web]` log prefixes, Ctrl+C closes both) |
| Frontend dev | `npm run dev` (Vite; `http://localhost:5173`, silently rolls to the next free port) |
| Backend dev | `npm run dev:api` (`node --watch`), or `npm run start:api` |
| Production build | `npm run build` (writes `dist/`, which the API then serves at `http://localhost:8787`) |
| Lint | `npm run lint` (oxlint) |
| Backend tests | `npm --prefix backend test` (needs no running server) |
| Recreate the DB | `npm --prefix backend run db:reset` |

**Baseline after any change:** `npm run build` succeeds and `npm run lint` reports
11 warnings / 0 errors — those 11 are pre-existing `react-hooks/exhaustive-deps` style
noise. Anything above that baseline is yours to fix.

## State the app remembers

| Key | Written by | Holds |
| --- | --- | --- |
| `nexora_user_session` | `saveSession()` | `{ isLoggedIn, token, userProfile, inWorkspace, activeView }` |
| `nexora_onboarding_pending` | `Nexora()` | `'1'` (Google) or `'signup'` — keeps the wizard in front |
| `nexora_onboarding_progress` | `Onboarding.jsx` | Half-finished wizard stage |

## Four gotchas that cost hours

1. **The page always talks to itself — CORS is out of the picture.** `API_BASE` in
   `src/api/nexora.js` is `import.meta.env.VITE_API_URL ?? ''`, so calls are relative
   `/api/...` and `/uploads/...`, resolved against whatever served the page: `vite.config.js`
   proxies them in dev **and** `preview`, and in production the backend hosts `dist/` itself
   (`http://localhost:8787`). Set `VITE_API_URL` only when the frontend is deployed apart
   from its API. Consequence when the API is simply not running: through the proxy the
   browser gets an empty **502**, and hosted-directly it gets a network error —
   `parseJson()`/`apiErrorText()` turn both into "run npm run dev:all, then reload".
2. **Left-over servers from an earlier terminal are the real "nothing works" bug.** A
   previous session's `node --watch src/index.js` keeps its port after the terminal closes
   (and IDE-managed terminals get reaped between sessions, so the API can be gone while the
   page still looks loaded). Check before debugging code:
   `Get-NetTCPConnection -State Listen -LocalPort 8787,5173,5174` and
   `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,CommandLine`.
   A duplicate backend now exits with a printed explanation instead of a stack trace.
3. **If a request really is cross-origin, an unlisted origin looks like broken auth.**
   `fetch` rejects with an opaque `TypeError: Failed to fetch`, no status. `CORS_ORIGIN` is
   an exact comma list (`http://localhost:5173` by default); in development the backend also
   reflects any loopback or RFC 1918 origin on any port (`config.corsAllowLocalOrigins`),
   covering Vite's rollover to `:5174`, the printed `http://192.168.x.x:5173` Network URL and
   a phone on the same Wi-Fi.
4. **The backend answers `GET /health`, not `/api/health`.** (It answers `GET /` with the API
   docs only while no build is hosted.)

## Related skills

`nexora-frontend-conventions`, `browser-layout-verification`, `particle-portrait-engine`,
`onboarding-wizard-flow`, `nexora-backend-api`.
