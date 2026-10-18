# Nexora / Aira — Security Audit, Secrets Cleanup & Hardening

**Auditor role:** Senior Application Security / DevSecOps
**Scope:** entire repository (frontend `src/`, backend `backend/src/`, desktop agent `desktop-agent/src/`, config, Git state + full history, build artifacts, uploads, logs).
**Method:** fully **local** inspection. **No secret source code was sent to any third-party or cloud scanner.** Every detected value is reported **redacted** (file / line / type / masked fingerprint only).
**Date:** 2026-10-17
**Remote:** `origin → https://github.com/Awaisbutt2007/Nexora-` (branch `main`, 5 commits) — **repo is PUBLIC** (verified by fetching the GitHub page without authentication).

---

## 1. Executive summary

The Nexora/Aira codebase is **already substantially hardened**. The core authentication, authorization, SQL, secrets-handling, CORS, rate-limiting and the desktop-agent security model are implemented correctly and defensively. A full secret scan of the **working tree and all 172 historical Git blobs** found **no real provider credentials (OpenAI / Google / Anthropic / AWS), no private keys, no DB connection strings with embedded passwords, and no production `JWT_SECRET` / `AGENT_SECRET` in Git**. Live secrets live only in untracked local `.env` files that are correctly ignored.

**Nothing that requires emergency credential rotation was found exposed.** The only historical artifact in the public Git history is the root `.env` from an early commit, and it contained **only a public Google OAuth client ID** — which is not a secret (OAuth web client IDs are meant to ship in the browser bundle).

Two genuine code defects were found and fixed during this audit:

1. **`POST /api/chat/proactive` performed its mock-mode short-circuit *before* the ownership check** — a non-owner received `200 skipped` instead of `404` (no data leaked, but authorization must precede handling). Fixed and covered by a new regression test.
2. **The production `JWT_SECRET` guard only rejected *missing* or the *exact default* value** — a weak secret (e.g. `password123`) would have passed. Fixed by adding a minimum-strength check, plus regression tests.

A CI/CD gate, a privacy-safe local secret scanner, a tracked-file guard, an aggregate security check and a dedicated security regression suite were added to make these guarantees durable.

**Overall release readiness:** **Green with caveats** — see §10. The main caveat is that the repository and its history are **public**, and full verification of GitHub **Actions logs / Releases / artifacts / deploy bundles could not be completed** from this environment (no authenticated GitHub access) — see §8.

---

## 2. Findings by severity

| # | Severity | Finding | Location | Exposure state |
|---|----------|---------|----------|----------------|
| F1 | **High** *(potential, now mitigated)* | `JWT_SECRET` production guard accepted weak-but-non-default secrets | `backend/src/config.js` prod block | Code defect; **not a leak**. Not reachable unless deployed in prod with a weak secret. **Fixed.** |
| F2 | **Medium** | Authorization-after-work: mock short-circuit ran before ownership check | `backend/src/routes/chat.js` `/proactive` | Code defect; no data leaked (returned empty). **Fixed.** |
| F3 | **Low** | Public Google OAuth **client ID** committed to Git history | root `.env` @ commits `dfb485b`, `7d9393c` (later deleted) | **Public** (repo is public) — but client IDs are non-secret by design |
| F4 | **Low / informational** | Hardcoded **test-only** JWT dummy | `backend/test/api.test.mjs:19` (`nexora-test-secret`); `backend/test/security.test.mjs` | Committed but a non-secret fixture; scanner is placeholder-aware |
| F5 | **Low** | `/health` (unauthenticated) reports AI mode, model name & voice model | `backend/src/index.js` `/health` | Public info disclosure (no secrets) — accepted tradeoff; flagged for review |
| F6 | **Informational** | `POST /api/user/upgrade` grants any plan with no payment verification | `backend/src/routes/user.js` `/upgrade` | Self-account only (horizontal); a product/business gap, not a token/auth bypass |

No Critical findings were identified.

---

## 3. Exact affected paths & masked fingerprints

> Only masked fingerprints are shown. The full values are **never** reproduced here, in logs, in code, or in chat.

- **F3 — root `.env` in history (only variable):** `VITE_GOOGLE_CLIENT_ID`
  - File: `.env` at commit `dfb485b` (deleted at `7d9393c`, not present in `HEAD`).
  - Type: Google OAuth 2.0 **Web client ID** (public identifier).
  - Verdict: **not a credential**; no rotation possible/required. Confirm origin allow-listing instead (§9).

- **F4 — test JWT dummy:**
  - `backend/test/api.test.mjs:19` — fingerprint `JWT…t' (len 33, sha 91f5e173)` → resolves to the literal placeholder `nexora-test-secret`.
  - `backend/test/security.test.mjs` — intentional weak values (`password123`, `a`.repeat(48)) used **only to assert they are rejected**; scanner skips `test/` paths for the heuristic rule.

- **Live secrets (present ONLY in untracked local files — NOT in Git, NOT in history, NOT in the frontend bundle):**
  - `backend/.env` → `JWT_SECRET`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `DESKTOP_AGENT_SECRET` (if set). **Untracked & ignored.**
  - `desktop-agent/.env` → `AGENT_SECRET`. **Untracked & ignored.**
  - Confirmed via `git ls-files backend/.env desktop-agent/.env` → empty; `.gitignore` rules verified (`.env`, `.env.*`, `!.env.example`).

