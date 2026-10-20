---
name: nexora-frontend-conventions
description: Code and CSS conventions for the Nexora React frontend — one-line compact CSS rules, module-scope data arrays, hidden-but-working scrollbars, footer button splits, fixed-dock clearance, oxlint purity rules and a11y expectations. Use when editing anything under src/ or the co-located .css files, or when asked to match the existing style.
---

# Nexora Frontend Conventions

Match the surrounding code: this repo is dense on purpose. New code that reads like
boilerplate is a defect here.

## JSX

- **Content lives in module-scope arrays** (`NAV_SECTIONS`, `navItems`, `tools`,
  `featureList`, `testimonials`, `faqs`) and the JSX maps over them. Small repetitive
  markup is written as one line inside the map — no multi-line blocks for a button.
- Views are plain functions in the same file (`Landing`, `Workspace`, `Nexora`), not
  new modules. Split files only for a genuinely separate surface (`SignIn`, `Onboarding`,
  `NanoParticles`, `ThreeHero`).
- Heavy children are `lazy()` + `<Suspense>` (`ThreeHero`, `Onboarding`).
- Effects clean up after themselves: every `addEventListener` / `ResizeObserver` has a
  matching removal in the returned teardown.
- Refs hold values that must not re-trigger an effect (e.g. the `onBox` crop callback).

## CSS

- One stylesheet per surface, imported by its component; rules are written as
  **one-line blocks** (`A { … }.B { … }` chained per section) with a `/* section */`
  comment above each group. Keep that density.
- Palette is fixed — reuse the existing tokens instead of inventing colours:
  text `#f3f4ff / #e7e8f4`, muted `#8f96ae / #949bb3`, borders `rgba(149,162,215,.13)`,
  violet accents `#bd6cff → #5fd0ff` gradients, panel fill `rgba(10,14,28,.73)`.
- Fluid sizing with `clamp()` / `min()` (`min(66vw,480px,46vh)`), never fixed breakpoints
  in JS.
- Breakpoints: `1440` up, `1000` (nav collapses to hamburger), `720` (phone), `390`.
- Type sizes belong in `src/typography.css` overrides, not sprinkled into components.

### Hidden scrollbars (project rule)

Scroll everywhere, show nothing:

```css
.panel { scrollbar-width: none; -ms-overflow-style: none; }
.panel::-webkit-scrollbar { display: none; width: 0; height: 0; }
```

Applied to `html, body` and to `.recent-panel`, `.workspace-page-panel`, `.chat-thread`.
New scrollable surfaces must join that selector list.

### Layout patterns

- **Footer button split**: rows are plain flex (`gap`, `flex-wrap: wrap`, `width: 100%`)
  and the split comes from *button auto margins* — the back action gets
  `margin-right: auto`, the primary action `margin-left: auto`. Never
  `justify-content: space-between`: a lone button must still hug the right edge.
  Back/Skip stays first in DOM order so tab order reads left to right.
- **Fixed overlays reserve space**: `.workspace-dock` is `position: fixed` bottom-left,
  so `.workspace-content` carries a matching `padding-bottom` (142px) and inner
  `min-height`s are `clamp()`-ed down to match. Anything new that floats over the
  workspace must extend this reservation, and a verification check must assert that no
  visible element's rect intersects it.
- **Animated indicators are one shared element** positioned by JS, never a per-item
  `::after` (a pseudo-element can only blink, not travel). See
  `browser-layout-verification` for the measurement rules that keep it pixel-accurate.

### Companion settings live on the account, not just localStorage

The five Settings choices (`voice`, `language`, `assistantName`, `persona`, `gender`) are
stored per-origin in `localStorage['nexora_voice_prefs']` **and** on the user row
(`users.prefs_json`). localStorage alone was the bug: it is per-origin and cleared on
logout, so opening `:8787` after saving on `:5173` silently reset a user's "Urdu first"
back to `auto`, and Hinglish replies looked like the setting was ignored.

- `voicePrefs` is **derived**, not set in an effect:
  `const voicePrefs = useMemo(() => loadVoicePrefs(localPrefs, userProfile?.prefs), [localPrefs, userProfile?.prefs])`.
  `loadVoicePrefs(local, account)` merges local under the account copy (account wins) and
  re-validates every field, so a hand-edited blob can't push a bad `language` into the
  chat schema. Deriving it (instead of `setState` in an effect) is what keeps oxlint's
  `set-state-in-effect` / `exhaustive-deps` warnings at the baseline.
- `persistVoicePrefs(next)` writes local state + localStorage, then pushes to the server via
  `updateProfile(token, { prefs })` when logged in. Only the five payload keys are sent
  (`voicePrefsPayload`).
- **Read before you write on first run.** When the cached profile has no saved prefs, the
  sync effect must call `me(token)` first: if the server already has prefs, hydrate from
  them (`onProfileUpdate`) and do nothing else. Pushing local defaults blindly overwrote a
  saved `language:'ur'` with `'auto'`. Guard with a `prefsPushedRef` keyed on user id so it
  runs at most once per account, and swallow the `catch` (offline — the next edit retries).

## Lint (oxlint) rules that actually bite

- `react(purity)`: no `Date.now()`, `Math.random()` or `window.*` reads inside render or
  event handlers — move them into an effect/listener body (this also fixed a real bug:
  the scroll-spy lock is now armed by `hashchange`, which covers keyboard and middle
  click too).
- Baseline is **11 warnings / 0 errors** (up from 6 as features landed). Do not add to it —
  prefer derived `useMemo` state over `setState` in an effect, and complete every deps array.

## Accessibility

Every interactive element is a real `<button type="button">` or `<a href>`; icon-only
controls get `aria-label`; the active nav link gets `aria-current="page"`; drawers use
`role="dialog"` + `aria-expanded` + `aria-haspopup`; live text uses `aria-live="polite"`;
decorative markers use `aria-hidden="true"`.

## Verifying visual work

Never claim a layout fix works from reading the CSS — drive the real app in a harness.
See the `browser-layout-verification` skill, then finish with `npm run build` and
`npm run lint`.
