# NEXT_STEPS.md — Nexora / Aira

Prioritised remaining work, ordered by **value ÷ risk**. Each item lists the
real files to touch so a future session can execute without re-discovery.

## P0 — Small, safe, high-value (no external dependency; do next)
1. **Honest tool labels** (Part 5/9 honesty): "PDF Reader" and "YouTube Notes"
   are paste-only today. Either (a) rename them in `routes/tools.js` `TOOL_CATALOG`
   + `Nexora.jsx` UI to "…from pasted text", or (b) implement real ingestion (P1-4/5).
   Do (a) now so the UI never over-promises.
2. **`/health` information disclosure** (audit §10): ✅ **done** — `/health` now reports
   readiness only (`status`, `service`, `time`, `ai: live|text-only|mock`, `voice:
   ready|unavailable (reason)`). The model id, voice model and base URL are behind
   `HEALTH_VERBOSE=1` for the operator's own machine, and the SSE chunks, the
   non-streaming body, the conversation rows, the tool-run payload and the voice token
   all answer `nexora` instead of the engine name (see `publicModelLabel()` in
   `backend/src/config.js`). Asserted by
   `test('security: the API never hands the client the engine name')`.
3. **Provider timeout on AI calls** (Part 14): pass a `timeout`/`maxRetries` to the
   OpenAI client in `services/ai.js` `createClient()` so a hung provider can't
   wedge a request/credit.
4. **Regenerate + copy-response** (Part 4): add a "Regenerate" action that re-runs
   the last user turn, and a copy-whole-message button, in `Nexora.jsx`. Low risk,
   reuses `sendPrompt`.
5. **Dead code**: `src/App.jsx` is unused Vite boilerplate — remove or wire the
   router intentionally; document the single entry (`main.jsx → Nexora.jsx`).
6. **Device-level privacy** (see `PRIVACY.md` caveat): optional app-lock/PIN, or
   move the session token to `sessionStorage` so a closed tab logs you out on a
   shared browser. **Product decision** — ask the user which trade-off they want
   before changing "stay signed in" behaviour.

## P1 — Medium features (need design + tests; some need a key/dep)
6. **Web search integration** (Part 11): provider-neutral `services/search.js`
   behind `SEARCH_PROVIDER`/`SEARCH_API_KEY`; show citations; **never** fabricate
   URLs; degrade to "no browsing" when unconfigured. Wire an opt-in toggle in chat.
7. **File upload + RAG** (Part 10): reuse the multer pattern in `routes/voice.js`;
   add `documents` table (per-user), text extraction (`pdf-parse`/`mammoth`),
   chunk + embed + retrieve; retention & delete controls; isolation tests.
8. **PDF / transcript ingestion for tools** (Part 9): real PDF text extraction and
   a YouTube transcript fetcher (only via an allowed integration; keep the
   user-paste fallback). Removes the "mislabel" caveat in P0-1.
9. **Auth completeness** (Part 3): email verification + password reset via a mail
   provider (behind env), and a server-side token-revocation list so "logout"
   actually invalidates sessions. Needs a real SMTP key → otherwise ⚪.
10. **Memory retention & dedupe** (Part 6): per-user cap, optional age-out,
    similarity merge of near-duplicate memories, provenance display.

## P2 — Production readiness (Part 12/16; needs approval to execute)
11. **Migrations**: introduce a versioned schema runner (replace "create if
    missing" in `db/index.js`) so prod schema changes are reviewable + reversible.
12. **Backups / account deletion**: documented SQLite backup + a real
    "delete my account" flow cascading conversations, messages, memory, tool_runs,
    voice files.
13. **Postgres path** (only if a multi-instance deploy is chosen): migration plan +
    dual-run tests. **Do not migrate blindly.**
14. **Deploy runbook**: pick a host; env, secrets, HTTPS, health, rollback steps →
    expand `docs/DEPLOYMENT.md` from template to executed instructions.
15. **Monitoring**: request metrics, error budget, provider health diagnostics
    without leaking secrets.

## Needs the user's decision / approval first
- Committing this session's changes (nothing is committed yet).
- Any Git-history scrub (the historical root `.env` only ever held a **public** OAuth
  client ID — Low; see `SECURITY_AUDIT_REPORT.md`).
- Real provider keys to convert ⚪ → ✅ (OpenAI/realtime, Google OAuth, mail, search).
- Paid usage, external emails/form submits, production deploys.