---

## 4. Exposure-state classification (per the 5 required cases)

1. **Sensitive file exists locally, not tracked** — ✅ This is the correct, current state of all `.env` files, `backend/data/*.db`, `backend/uploads/*.wav`, `desktop-agent/data|audit|browser-profile`. The tracked-file guard confirms **113 tracked files, none sensitive**.
2. **Tracked or staged** — ❌ None. No secret, DB, upload, key or `.env` is tracked or staged.
3. **Secret in a local commit/branch** — ⚠️ Only the **public** Google OAuth client ID (F3) in `dfb485b`/`7d9393c`. No provider key, no private key, no real JWT/agent secret.
4. **Secret in the published GitHub repo/remote branch** — ⚠️ The same public client ID is in the public history (history is not rewritten). **No true secret.**
5. **Exposed via Actions logs / releases / artifacts / deploy bundles** — ❓ **NOT VERIFIABLE** from this environment (see §8). The frontend `VITE_GOOGLE_CLIENT_ID` legitimately appears in the production JS bundle (expected — it is a browser-side public ID).

---

## 5. Changes made & files modified

### Fixed (behavioral security improvements)
- **`backend/src/routes/chat.js`** — `/proactive`: moved the `user_id`-scoped ownership check to run **before** the mock-mode short-circuit and any DB read, so non-owners always get `404 not_found`.
- **`backend/src/config.js`** — production guard now also rejects a `JWT_SECRET` shorter than **32 chars** (in addition to missing / default), closing the "weak secret passes" gap.

### Added (ongoing protection / verification)
- **`scripts/secret-scan.mjs`** — privacy-safe local secret scanner. Detects OpenAI/Anthropic/Google/AWS/GitHub/Slack/PEM/DB-URL formats (**strict — always reported**) and generic hardcoded-secret assignments (**heuristic — placeholder/test-aware to avoid false positives**). Options: `--history` (scans every historical blob), `--json`. **Never prints values**, only fingerprints. Exit 1 on findings.
- **`scripts/security-check.mjs`** — aggregate gate: (1) tracked-file guard (proves Git is not tracking `.env`/DB/uploads/keys/audit/permissions — the check `.gitignore` alone cannot provide), (2) working-tree scan, (3) `--history` scan. Exit 1 on any problem.
- **`backend/test/security.test.mjs`** — 9 new regression tests: security headers, **cross-user IDOR** on conversations, **`/proactive` ownership**, memory isolation, and the **production fail-fast** guards (default / missing / weak `JWT_SECRET`, localhost CORS, and a positive "boots when correct" case).
- **`.github/workflows/security.yml`** — CI: `fetch-depth: 0`, runs `security-check.mjs --history` as a **blocking** gate, then lint, production build, backend tests (incl. security), desktop-agent tests, and `npm audit --audit-level=high` for root + backend.
- **`package.json` (root)** scripts: `security:scan`, `security:scan:history`, `security:check`, `security:check:full`, `test:agent`, `audit:all`.

No user data, screenshots, working features, or existing configuration were deleted. Existing tests were **not** disabled or weakened. Changes are in the working tree; **nothing was committed or pushed** (per your rules — commit only when you ask).

---

## 6. Credential rotation

- **Required:** **None.** No live provider key, signing secret, DB password, OAuth client **secret**, or private key is (or was) in Git. The two `.env` files with real values are untracked.
- **The public Google OAuth client ID (F3):** client IDs are **not** secrets and cannot/need-not be "rotated". The correct control is **origin restriction** (see §9).
- **Recommendation (not rotation):** the `DEFAULT_DEV_JWT_SECRET` (`nexora-dev-secret-change-me`) is committed in `config.js` and `.env.example`. It is a placeholder and is refused in production (now also for weakness). No real deployment should reuse it — always generate a fresh one:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- **If you later discover a real key was ever pasted anywhere:** treat it as compromised → revoke at the provider dashboard (OpenAI: Platform → API keys → revoke; Google Cloud: Credentials → delete/regenerate; then update the local untracked `.env` via your normal env setup — never commit the replacement).

---

## 7. Git history cleanup status

- **Status:** **Not executed** (correctly — no true secret justifies it, and rewriting public shared history needs your explicit approval + is destructive).
- **Why removing the current file is not enough:** `.env` is absent from `HEAD` but its blob remains reachable at commits `dfb485b`/`7d9393c` and on the pushed `origin/main`. `git rm` only affects the tip.
- **Only content at risk in history:** the public OAuth client ID (non-secret). 
- **If you still want history scrubbed** (optional, requires approval): 
  1. Confirm no other branch/tag/fork/PR caches the blob; GitHub retains orphaned commits until GC and via the **Commit/refs API** even after a force-push.
  2. Back up a recoverable clone first: `git clone --mirror <repo> backup.git`.
  3. Rewrite with `git filter-repo` (recommended over BFG for precision) to drop `**/.env`, or `git filter-branch`/BFG `--invert-include`.
  4. Force-push to `main` — **only after explicit approval** — then contact GitHub Support to run GC / expire cached views, and delete any forks that still hold the blob.
  5. Re-verify: `node scripts/secret-scan.mjs --history` returns clean against the rewritten refs.
