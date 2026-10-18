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
| `src/index.js` | Express app, CORS, `/health`, route mounting |
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
| Production build | `npm run build` |
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

## Three gotchas that cost hours

1. **The page talks to the API through Vite, not cross-origin.** `API_BASE` in
   `src/api/nexora.js` is `import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '' :
   'http://localhost:8787')` — in dev that is an empty string, so every call is a relative
   `/api/...` (and `/uploads/...`) request that `vite.config.js` proxies to `:8787`. Set
   `VITE_API_URL` only to bypass the proxy (a deployed backend); the production build keeps
   the absolute default. A down backend then reaches the browser as an empty **502** from the
   proxy (not a network error), and `parseJson()`/`apiErrorText()` render that as the same
   "start the API with npm run dev:all" message — `dev:all` exists so the pair is never
   started apart.
2. **When you do hit a real cross-origin call, an unlisted origin looks like broken auth.**
   `fetch` then rejects with an opaque `TypeError: Failed to fetch`, no status. `CORS_ORIGIN`
   is an exact comma list (`http://localhost:5173` by default); in development the backend
   also reflects any loopback or RFC 1918 origin on any port (`config.corsAllowLocalOrigins`),
   which covers Vite's port rollover to `:5174`, the printed `http://192.168.x.x:5173` Network
   URL and a phone on the same Wi-Fi. `apiErrorText()` turns the residual cases into a toast
   that names the failing address.
3. **The backend answers `GET /health`, not `/api/health`.**

## Related skills

`nexora-frontend-conventions`, `browser-layout-verification`, `particle-portrait-engine`,
`onboarding-wizard-flow`, `nexora-backend-api`.
