---
name: browser-layout-verification
description: Prove a CSS or layout change really works by driving the live app from a throwaway harness page in public/ that iframes the app and asserts numbers. Use for any visual/layout fix, before reporting that a UI bug is fixed, or when a screenshot is unavailable. Covers the measurement traps that make correct CSS look broken (entrance transforms, transitions sampled mid-flight, scrollbar-gutter maths, hidden tabs, cached harness files).
---

# Browser Layout Verification

The rule: **a layout claim without a measured number is not a result.** Screenshots are
usually unavailable (background tabs time out), so assert geometry instead.

## Workflow

```
- [ ] 1. Write public/_<name>.html from template.html in this folder
- [ ] 2. Serve the app (npm run dev) and open http://localhost:<port>/_<name>.html?cb=1
- [ ] 3. Read the result by evaluating document.querySelector('pre').innerText
- [ ] 4. Fix the PRODUCT when a check fails; fix the HARNESS when the check itself is
         provably wrong (say so explicitly, never silently loosen a threshold)
- [ ] 5. Re-run with a NEW ?cb= value until 0 failures
- [ ] 6. Delete the harness file, then npm run build ; npm run lint
```

Run the harness through the Browser subagent: navigate, poll every ~10s until the output
stops changing, return the raw text verbatim. Never ask it for a screenshot.

## Non-negotiable harness rules

1. **Stash, don't wipe.** Remove only `nexora_user_session` and
   `nexora_onboarding_pending`, keep their values, and restore them on `pagehide` *and*
   in the `catch`. `localStorage.clear()` destroys the user's session.
2. **Cache-bust every run.** Vite serves `public/*.html` from cache — `?cb=2`, `?cb=3` …
   A stale copy silently re-tests the old code and burns a whole round.
3. **Kill entrance animation** before measuring:
   `<style>.onboarding-page,.floating-header{animation:none!important}</style>`, and set
   `doc.documentElement.style.scrollBehavior = 'auto'` so jumps are deterministic.
4. **Wait past the transition.** Measure only after `transition-duration + margin`
   (e.g. a `.38s` glide needs ~550ms). Sampling at 120ms measures the animation, not
   the result.
5. **Prove the control.** When asserting something is hidden (a scrollbar gutter of 0),
   first assert an ordinary scroller in the same run reports ~15px, otherwise 0 proves
   nothing.
6. **Assert structure when motion is unprovable.** A hidden tab renders no frames, so CSS
   transitions resolve straight to their end value and mid-flight sampling can never show
   travel. Assert instead: exactly one shared indicator element exists, its computed
   `transition-property`/`duration` include the animated properties, and the old
   per-item `::after` rule is gone.

## Measurement traps (each one cost a real debugging cycle)

| Trap | Wrong | Right |
| --- | --- | --- |
| Element has a CSS `transform` | `getBoundingClientRect()` of the active link, which lifts `translateY(-1px)` over `.2s` and parks a JS-positioned bar 1px off forever | read the **layout box** (`offsetTop + offsetHeight`) for that axis |
| Ancestor's box is fixed while its content reflows | `ResizeObserver` on the container only | observe the container **and every child label**, plus `document.fonts.ready` and `resize` |
| Scrollbar gutter | `offsetWidth - clientWidth - padding` (double-counts; `clientWidth` already includes padding) | `offsetWidth - borderLeft - borderRight - clientWidth` |
| Overflow probe inside a flex-column panel | a tall child that just shrinks to fit | force `display:block` on the probe |
| "Same line vs wrapped" | comparing rect **tops** of differently-sized buttons under `align-items:center` | `next.left >= back.right` and `row.height == tallest child` |
| Reading stylesheet rules | exact `selectorText` equality (PostCSS reformats it) | computed style on a real element |
| Statements starting with `[` | `say('x')` then a newline then `[...list].find(...)` — parsed as an index access | bind to a `const` first |

## Reaching the workspace without a working backend

Write a fake session into `localStorage` before loading `/`:

```js
localStorage.setItem('nexora_user_session', JSON.stringify({
  isLoggedIn: true, token: 'harness-offline-token',
  userProfile: { name: 'Demo Explorer', email: 'demo@nexora.ai', avatar: null, isPremium: false },
  inWorkspace: true, activeView: 'Home',
}))
```

`me(token)` then fails on CORS as a *network* error (not 401), so the app's cached-session
branch keeps the workspace open. A real "Continue as Demo" login needs both the backend on
`:8787` **and** the harness origin whitelisted in `CORS_ORIGIN`.

## Reporting

Quote the numbers ("centre off 0.0px", "gutter 0.0px while `scrollTop` reached 300"), and
state what could not be proven in the environment and what structural assertion replaced
it.
