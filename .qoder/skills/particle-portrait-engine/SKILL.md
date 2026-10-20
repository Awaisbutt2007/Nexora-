---
name: particle-portrait-engine
description: How Nexora's photo-based particle portraits work in src/NanoParticles.jsx — the sampling pipeline, background peeling, model-free head location, per-particle colour rules and the per-mode blending rule (portraits paint with NormalBlending, the orb glows with AdditiveBlending). Use when changing the 3D particle effects, when a face/hair/body comes out hollow or missing, when a portrait looks flat silver instead of showing skin tones, or when tuning portrait density and realism.
---

# Particle Portrait Engine

`src/NanoParticles.jsx` — `NanoParticles({ count = 30000, shape = 'orb', photoUrl = null, onFaceBox = null })`.
A Three.js point cloud. Shapes: `'orb'` (silver sphere), `'female'` / `'male'`
(built-in refs `src/assets/portrait-female.png`, `portrait-male.png`), `'custom'`
(the user's upload, decoded through the same pipeline with `faceCrop: true`).
`ThreeHero.jsx` is the separate landing companion — do not confuse them.

## Pipeline (`photoTargets(img, count, { tolerance, worldMax, lift, faceCrop, onBox, colorOut })`)

Order matters; each stage exists because a specific defect was measured:

```
- [ ] 1. draw to an offscreen canvas, max 480px wide
- [ ] 2. border-seeded flood fill = background, per-step colour delta (tolerance ~14)
         seed from the clip border; with faceCrop, pre-mark everything outside the
         head box as background
- [ ] 3. keep(p) guard: while faceCrop is on, REFUSE any skin pixel during the seed and
         every expansion step        <-- skin is never background inside a head box
- [ ] 4. backdrop rescue: median tone of the flooded area, reclassify pixels whose
         colour distance exceeds ~42-55 as foreground, BOUNDED to pixels no brighter
         than the backdrop luma
- [ ] 5. largest connected foreground blob only, then a head-ellipse veto, then
         re-tighten the bbox to what survived
- [ ] 6. rejection-sample pixels with brightness-weighted density; luminance -> Z depth
- [ ] 7. toneParticleColor() writes each surviving pixel's colour into colorOut
- [ ] 8. onBox reports the exact crop (kept in a ref so it cannot re-trigger the decode
         effect); the onboarding DP zooms onto it
```

## Model-free head location (`locateHead` + `isSkinPixel`)

Strict YCbCr skin chroma. Per row, the longest skin run qualifies only if it is
**narrower than 70% of the row and touches neither frame border** (that rejects walls,
headboards and shirts). Forehead = first row of 4 consecutive qualifying rows; cheeks =
widest row within `0.34 * H` below it → `faceW`, `cx`.

**Chin is anatomy, not colour:** `chin = forehead + round(faceW * 1.05)`; a run collapse
is only a floor, because a moustache breaks the run far above the jaw. Crown = walk up
through dark (`luma < 125`) or skin rows over the central `1.1 * faceW` columns until the
backdrop shows through. A dark **and** warm walk may extend the chin for a beard, capped
at `0.55 * faceW`. If detection fails, fall back to an upper-centre head-sized window —
never the whole photo.

## Colour rules

- **Blending is per mode, and it is the whole reason portraits look real.** In `animate()`
  the cloud material's `blending` is flipped by the `portrait` boolean: portraits use
  `THREE.NormalBlending` (paints each particle's actual pigment, so skin reads warm peach,
  lips red, hair brown); the silver orb keeps `THREE.AdditiveBlending` (overlapping light
  sums to a glow). Additive CANNOT show skin tone — dense skin sums every channel to white.
- `toneParticleColor()` therefore keeps the photo's real colour and only nudges it:
  vibrance `sat = 1.28`, then a gamma shadow-lift `0.1 + 0.92 * v^0.85` so dark hair reads
  as brown rather than vanishing into the black backdrop. There is deliberately **no `/luma`
  equalisation** — that old trick only existed to keep hair visible under additive and it is
  exactly what blew skin out to white.
- `animate()` eases the geometry `color` attribute toward `colorOut` (or back to the
  seeded silver `orbColors` when a shape has none) and sets `needsUpdate`. The orb itself
  stays silver.
- Because NormalBlending has no glow to fill the gaps between dots, portrait particles
  render thicker (`cloudMaterial.size = 0.028 + morphFactor * 0.03`) so the dots knit into
  solid skin instead of leaving black backdrop showing through.

## Portrait framing invariants

~65% thicker than the orb, turned slightly LEFT, ringed by a 190-dot spinning circle; the
dark core sphere scales to ~0 in portrait mode so it never occludes the face. Hair needs a
density floor of 0.68 to read as solid; male portraits must show suit shoulders via the
same density mapping.

## Verifying a change

Measure particles, do not eyeball them. Build a harness (see
`browser-layout-verification`) that runs the pipeline on the user's photo at 480px and
counts classes, then report the numbers:

- face particles as a share of all portrait particles (broken: 10.4%, fixed: 22.5%)
- surviving skin pixels protected by `keep(p)` vs unprotected (879 vs 55,253 before the guard)
- stray background particles after the rescue (2.1% unbounded, 0.3% bounded)
- share of particles below the visibility floor (target 0%)

## Symptom → cause

| Symptom | Cause |
| --- | --- |
| hollow ring where the face should be | flood fill walked through smooth skin → `keep(p)` missing or `faceCrop` off |
| hair missing / see-through | rescue threshold too high, or the shadow-lift floor lowered so dark hair paints black-on-black |
| wall pulled in as foreground | rescue not bounded by backdrop luma |
| chin cut at the moustache | run collapse used as the chin instead of a floor |
| face too small in frame | `onBox` crop not fed to the DP zoom |
| whole photo used as the head | `locateHead` failed and fell back to the full image — fix detection, do not widen the fallback |
