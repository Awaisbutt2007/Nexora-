# TESTING.md — Nexora / Aira

All commands are run from the **repo root** unless noted. The project uses Node's
built-in test runner (`node --test`) — no extra test framework to install.

## One-shot verification (what was run this session)

```bash
# 1. Build the frontend bundle
npm run build

# 2. Lint the frontend (must be 0 errors)
npm run lint

# 3. Backend functional + security tests
npm test            # alias for `npm --prefix backend test`

# 4. Desktop-agent security/permission tests
npm run test:agent

# 5. Dependency vulnerability audit across all three packages
npm run audit:all

# 6. Secret scanning (working tree + full Git history) + tracked-file guard
npm run security:check:full
```

Expected on a clean tree: build succeeds, lint reports **0 errors** (a handful of
non-blocking warnings), backend **30/30**, agent **22/22**, `audit` 0 high/critical,
`security:check:full` exits **0**.

## What each suite covers

### Backend (`backend/test/`)
- `api.test.mjs` — the HTTP surface end-to-end in **mock mode** (`OPENAI_API_KEY=''`,
  throwaway temp SQLite file, so no network and no paid usage): auth, conversations,
  memory, tools, credits, desktop-bridge fail-closed, plus:
  - `stream cancellation: a pre-aborted signal produces no deltas` — proves the AI
     service honours an aborted `signal`.
- `security.test.mjs` — hardening that must not regress:
  - baseline security headers, cross-user **IDOR** on conversations and `/proactive`,
    memory isolation between users,
  - `expensive AI endpoint is rate-limited per user (429 on burst)`,
  - production fail-fast guards (default / missing / **weak** `JWT_SECRET`, localhost
    CORS refused; strong secret boots).

### Desktop agent (`desktop-agent/test/security.test.mjs`)
Loopback-bind enforcement, shared-secret bearer auth (fail-closed), default-deny
scopes, path containment (`..`/symlink), destructive-action confirmation, SSRF guard.

## Test philosophy
- **Failure paths are tested, not just happy paths** (404 ownership, 429 throttle,
  503 disabled bridge, aborted stream, weak-secret refusal).
- Tests never hit paid providers or the network (forced mock + ephemeral DB).
- Tests must **not** be deleted or weakened to go green. A test that asserts a
  secret is *rejected* may contain a dummy value (e.g. `password123`); the secret
  scanner recognises test paths and skips heuristics there while **strict provider
  patterns still scan them**.

## CI
`.github/workflows/security.yml` runs the secret gate (blocking, with
`fetch-depth: 0` to scan history), then build, lint, backend tests, agent tests and
`npm audit --audit-level=high`. A red job blocks merge.

## Manual / live checks that tests can't prove (need credentials)
Real OpenAI/Groq chat, realtime voice, Google Sign-In, Pollinations image output,
and Playwright desktop automation are coded but require real keys and a device
session. Run them manually before claiming they work; see `NEXT_STEPS.md`.
