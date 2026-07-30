# Loop playback — design

Date: 2026-07-31
Status: approved

## Problem

Preview playback stops at the end of the sequence (`Preview.svelte`, `tick()` →
`stopPlayback(totalDur, "Paused")`). Reviewing a short edit means pressing Space and Home
repeatedly. Add a loop toggle so playback wraps to the start instead of stopping.

## Scope

- Loops the **whole sequence** (0 → project duration → 0).
- Toggle state is **session-only**: not written to the project file, not written to app settings.
- Off by default.

Explicitly out of scope: in/out playback range, loop-selected-clip, ping-pong loop.

## State

`src/state/appState.svelte.ts` — one new field on `app`, beside the existing preview-only flags:

```ts
/** Preview-only: when true, playback wraps to 0 instead of stopping at the end. */
loopPlayback: false,
```

And one action:

```ts
export function toggleLoopPlayback() {
  app.loopPlayback = !app.loopPlayback;
  app.status = app.loopPlayback ? "Loop on" : "Loop off";
}
```

This is the same class of state as `previewMuted` and `previewSoloTrackId`: preview behavior,
never exported, never persisted.

## Wrap mechanic

The loop point is treated as **another hard cut**. The dual-decoder prefetch in `Preview.svelte`
already makes cuts seamless; the wrap is a cut whose "next clip" is the sequence's first clip.

Two changes in `Preview.svelte`:

1. **`schedulePrefetch(fromClip)`** — when `nextClipAfter()` returns `null` and
   `app.loopPlayback` is on, fall back to `firstClipInSequence(proj)` as the prefetch target.
   Standby is then warm at the first clip's `sourceIn` before the sequence ends.

2. **End-of-sequence check in `tick()`** (currently `if (t >= totalDur - 1e-6) stopPlayback(...)`) —
   when `app.loopPlayback` is on, wrap instead of stopping, in this order:
   - `setPlayhead(0)`,
   - if `clipAtTime(proj, 0)` hits a clip, try `swapToStandby(hit.clip)` — on success the new
     active slot free-runs immediately from `sourceIn` (seamless) and `playingClipId` is set by
     the swap itself,
   - on failure (or no clip at 0), pause both slots and set `playingClipId = null` so the next
     tick cold-starts through the existing `startClipPlayback` path,
   - continue the rAF loop rather than returning.

   `prefetchClipId` is left to `swapToStandby` → `schedulePrefetch`, which re-warms the other slot
   after the wrap exactly as it does after a normal cut.

No change is needed in the `pastOut` branch: when the last clip ends, `nextClipAfter` is `null`,
`t` becomes the clip's end (= sequence end when there is no trailing gap), and the end-of-sequence
check above handles the wrap. A trailing black gap plays out to `totalDur` first, then wraps —
correct, since the gap is part of the sequence.

**Degradation:** whenever standby is not warm, the wrap falls back to a cold load+seek. Playback
still loops; it just hitches at the loop point. This is the same failure mode existing cuts have.

**Single-clip sequences loop seamlessly for free:** `firstClipInSequence` returns the same clip
that is playing, so standby holds the same file seeked to `sourceIn`, and `swapToStandby` accepts
it (it matches on clip id and readiness). After the swap, the ex-active slot is re-warmed the same
way, so the arrangement is self-sustaining across cycles.

## New pure helper

`src/lib/previewTime.ts`, mirroring the structure of `nextClipAfter`:

```ts
/** First hard-cut clip in the sequence (skips a leading black gap). Null if empty. */
export function firstClipInSequence(project: Project): Clip | null
```

Collects candidate times (`0` plus every `clip.timelineStart` inside the sequence), sorts them
ascending, and returns the first `clipAtTime()` winner. Using `clipAtTime` rather than "lowest
`timelineStart`" keeps it consistent with hard-cut resolution: a higher track wins at the same time.

## UI

`src/lib/components/Transport.svelte`:

- New `Repeat` icon button (`@lucide/svelte/icons/repeat`) placed after Stop, before Mute.
- Props gain `loop: boolean` and `onToggleLoop: () => void`.
- `aria-pressed={loop}`, `title="Loop playback (L)"`, `aria-label="Loop playback"`.
- Active state is shown with a new `.on` class that tints the icon (`color: var(--text)` vs the
  default muted ghost). `app.css` has no shared pressed-state style, and the mute button
  distinguishes itself by swapping icons — which does not fit a single-icon toggle.

`src/routes/+page.svelte` wires `loop={app.loopPlayback}` and `onToggleLoop={toggleLoopPlayback}`.

## Keyboard

`L` (unmodified) in `onKeyDown` in `+page.svelte`, guarded by the existing input/textarea check.

Verified free — currently bound single keys are: Space, Home, End, `[`, `]`, PageUp, PageDown,
`M`, ArrowLeft/Right (`+page.svelte`), and `S` for split plus Delete/Backspace (`Timeline.svelte`).

## Status line

While playing, `statusHint` in `+page.svelte` becomes:

```
Space pause · [ ] cuts · L loop
```

(replacing `Space pause · [ ] cuts · Home/End ends`).

No status message is emitted on each wrap — it would overwrite real messages once per cycle.
`toggleLoopPlayback` sets status on toggle only.

## Testing

- `src/lib/previewTime.test.ts` gains cases for `firstClipInSequence`:
  - empty project → `null`
  - single clip at 0 → that clip
  - leading black gap → the first clip after the gap, not `null`
  - two tracks covering the same time → the higher track's clip

  (No "clip past the sequence end" case: `projectDuration` is `max(contentDuration, stored)`, so
  a clip's start is always inside the sequence. The `< total` guard is defensive, mirroring
  `nextClipAfter`.)
- The `tick()` wrap is component logic and is verified manually (play a two-clip sequence with
  loop on; confirm it wraps without stopping and without a black flash). `Preview.svelte` has no
  component tests today and this change does not introduce a harness for them.

## Edge cases

| Case | Behavior |
| --- | --- |
| Loop toggled off mid-playback | Next end-of-sequence stops normally |
| Loop toggled on while paused at the end | Space restarts from 0 (existing `togglePlay` behavior) |
| Empty timeline with non-zero duration | Loops as black; the gap branch advances by wall time |
| Zero-duration project | Already short-circuits to `stopPlayback(0, "Paused")` before the wrap check |
| Stop button / stop while looping | Returns to 0 and halts; loop does not restart playback |
| Last clip shorter than `PREFETCH_LEAD` (0.85s) | Standby not warm → cold-seek wrap (hitches, still loops) |

## Files touched

- `src/state/appState.svelte.ts` — `loopPlayback` field, `toggleLoopPlayback()`
- `src/lib/previewTime.ts` — `firstClipInSequence()`
- `src/lib/previewTime.test.ts` — tests for the above
- `src/lib/components/Preview.svelte` — loop-aware `schedulePrefetch`, wrap in `tick()`
- `src/lib/components/Transport.svelte` — loop button
- `src/routes/+page.svelte` — wiring, `L` shortcut, status hint
