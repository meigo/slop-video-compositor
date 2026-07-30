# Loop Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-only loop toggle so preview playback wraps to 0 at the end of the sequence instead of stopping.

**Architecture:** The loop point is treated as another hard cut. `Preview.svelte` already runs two `<video>` decoders — an active one that free-runs and a standby one prefetched with the next clip — so the wrap reuses that machinery: near the end of the last clip, standby is warmed with the sequence's *first* clip, and the wrap swaps to it. When standby is not warm the wrap falls back to a cold load+seek, which still loops but hitches.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes (`$state`/`$derived`/`$effect`), TypeScript, Vitest, Tauri 2, `@lucide/svelte` icons.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-loop-playback-design.md`.
- Loop state is **session-only**: no changes to the project JSON schema (`src/lib/project.ts`, `parseProject`/`serializeProject`) and no changes to `AppSettings` or the Rust settings struct.
- Loop scope is the **whole sequence** (0 → `projectDuration(project())` → 0). No in/out range, no loop-selected-clip, no ping-pong.
- Loop is **off by default**.
- Follow the surrounding style: 2-space indent, double-quoted strings, `$lib/...` and `../../state/appState.svelte` import paths, `// comment` sentences that explain *why*.
- Test command is `npm test` (Vitest, run mode). Type check is `npm run check`.
- Do not reformat or "improve" code adjacent to the edits.

---

### Task 1: `firstClipInSequence` helper

Pure function that finds the clip the sequence starts on, so the wrap knows what to prefetch. Mirrors the structure of the existing `nextClipAfter` in the same file.

**Files:**
- Modify: `src/lib/previewTime.ts` (append after `nextClipAfter`, which ends at line 51)
- Test: `src/lib/previewTime.test.ts`

**Interfaces:**
- Consumes: `clipAtTime` from `./resolve` and `projectDuration` from `./project` — both are already imported at the top of `previewTime.ts`.
- Produces: `export function firstClipInSequence(project: Project): Clip | null` — used by Task 3 in `Preview.svelte`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/previewTime.test.ts`. The file already has a `clip(over)` factory and imports `createProject`; add `firstClipInSequence` to the existing import block from `./previewTime`.

```ts
describe("firstClipInSequence", () => {
  it("returns null for an empty project", () => {
    expect(firstClipInSequence(createProject())).toBeNull();
  });

  it("returns the clip at time 0", () => {
    const p = createProject();
    const a = clip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 2 });
    p.tracks[0].clips.push(a);
    expect(firstClipInSequence(p)?.id).toBe("a");
  });

  it("skips a leading black gap", () => {
    const p = createProject();
    const a = clip({ id: "a", timelineStart: 3, sourceIn: 0, sourceOut: 2 });
    p.tracks[0].clips.push(a);
    expect(firstClipInSequence(p)?.id).toBe("a");
  });

  it("prefers the higher track when both cover the start", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "lo", timelineStart: 0, sourceIn: 0, sourceOut: 4 }));
    p.tracks[1].clips.push(clip({ id: "hi", timelineStart: 0, sourceIn: 0, sourceOut: 4 }));
    expect(firstClipInSequence(p)?.id).toBe("hi");
  });

  it("returns the earliest clip when clips start at different times", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "late", timelineStart: 5, sourceIn: 0, sourceOut: 2 }));
    p.tracks[0].clips.push(clip({ id: "early", timelineStart: 1, sourceIn: 0, sourceOut: 2 }));
    expect(firstClipInSequence(p)?.id).toBe("early");
  });
});
```

Note: `createProject()` returns two tracks (`V1`, `V2`) with `duration: 10`, so `projectDuration` is 10 in every case above. `p.tracks[1]` is the higher track — `clipAtTime` iterates tracks from the end, so it wins.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- previewTime`
Expected: FAIL — the import of `firstClipInSequence` is undefined, so every case in the new describe block errors.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/previewTime.ts`:

```ts
/**
 * First hard-cut clip in the sequence (skips a leading black gap).
 * Pure helper for loop wrap-around prefetch; null when the timeline has no media.
 */
