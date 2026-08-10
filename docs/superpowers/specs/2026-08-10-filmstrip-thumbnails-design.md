# Filmstrip thumbnails (light design)

**Status:** implement  
**Date:** 2026-08-10

## Goal

Show a horizontal strip of frames on each **video** clip block so sources are recognizable without opening the inspector.

## Behavior contract

1. Frames cover the **used** source range only: `[sourceIn, sourceOut)`.
2. **Density from duration only** (~2.5 tiles/s, min 6, max 64) — **not** from zoom.
3. Generate once per `(path, in, out, count, trackHeight)`; zoom only CSS-scales the sheet to the clip width (time still maps across the bar).
4. Cells use **contain + pad** (full frame, no head crop). Sheet native width = `count × 48px`.
5. **Audio-only**: no filmstrip.
6. **ffmpeg fail**: solid color + one-line status.
7. Disk JPEG cache + in-memory **LRU (48)** data-URLs.
8. **Optional** Thumbs toggle; track row **S/M/L** drives strip height.
9. Export / project JSON unchanged.

## Edge cases

| Case | Behavior |
|------|----------|
| Short clip | Few tiles (min 1–6) |
| Long clip | Cap 64 tiles |
| Zoom in/out | Same strip, CSS scale (no re-ffmpeg) |
| Track height S/M/L | New height → new key → regenerate |
| Trim in/out | New key → regenerate |

## Out of scope

- Scrub-accurate hover magnifier  
- GPU decoder filmstrip  
- Writing thumbs into the project package  
