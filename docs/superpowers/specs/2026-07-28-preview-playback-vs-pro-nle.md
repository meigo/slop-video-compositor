# Preview playback vs pro NLE/compositor (deferred)

**Status:** deferred / not planned for v1  
**Date:** 2026-07-28  
**Context:** Playback in-app is acceptable for rough-cut → animator reference; hard-cut transitions are imperfect. This note captures why, and what “pro” tools do, for a possible later upgrade.

Related: design doc § Preview vs export (preview = feedback; export/ffmpeg = source of truth). Bit-identical preview/export is **not** required.

---

## Current architecture (slop-video-compositor)

| Mechanism | Role | Limit at cuts |
|-----------|------|----------------|
| HTML `<video>` free-run | Active clip plays via browser decoder | Browser owns timing, keyframes, audio clock |
| Dual buffer (active + standby) | Standby preloads next clip ~`PREFETCH_LEAD` (0.85s) early | Only helps if next is ready **before** the cut |
| Swap on cut | Switch which element is painted | Flash/hold if seek/decode not ready |
| Canvas composite | Scale/pan onto black | Extra copy; not a GPU timeline engine |
| Playhead follows `currentTime` | Sync from free-running element | Hand-off between elements at cuts |

Implementation: `src/lib/components/Preview.svelte` (dual slot, `prepareSlot`, `schedulePrefetch`, `swapToStandby`, free-run tick).

**Implication:** Transition glitches at hard cuts are a **class ceiling** of live multi-source HTML media, not a missing one-line fix.

---

## What professional NLEs / compositors typically do

### 1. Decoded frame cache (primary difference)
- Decode **ahead** into a ring of frames (CPU buffers or GPU textures).
- At cut time, **both** sides already have the frame for that timeline sample.
- Scrub uses the same cache → no “black until seeked.”

Our dual-buffer is a **two-clip, coarse** prefetch—not a frame cache.

### 2. Single timeline master clock
- One clock in **timeline time** (or fixed fps ticks).
- Each layer samples that time → source time via in/out/rate.
- No hand-off between separate `HTMLMediaElement` clocks.

### 3. Deeper prefetch
- Warm several upcoming (and often previous) segments.
- Not only “next clip id at sourceIn.”

### 4. Proxy / optimized media
- Play lower-res or edit-friendly GOP proxies for scrub/play.
- We play **source files** as-is → long-GOP H.264 seeks are costly and imprecise.

### 5. GPU-resident path
- Frames stay on GPU; composite is a shader pass.
- We: decode → browser → `canvas.drawImage`.

### 6. Separate audio graph
- Sample-accurate mix on a timeline clock.
- We: one unmuted video element; swap mutes the other.

---

## Why cuts are the hard case

At a hard cut, one display refresh ideally needs:

1. Correct last frame of A (or clean discard)  
2. Correct first frame of B at B’s source time  
3. Coherent A/V presentation  

Browsers optimize **continuous playback of one URL**, not **seamless multi-source A/B**.  
`seek` + readiness + first paint is async and keyframe-dependent.

**Export** (ffmpeg trim + encode + concat @ 30 fps) rebuilds a continuous file—exported cuts can look **cleaner than preview**. That is normal for this stack.

---

## Spectrum

```
This app              Light prosumer              Broadcast NLE / compositor
────────              ──────────────              ──────────────────────────
2 × <video>       →   decoder + small         →   media engine + deep
+ canvas              RAM frame ring              proxy + GPU cache +
+ 1 clip prefetch     + better seek               timeline clock +
                      heuristics                  multi-track A/V graph
```

True frame caching ≈ **own decoder or ffmpeg frame pipe + buffers + timeline-driven paint** — product leap, not a small polish PR.

---

## Possible later upgrades (cost ↑)

If preview cut quality becomes a goal, consider in order:

1. **Smarter prefetch** — earlier; require standby has a decoded frame, not only metadata.  
2. **Hold last good canvas** across swap — never flash black (partly present; tune).  
3. **Seek slightly early, play into cut** — fewer keyframe stalls; slight accuracy trade.  
4. **Proxy generation** for scrub/play — big UX win; still not suite-perfect.  
5. **Frame cache / custom media engine** — only if preview must feel “broadcast.”

**Non-goal for current product bar:** matching Premiere/Resolve/After Effects preview fidelity.  
**Current product bar:** acceptable free-run preview + reliable export for animator handoff.

---

## When to reopen this

- Users report cut flashes as blocking rough-cut judgment (not just polish).  
- Need scrub-accurate multi-clip review without exporting.  
- Willing to invest in proxies and/or native decode path (scope + platform cost).

Until then: treat imperfect in-app transitions as **known deferred**; prefer improving **export** correctness and edit UX over frame-server preview.
