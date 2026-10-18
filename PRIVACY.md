# PRIVACY.md — Nexora / Aira

This document states, with **evidence**, what is kept private between users and
how. The short answer to the request *"meri chat, mera AI training aur meri
search kisi aur ko na dikhe"*: **enforced on the server for every account, and
locked in by automated tests.**

## What is private, and how it is guaranteed

| Your data | Where it lives | Isolation rule | Proven by |
|---|---|---|---|
| Chat messages & conversation history | `messages`, `conversations` (SQLite) | Every read/write is `WHERE id = ? AND user_id = ?`; the list is `WHERE user_id = ?` | `privacy: conversation list only returns the caller's own`, `security: … IDOR`, `privacy: one user cannot read OR write into another user's conversation via completions` |
| How you "trained" Aira (the facts she remembers) | `memories` (per `user_id`) | Only your own memories are listed/saved and only they are injected into your prompts (`SELECT … WHERE user_id = ?`) | `security: memory of one user is invisible to another`; chat/realtime load memories by `req.user.id` |
| Your AI's name / persona / voice | browser `localStorage` (this device) | Cleared on sign-out so the next account on the same browser can't inherit it (see caveat below) | `handleLogout()` in `src/Nexora.jsx` |
| Your tool runs (Code/PDF/Notes/…) | `tool_runs` (per `user_id`) | `/api/tools/runs` returns only `WHERE user_id = ?` | `privacy: tool-run history is isolated per user` |
| Your voice prints / recordings | `voice_prints` + `uploads/*.wav` | Listed and deleted only `WHERE user_id = ?`; files are never git-tracked and served only to the owner | `privacy`/`security` suites + `security-check` tracked-file guard |
| Anything you type / "search" | request → your conversation only | There is **no** shared/global search index and **no** web-search feature; your text goes only to the model under your own session and is stored under your `user_id` | traced in `routes/chat.js`, `services/ai.js` |

## The security boundary is the server, not the UI
- Every data route runs `requireAuth` (JWT) **first**, so an unauthenticated or
  forged request cannot read anyone's data.
- Ownership is re-checked in SQL on every per-resource access — the model never
  sees another user's history or memories because the DB query filters by
  `user_id` before the prompt is built.
- These are not just "coded correctly", they are **regression-tested**: run
  `npm test` (from `backend/`) — the `privacy:` and `security:` tests fail the
  build if any isolation ever breaks.

## One honest caveat — a shared browser on the same device
Your **account-to-account** isolation is enforced server-side. The exception is a
single **shared physical browser**:
- Nexora keeps you signed in (the session token is stored in `localStorage`) so
  the app reloads without logging you out.
- **If you close the tab without signing out, the next person who opens that
  browser is still signed in as you** and can see your chat — this is standard
  "stay signed in" behaviour, not a bug.
- Mitigation: **Sign Out** when you are done on a shared machine. On sign-out we
  now wipe the session **and** the local AI persona / voice / onboarding config,
  and the in-memory transcript is dropped. Nothing of yours is left in that
  browser for the next user.

If you want stronger device-level protection (e.g. an app-lock/PIN, or expiring
the session on tab close), that is a product decision — noted in `NEXT_STEPS.md`.

## What we never do
- Never send your conversations, memories or recordings to another user.
- Never store a secret/API key in the browser bundle (only public `VITE_*`).
- Never put your raw data in logs — errors are redacted to the client.
- `.gitignore` + the CI tracked-file guard keep your DB and `uploads/*.wav` out of
  the repository entirely.

See also `SECURITY.md` and `SECURITY_AUDIT_REPORT.md`.