- **Priority:** revoking exposed real credentials (none here) always precedes history cleanup.

---

## 8. Tests & scanners executed (with results)

| Check | Command | Exit | Result |
|-------|---------|------|--------|
| Aggregate gate + history | `node scripts/security-check.mjs --history` | 0 | 🟢 PASSED — 113 tracked files clean, working tree + **172 historical blobs** no secrets |
| Scanner self-test | planted fake `sk-…` in `_selftest_leak.txt` | 1 | 🟢 Caught (strict rule) `[openai-key] … fp sk-…45 (len 33)`; temp file removed |
| Backend tests (incl. new security) | `node --test` (backend/) | 0 | ✅ **28/28 pass, 0 fail** |
| Desktop-agent tests | `node --test` (desktop-agent/) | 0 | ✅ **22/22 pass, 0 fail** |
| Frontend build | `npm run build` | 0 | ✅ built in 545ms |
| Lint | `npm run lint` | 0 | ✅ **0 errors**, 9 warnings (pre-existing React-Compiler/exhaustive-deps informational notes) |
| Dependency audit | `npm audit --omit=dev --audit-level=high` × (root, backend, desktop-agent) | 0 | ✅ **0 vulnerabilities** in all three |

**Remote checks NOT performed (stated explicitly):** verification of GitHub **Actions run logs, Releases, uploaded artifacts, and any deployment/hosting bundle**, and enumeration of **forks/cached views**, could not be completed because this environment has no authenticated GitHub access and does not query external scanning services. These remain as residual unknowns in §9/§10. The repository being **public** was independently confirmed.

---

## 9. Remaining risks & manual steps

1. **Google OAuth client origin allow-listing** *(Low)* — confirm the client ID at `console.cloud.google.com` restricts **Authorized JavaScript origins** to your real frontend origin(s) and that no browser key/secret is attached. Client IDs are public; the protection is origin scoping + (for installed/web) the redirect URI allow-list.
2. **Public repo surface** *(process)* — anyone can read code + history. Before enabling the CI, note that `.github/workflows/security.yml` will run on public forks on PRs; keep any future **private** secret out of workflow logs. Rotate anything you ever paste into an issue/PR comment.
3. **Real `.env` values** *(hygiene)* — `backend/.env` (OpenAI key, prod JWT) and `desktop-agent/.env` (`AGENT_SECRET`) are untracked but exist on disk. Ensure they are **not** included in any manual zip/upload, and that hosting injects them via the platform secret store (never committed). Confirm the OpenAI key has a spend limit / is a least-privilege key.
4. **`/health` disclosure** *(accept or harden)* — optionally gate the `ai/model/voice` fields to non-production. Low risk.
5. **Plan upgrade without payment** *(business)* — `POST /api/user/upgrade` needs no payment gate; acceptable until billing exists, but add real authorization/verification before charging money.
6. **Multi-instance scaling** *(future)* — the in-memory auth & voice rate limiters reset per process and don't share state; move to Redis if you run more than one instance.
7. **Pre-commit hook** *(recommended)* — wire `npm run security:check` into a local hook (e.g. Husky `pre-commit`) so leaks are blocked before they reach CI.

---

## 10. Final release-readiness assessment

**Ready with caveats.** No live credential is exposed in the repository or its public history, so there is **no mandatory emergency rotation** blocking release. The code fixes (F1, F2) and their regression tests are in place and green; the CI gate will now block future secret commits and re-run the hardening tests on every push/PR.

**Ship-readiness checklist:**
- [x] No real secrets in working tree or Git history (scanner-verified).
- [x] `.env` / DB / uploads / keys are untracked and correctly ignored.
- [x] JWT/authorization model, IDOR ownership, parameterized SQL, CORS allow-list, security headers, auth rate-limiting verified.
- [x] Desktop-agent default-deny, loopback-only bind, mandatory `AGENT_SECRET` (≥16), timing-safe auth, path-containment, `alwaysConfirm` verified.
- [x] Two defects fixed with tests; full suites pass (backend 28/28, agent 22/22); build ✓; lint 0 errors; audits 0 vulns.
- [ ] **Manual:** confirm Google OAuth origin allow-listing (§9.1).
- [ ] **Manual:** confirm the repo has no cached public artifacts you don't want (Actions/Releases) — could not be verified here (§8).
- [ ] **Optional:** history scrub for the public client ID only if policy demands it (needs approval; §7).
- [ ] Commit these changes when you approve (nothing was committed/pushed).

**Assumption vs. fact:** Facts are the command outputs and file contents inspected above. The assumption that the historical client ID is non-secret rests on OAuth spec (web client IDs are public); if that value turns out to be a **client SECRET** rather than an ID, it must be rotated (delete/regenerate in Google Cloud Console) and history scrubbed — flag this and I will re-scan that specific blob to confirm its type (without printing it).