export function firstClipInSequence(project: Project): Clip | null {
  const total = projectDuration(project);
  const candidates = new Set<number>([0]);
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (c.timelineStart >= 0 && c.timelineStart < total) {
        candidates.add(c.timelineStart);
      }
    }
  }

  const sorted = [...candidates].sort((a, b) => a - b);
  for (const t of sorted) {
    const hit = clipAtTime(project, t);
    if (hit) return hit.clip;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- previewTime`
Expected: PASS — all describe blocks in `previewTime.test.ts`, including the five new cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/previewTime.ts src/lib/previewTime.test.ts
git commit -m "feat: add firstClipInSequence helper for loop wrap"
```

---

### Task 2: Loop state and UI toggle

Adds the state field, the toggle action, the Transport button, the `L` shortcut, and the status hint. After this task the button and key toggle a flag and update the status line; playback behavior is unchanged (Task 3 makes it loop).

**Files:**
- Modify: `src/state/appState.svelte.ts` (the `app = $state({...})` object around line 91-97; new action near `setPlayhead`, line 620)
- Modify: `src/lib/components/Transport.svelte` (whole file — imports, `Props`, markup, styles)
- Modify: `src/routes/+page.svelte` (import block line 9-52, `statusHint` line 68-70, `onKeyDown` after the `m` handler at line 184-188, `<Transport>` usage line 292-303)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `app.loopPlayback: boolean` — read by Task 3 in `Preview.svelte`.
  - `export function toggleLoopPlayback(): void` in `src/state/appState.svelte.ts`.
  - `Transport` props gain `loop: boolean` and `onToggleLoop: () => void`.

- [ ] **Step 1: Add the state field**

In `src/state/appState.svelte.ts`, inside the `app = $state({...})` object, directly after the `previewSoloTrackId` field (which ends with `previewSoloTrackId: null as string | null,`):

```ts
  /** Preview-only: when true, playback wraps to 0 instead of stopping at the end. */
  loopPlayback: false,
```

- [ ] **Step 2: Add the toggle action**

In the same file, directly after `export function setPlayhead(t: number) {...}`:

```ts
export function toggleLoopPlayback() {
  app.loopPlayback = !app.loopPlayback;
  app.status = app.loopPlayback ? "Loop on" : "Loop off";
}
```

- [ ] **Step 3: Add the loop button to Transport**

In `src/lib/components/Transport.svelte`:

Add the icon import, keeping the existing alphabetical-ish grouping (after the `Play` import):

```ts
  import Repeat from "@lucide/svelte/icons/repeat";
```

Extend the `Props` interface (after `muted: boolean;`):

```ts
    loop: boolean;
```

and (after `onStop: () => void;`):

```ts
    onToggleLoop: () => void;
```

Add both to the `$props()` destructuring — `loop` after `muted`, `onToggleLoop` after `onStop`.

Insert this button in the markup between the Stop button and the Mute button:

```svelte
  <button
    type="button"
    class="ghost"
    class:on={loop}
    onclick={onToggleLoop}
    title={loop ? "Loop playback: on (L)" : "Loop playback: off (L)"}
    aria-label="Loop playback"
    aria-pressed={loop}
  >
    <Repeat size={ICON} strokeWidth={2} aria-hidden="true" />
  </button>
```

Add to the `<style>` block, after the `.transport :global(button)` rule:

```css
  /* Ghost buttons are already --text; an active toggle reads as accent. */
  .transport :global(button.on) {
    color: var(--accent);
    border-color: var(--accent);
  }
```

- [ ] **Step 4: Wire it up in the page**

In `src/routes/+page.svelte`:

Add `toggleLoopPlayback,` to the import block from `../state/appState.svelte` (alphabetically it belongs between `stepPlayheadSeconds,` and `undo,`).

Pass the props on the `<Transport>` element — add after `muted={app.previewMuted}`:

```svelte
        loop={app.loopPlayback}
```

and after `onStop={stop}`:

```svelte
        onToggleLoop={toggleLoopPlayback}
```

Add the shortcut in `onKeyDown`, directly after the `m` marker handler block:

```ts
    if (event.key.toLowerCase() === "l" && !mod) {
      event.preventDefault();
      toggleLoopPlayback();
      return;
    }
```

Update the playing branch of `statusHint`:

```ts
    if (app.playing) {
      return "Space pause · [ ] cuts · L loop";
    }
```

- [ ] **Step 5: Type check and test**

Run: `npm run check && npm test`
Expected: no TypeScript/Svelte errors; all existing tests pass (this task adds no tests — it is UI wiring with no pure logic).

- [ ] **Step 6: Manually verify the toggle**

Run: `npm run tauri dev`
Check: the Transport row shows a repeat icon between Stop and the speaker icon. Clicking it turns it blue and the status line reads `Loop on`; clicking again returns it to grey and reads `Loop off`. Pressing `L` with focus on the app body does the same. Typing `l` inside the Inspector's text/number fields does **not** toggle it (the existing input guard at the top of `onKeyDown` handles this). Playback still stops at the end — Task 3 changes that.

- [ ] **Step 7: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/components/Transport.svelte src/routes/+page.svelte
git commit -m "feat: add loop playback toggle (button, L shortcut, status hint)"
```

---

### Task 3: Wrap playback at the end of the sequence

Makes the toggle do its work: prefetch the first clip near the end, and wrap instead of stopping.

**Files:**
- Modify: `src/lib/components/Preview.svelte` — import block (lines 5-11), `schedulePrefetch` (lines 406-427), `tick` (the end-of-sequence check at lines 602-605), plus one new function

**Interfaces:**
- Consumes: `firstClipInSequence` (Task 1), `app.loopPlayback` (Task 2). Also the file's existing internals: `swapToStandby(clip): boolean`, `standbySlot()`, `prefetchClipId`, `prefetchGen`, `playingClipId`, `slots`, `applyAudioState()`, `paint()`, and the `setPlayhead` / `app` imports already present.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the helper**

In `src/lib/components/Preview.svelte`, add `firstClipInSequence,` to the existing named import from `$lib/previewTime` (the list is alphabetical: it goes after `clipTimelineEnd,`).

- [ ] **Step 2: Make prefetch loop-aware**

Replace the opening of `schedulePrefetch`:

```ts
  function schedulePrefetch(fromClip: Clip) {
    const proj = previewProject();
    const next = nextClipAfter(proj, fromClip);
    if (!next) {
      prefetchClipId = null;
      return;
    }
```

with:

```ts
  function schedulePrefetch(fromClip: Clip) {
    const proj = previewProject();
    // With loop on, the sequence's first clip follows the last one — warm it like any cut.
    const next = nextClipAfter(proj, fromClip) ?? (app.loopPlayback ? firstClipInSequence(proj) : null);
    if (!next) {
      prefetchClipId = null;
      return;
    }
```

The rest of the function is unchanged. Note this is correct for a single-clip sequence too: `firstClipInSequence` returns the clip that is already playing, so standby loads the same file seeked to `sourceIn`, and `swapToStandby` accepts it on the next wrap.

- [ ] **Step 3: Add the wrap function**

Add directly above `function tick(now: number) {`:

```ts
  /**
   * Loop wrap: restart at 0. Prefer the prefetched standby so the loop point behaves
   * like any other hard cut; otherwise fall back to a cold start on the next tick.
   */
  function wrapToStart() {
    setPlayhead(0);
    const hit = clipAtTime(previewProject(), 0);
    if (hit && swapToStandby(hit.clip)) return;

    playingClipId = null;
    for (const s of slots) {
      s.el?.pause();
    }
    applyAudioState();
    paint();
  }
```

- [ ] **Step 4: Wrap instead of stopping**

In `tick`, replace the end-of-sequence check:

```ts
    if (t >= totalDur - 1e-6) {
      stopPlayback(totalDur, "Paused");
      return;
    }
```

with:

```ts
    if (t >= totalDur - 1e-6) {
      if (!app.loopPlayback) {
        stopPlayback(totalDur, "Paused");
        return;
      }
      wrapToStart();
      rafId = requestAnimationFrame(tick);
      return;
    }
```

`wrapToStart` calls `setPlayhead(0)` itself, so the `setPlayhead(t)` line below it must not run — hence the early `return` after re-arming the frame. `lastRafMs` is deliberately left as-is: it was set at the top of this tick, so the next frame's `wallDt` stays correct.

- [ ] **Step 5: Type check and test**

Run: `npm run check && npm test`
Expected: no TypeScript/Svelte errors; all tests pass.

- [ ] **Step 6: Manually verify looping**

Run: `npm run tauri dev`

Import two clips (⌘I, append placement) so the timeline has a cut, then:

1. Loop **off**, press Space → playback stops at the end, status reads `Paused`. (Regression check.)
2. Loop **on** (click the repeat button or press `L`), press Space → at the end the playhead jumps to 0 and playback continues without stopping. The loop point should look like the mid-sequence cut, not a black flash.
3. While looping, press `L` → the current cycle finishes and playback stops at the end.
4. While looping, press Stop → playhead returns to 0 and playback halts (does not restart).
5. Delete all clips but leave the sequence duration non-zero, loop on, press Space → the playhead sweeps 0 → end → 0 over black, repeatedly.
6. Single clip on the timeline, loop on → it repeats seamlessly.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/Preview.svelte
git commit -m "feat: wrap preview playback to start when loop is on"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| State field + `toggleLoopPlayback` | Task 2, steps 1-2 |
| Loop-aware `schedulePrefetch` | Task 3, step 2 |
| Wrap in `tick()` | Task 3, steps 3-4 |
| `firstClipInSequence` | Task 1 |
| Transport button | Task 2, step 3 |
| `L` shortcut | Task 2, step 4 |
| Status hint | Task 2, step 4 |
| Unit tests for the helper | Task 1, step 1 |
| Manual verification of the wrap | Task 3, step 6 |
| Edge-case table | Task 3, step 6 covers cases 1-6; the zero-duration case is guarded by existing code above the wrap check |

**Placeholder scan:** none — every step has the literal code or command to run.

**Type consistency:** `firstClipInSequence(project: Project): Clip | null` is defined in Task 1 and called in Task 3 with `previewProject()` (returns `Project`) — matches. `app.loopPlayback` (Task 2) is read in Task 3 by the same name. `swapToStandby(clip: Clip): boolean` and `clipAtTime(project, t)` returning `{ trackId, clip } | null` are pre-existing signatures used correctly in `wrapToStart`.
