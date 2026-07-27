<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Layers from "@lucide/svelte/icons/layers";
  import Plus from "@lucide/svelte/icons/plus";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import {
    addTrack,
    deleteClip,
    moveClip,
    splitClip,
    trimClipIn,
    trimClipOut,
  } from "$lib/clips";
  import {
    clipDuration,
    cloneProject,
    contentDuration,
    projectDuration,
    setProjectDuration,
  } from "$lib/project";
  import { clamp, formatTimestamp } from "$lib/time";
  import type { Project } from "$lib/types";
  import {
    app,
    basename,
    commitProject,
    project,
    setPlayhead,
    setTimelineDuration,
  } from "../../state/appState.svelte";

  const TRACK_H = 40;
  const RULER_H = 28;
  const EDGE_PX = 7;
  const DURATION_HANDLE_PX = 10;
  const MIN_PPS = 6;
  const MAX_PPS = 240;
  const DEFAULT_PPS = 48;

  let pxPerSecond = $state(DEFAULT_PPS);
  let scrollEl: HTMLDivElement | undefined = $state();
  let lanesEl: HTMLDivElement | undefined = $state();

  type DragKind = "move" | "trim-in" | "trim-out";

  let dragKind: DragKind | null = null;
  /** Reactive so `.dragging` class updates during pointer capture. */
  let dragClipId = $state<string | null>(null);
  let dragBefore: Project | null = null;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let startTimelineStart = 0;
  let startSourceIn = 0;
  let startSourceOut = 0;
  let startTrackId = "";
  let didMove = false;
  let pointerId: number | null = null;

  /** Ruler / playhead / empty-lane scrub (separate from clip drag). */
  let scrubbing = $state(false);
  let scrubPointerId: number | null = null;

  /** Sequence-length handle at the right of the timeline. */
  let resizingDuration = $state(false);
  let durationPointerId: number | null = null;
  let durationDragBefore: Project | null = null;

  /** Bound to the length number field (seconds). */
  let durationInput = $state(10);

  const p = $derived(project());
  const seqDuration = $derived(projectDuration(p));
  const contentEnd = $derived(contentDuration(p));
  /** Timeline content ends exactly at sequence length (no dead overflow). */
  const endTime = $derived(Math.max(seqDuration, 1));
  /** Only a few px past the end so the duration grip isn’t clipped by the scroller. */
  const contentWidth = $derived(Math.ceil(endTime * pxPerSecond) + DURATION_HANDLE_PX);
  /** Highest priority (last array index) at top of UI. */
  const displayTracks = $derived([...p.tracks].reverse());
  const clipCount = $derived(p.tracks.reduce((n, t) => n + t.clips.length, 0));

  $effect(() => {
    // Keep the number field in sync when duration changes elsewhere
    if (!resizingDuration) {
      durationInput = Math.round(seqDuration * 100) / 100;
    }
  });

  function tickStep(pps: number): number {
    if (pps >= 100) return 0.5;
    if (pps >= 40) return 1;
    if (pps >= 20) return 2;
    if (pps >= 10) return 5;
    return 10;
  }

  const ticks = $derived.by(() => {
    const step = tickStep(pxPerSecond);
    const out: number[] = [];
    for (let t = 0; t <= endTime + 1e-9; t += step) {
      out.push(Math.round(t * 1000) / 1000);
    }
    return out;
  });

  function setPresentLive(next: Project) {
    app.history = { ...app.history, present: next };
    app.dirty = true;
  }

  function trackIdAtClientY(clientY: number): string | null {
    if (!lanesEl) return null;
    const rows = lanesEl.querySelectorAll<HTMLElement>("[data-track-id]");
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) {
        return row.dataset.trackId ?? null;
      }
    }
    if (rows.length === 0) return null;
    const first = rows[0].getBoundingClientRect();
    const last = rows[rows.length - 1].getBoundingClientRect();
    if (clientY < first.top) return rows[0].dataset.trackId ?? null;
    if (clientY >= last.bottom) return rows[rows.length - 1].dataset.trackId ?? null;
    return null;
  }

  function clientXToTime(clientX: number): number {
    if (!scrollEl) return 0;
    const rect = scrollEl.getBoundingClientRect();
    const x = clientX - rect.left + scrollEl.scrollLeft;
    return Math.max(0, x / pxPerSecond);
  }

  function seekFromClientX(clientX: number) {
    // Clamp scrub to the sequence length (blue handle).
    setPlayhead(Math.min(clientXToTime(clientX), projectDuration(project())));
  }

  function selectClip(clipId: string, trackId: string) {
    app.selectedClipId = clipId;
    app.selectedTrackId = trackId;
  }

  function selectTrack(trackId: string) {
    app.selectedTrackId = trackId;
  }

  function detachDragListeners() {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
  }

  function attachDragListeners() {
    // Window-level listeners survive clip reparent (Svelte destroy of old node).
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
  }

  function clearDragState() {
    dragKind = null;
    dragClipId = null;
    dragBefore = null;
    pointerId = null;
    didMove = false;
  }

  function detachScrubListeners() {
    window.removeEventListener("pointermove", onScrubPointerMove);
    window.removeEventListener("pointerup", onScrubPointerUp);
    window.removeEventListener("pointercancel", onScrubPointerUp);
  }

  function endScrub() {
    scrubbing = false;
    scrubPointerId = null;
    detachScrubListeners();
  }

  function startScrub(e: PointerEvent) {
    if (e.button !== 0) return;
    // Don't fight an active clip drag or duration resize
    if (dragKind || resizingDuration) return;
    // Restart if already scrubbing (e.g. second finger)
    if (scrubbing) endScrub();

    e.preventDefault();
    scrubbing = true;
    scrubPointerId = e.pointerId;
    // Pause so rAF doesn't fight the scrub
    app.playing = false;
    seekFromClientX(e.clientX);

    window.addEventListener("pointermove", onScrubPointerMove);
    window.addEventListener("pointerup", onScrubPointerUp);
    window.addEventListener("pointercancel", onScrubPointerUp);
  }

  function endDurationResize() {
    resizingDuration = false;
    durationPointerId = null;
    window.removeEventListener("pointermove", onDurationPointerMove);
    window.removeEventListener("pointerup", onDurationPointerUp);
    window.removeEventListener("pointercancel", onDurationPointerUp);
  }

  function startDurationResize(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (scrubbing) endScrub();
    if (dragKind) {
      detachDragListeners();
      clearDragState();
    }
    if (resizingDuration) endDurationResize();

    try {
      durationDragBefore = cloneProject(project());
    } catch {
      durationDragBefore = null;
    }
    resizingDuration = true;
    durationPointerId = e.pointerId;
    app.playing = false;

    // Apply immediately so a click still sets length to this edge
    const t = clientXToTime(e.clientX);
    setPresentLive(setProjectDuration(project(), t));
    durationInput = Math.round(projectDuration(project()) * 100) / 100;

    window.addEventListener("pointermove", onDurationPointerMove);
    window.addEventListener("pointerup", onDurationPointerUp);
    window.addEventListener("pointercancel", onDurationPointerUp);
  }

  function onDurationPointerMove(e: PointerEvent) {
    if (!resizingDuration) return;
    if (durationPointerId !== null && e.pointerId !== durationPointerId) return;
    const t = clientXToTime(e.clientX);
    setPresentLive(setProjectDuration(project(), t));
    durationInput = Math.round(projectDuration(project()) * 100) / 100;
  }

  function onDurationPointerUp(e: PointerEvent) {
    if (durationPointerId !== null && e.pointerId !== durationPointerId) return;
    const before = durationDragBefore;
    const after = project();
    durationDragBefore = null;
    endDurationResize();

    // Live path only rewrote present — one undo entry from the pre-drag snapshot.
    if (before) {
      app.history = {
        past: [...app.history.past, before].slice(-50),
        present: after,
        future: [],
      };
    }
    app.dirty = true;
    app.status = `Timeline ${projectDuration(after).toFixed(2)}s`;
    if (app.playhead > projectDuration(after)) {
      app.playhead = projectDuration(after);
    }
  }

  function applyDurationInput() {
    const secs = Number(durationInput);
    if (!Number.isFinite(secs)) {
      durationInput = Math.round(seqDuration * 100) / 100;
      return;
    }
    setTimelineDuration(secs);
    durationInput = Math.round(projectDuration(project()) * 100) / 100;
  }

  function onDurationKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      applyDurationInput();
      (e.target as HTMLElement).blur();
    }
  }

  function onScrubPointerMove(e: PointerEvent) {
    if (!scrubbing) return;
    if (scrubPointerId !== null && e.pointerId !== scrubPointerId) return;
    seekFromClientX(e.clientX);
  }

  function onScrubPointerUp(e: PointerEvent) {
    if (scrubPointerId !== null && e.pointerId !== scrubPointerId) return;
    endScrub();
  }

  function onRulerPointerDown(e: PointerEvent) {
    startScrub(e);
  }

  function onPlayheadPointerDown(e: PointerEvent) {
    e.stopPropagation();
    startScrub(e);
  }

  function onLaneBackgroundPointerDown(e: PointerEvent, trackId: string) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".clip")) return;
    if ((e.target as HTMLElement).closest(".playhead")) return;
    selectTrack(trackId);
    app.selectedClipId = null;
    startScrub(e);
  }

  function onClipPointerDown(
    e: PointerEvent,
    clipId: string,
    trackId: string,
    forceEdge?: "in" | "out",
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // End any prior drag cleanly before starting another
    if (scrubbing) endScrub();
    if (dragKind) {
      detachDragListeners();
      clearDragState();
    }

    const target = e.target as HTMLElement;
    const edge =
      forceEdge ?? (target.closest("[data-edge]") as HTMLElement | null)?.dataset.edge as
        | "in"
        | "out"
        | undefined;
    const foundClip = p.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!foundClip) return;

    selectClip(clipId, trackId);

    let snapshot: Project;
    try {
      // Must not use structuredClone on $state proxies — it throws and leaves drag stuck.
      snapshot = cloneProject(project());
    } catch (err) {
      app.status = `Drag failed: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    dragKind = edge === "in" ? "trim-in" : edge === "out" ? "trim-out" : "move";
    dragClipId = clipId;
    dragBefore = snapshot;
    dragOriginX = e.clientX;
    dragOriginY = e.clientY;
    startTimelineStart = foundClip.timelineStart;
    startSourceIn = foundClip.sourceIn;
    startSourceOut = foundClip.sourceOut;
    startTrackId = trackId;
    didMove = false;
    pointerId = e.pointerId;

    attachDragListeners();
  }

  function onWindowPointerMove(e: PointerEvent) {
    if (!dragKind || !dragClipId || !dragBefore) return;
    if (pointerId !== null && e.pointerId !== pointerId) return;

    const dx = e.clientX - dragOriginX;
    const dy = e.clientY - dragOriginY;
    if (!didMove && Math.hypot(dx, dy) < 3) return;
    didMove = true;

    const dt = dx / pxPerSecond;

    if (dragKind === "move") {
      const newStart = Math.max(0, startTimelineStart + dt);
      const toTrackId = trackIdAtClientY(e.clientY) ?? startTrackId;
      setPresentLive(moveClip(dragBefore, dragClipId, newStart, toTrackId));
      if (toTrackId) app.selectedTrackId = toTrackId;
      return;
    }

    if (dragKind === "trim-in") {
      setPresentLive(trimClipIn(dragBefore, dragClipId, startSourceIn + dt));
      return;
    }

    if (dragKind === "trim-out") {
      let newOut = startSourceOut + dt;
      const clip = dragBefore.tracks.flatMap((t) => t.clips).find((c) => c.id === dragClipId);
      if (clip) {
        const meta = app.metaByPath.get(clip.sourcePath);
        if (meta && Number.isFinite(meta.duration)) {
          newOut = Math.min(newOut, meta.duration);
        }
      }
      setPresentLive(trimClipOut(dragBefore, dragClipId, newOut));
    }
  }

  function finishDrag(e: PointerEvent) {
    if (!dragKind || !dragClipId || !dragBefore) return;
    if (pointerId !== null && e.pointerId !== pointerId) return;

    const before = dragBefore;
    const after = project();
    const kind = dragKind;
    const moved = didMove;

    detachDragListeners();
    clearDragState();

    if (!moved) {
      // Click only — present never mutated
      return;
    }

    // One undo entry: past ← before, present stays after
    app.history = {
      past: [...app.history.past, before].slice(-50),
      present: after,
      future: [],
    };
    app.dirty = true;
    app.status =
      kind === "move" ? "Moved clip" : kind === "trim-in" ? "Trimmed in" : "Trimmed out";
  }

  function onWindowPointerUp(e: PointerEvent) {
    finishDrag(e);
  }

  function onWindowPointerCancel(e: PointerEvent) {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    // Revert live edits if cancelled mid-drag
    if (dragBefore && didMove) {
      app.history = { ...app.history, present: dragBefore };
    }
    detachDragListeners();
    clearDragState();
  }

  function onAddTrack() {
    const next = addTrack(project());
    const newTrack = next.tracks[next.tracks.length - 1];
    commitProject(next);
    if (newTrack) {
      app.selectedTrackId = newTrack.id;
      app.selectedClipId = null;
    }
    app.status = `Added ${newTrack?.name ?? "track"}`;
  }

  function onZoomInput(e: Event) {
    pxPerSecond = clamp(Number((e.target as HTMLInputElement).value), MIN_PPS, MAX_PPS);
  }

  function onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    pxPerSecond = clamp(pxPerSecond * factor, MIN_PPS, MAX_PPS);
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    const tag = el?.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || !!el?.isContentEditable;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      const id = app.selectedClipId;
      if (!id) return;
      e.preventDefault();
      const next = deleteClip(project(), id);
      if (next === project()) return;
      commitProject(next);
      app.selectedClipId = null;
      app.status = "Deleted clip";
      return;
    }

    if (e.key === "s" || e.key === "S") {
      const id = app.selectedClipId;
      if (!id) return;
      e.preventDefault();
      const next = splitClip(project(), id, app.playhead);
      if (next === project()) {
        app.status = "Playhead not inside selected clip";
        return;
      }
      commitProject(next);
      app.status = "Split clip";
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", onKeyDown);
    detachDragListeners();
    endScrub();
    endDurationResize();
  });
</script>

<section class="timeline" aria-label="Timeline">
  <div class="timeline-head">
    <div class="head-left">
      <span class="title">
        <Layers size={15} strokeWidth={2} aria-hidden="true" />
        Timeline
      </span>
      <span class="muted">
        {p.tracks.length} track{p.tracks.length === 1 ? "" : "s"}
        · {clipCount} clip{clipCount === 1 ? "" : "s"}
        · top = highest priority
      </span>
      <label
        class="duration-field"
        title="Sequence length (cannot go shorter than last clip end: {formatTimestamp(contentEnd)})"
      >
        <span class="muted">Length</span>
        <input
          class="compact mono"
          type="number"
          min={contentEnd}
          step="0.1"
          bind:value={durationInput}
          onchange={applyDurationInput}
          onkeydown={onDurationKey}
          aria-label="Timeline length in seconds"
        />
        <span class="mono muted">s</span>
        <span class="mono duration-label">{formatTimestamp(seqDuration)}</span>
      </label>
    </div>
    <div class="head-right">
      <label class="zoom">
        <ZoomIn size={14} strokeWidth={2} class="zoom-icon" aria-hidden="true" />
        <span class="muted">Zoom</span>
        <input
          type="range"
          min={MIN_PPS}
          max={MAX_PPS}
          step="1"
          value={pxPerSecond}
          oninput={onZoomInput}
          aria-label="Timeline zoom pixels per second"
        />
        <span class="mono muted">{Math.round(pxPerSecond)} px/s</span>
      </label>
      <button type="button" class="ghost" onclick={onAddTrack}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        <span>Track</span>
      </button>
    </div>
  </div>

  <div class="timeline-body">
    <div class="labels" style:padding-top="{RULER_H}px">
      {#each displayTracks as track (track.id)}
        <div
          class="label-row"
          class:selected={track.id === app.selectedTrackId}
          style:height="{TRACK_H}px"
          role="button"
          tabindex="0"
          title="Select track {track.name}"
          onclick={() => selectTrack(track.id)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectTrack(track.id);
            }
          }}
        >
          {track.name}
        </div>
      {/each}
    </div>

    <div
      class="scroll"
      bind:this={scrollEl}
      onwheel={onWheel}
    >
      <div class="content" style:width="{contentWidth}px">
        <!-- Ruler (click + drag to scrub) -->
        <div
          class="ruler"
          class:scrubbing
          style:height="{RULER_H}px"
          role="slider"
          tabindex="0"
          aria-label="Timeline ruler — drag to scrub"
          aria-valuemin={0}
          aria-valuemax={endTime}
          aria-valuenow={app.playhead}
          aria-valuetext={formatTimestamp(app.playhead)}
          onpointerdown={onRulerPointerDown}
        >
          {#each ticks as t (t)}
            <div class="tick" style:left="{t * pxPerSecond}px">
              <span class="tick-label">{formatTimestamp(t)}</span>
            </div>
          {/each}
        </div>

        <!-- Tracks / clips -->
        <div class="lanes" bind:this={lanesEl} style:min-height="{displayTracks.length * TRACK_H}px">
          {#each displayTracks as track (track.id)}
            <div
              class="lane"
              class:selected={track.id === app.selectedTrackId}
              data-track-id={track.id}
              style:height="{TRACK_H}px"
              role="presentation"
              onpointerdown={(e) => onLaneBackgroundPointerDown(e, track.id)}
            >
              {#each track.clips as clip (clip.id)}
                {@const dur = clipDuration(clip)}
                {@const left = clip.timelineStart * pxPerSecond}
                {@const width = Math.max(dur * pxPerSecond, 4)}
                <div
                  class="clip"
                  class:active={clip.id === app.selectedClipId}
                  class:dragging={dragClipId === clip.id}
                  style:left="{left}px"
                  style:width="{width}px"
                  title={clip.sourcePath}
                  role="button"
                  tabindex="0"
                  onpointerdown={(e) => onClipPointerDown(e, clip.id, track.id)}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      selectClip(clip.id, track.id);
                    }
                  }}
                >
                  <span
                    class="edge in"
                    data-edge="in"
                    style:width="{EDGE_PX}px"
                    aria-hidden="true"
                    onpointerdown={(e) => onClipPointerDown(e, clip.id, track.id, "in")}
                  ></span>
                  <span class="clip-label">{basename(clip.sourcePath)}</span>
                  <span
                    class="edge out"
                    data-edge="out"
                    style:width="{EDGE_PX}px"
                    aria-hidden="true"
                    onpointerdown={(e) => onClipPointerDown(e, clip.id, track.id, "out")}
                  ></span>
                </div>
              {/each}
            </div>
          {/each}
        </div>

        <!-- Playhead (drag to scrub) -->
        <div
          class="playhead"
          class:scrubbing
          style:left="{app.playhead * pxPerSecond}px"
          style:height="{RULER_H + displayTracks.length * TRACK_H}px"
          role="slider"
          tabindex="0"
          aria-label="Playhead — drag to scrub"
          aria-valuemin={0}
          aria-valuemax={endTime}
          aria-valuenow={app.playhead}
          aria-valuetext={formatTimestamp(app.playhead)}
          onpointerdown={onPlayheadPointerDown}
          onkeydown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const step = e.shiftKey ? 1 : 0.1;
              const delta = e.key === "ArrowLeft" ? -step : step;
              setPlayhead(Math.max(0, app.playhead + delta));
              app.playing = false;
            }
          }}
        >
          <div class="playhead-hit" aria-hidden="true"></div>
          <div class="playhead-head" aria-hidden="true"></div>
        </div>

        <!-- Sequence end handle — drag to set global timeline length -->
        <div
          class="duration-handle"
          class:active={resizingDuration}
          style:left="{seqDuration * pxPerSecond}px"
          style:height="{RULER_H + displayTracks.length * TRACK_H}px"
          style:width="{DURATION_HANDLE_PX}px"
          role="slider"
          tabindex="0"
          aria-label="Sequence length — drag to adjust"
          aria-valuemin={contentEnd}
          aria-valuemax={Math.max(contentEnd + 3600, seqDuration)}
          aria-valuenow={seqDuration}
          aria-valuetext="{formatTimestamp(seqDuration)} ({seqDuration.toFixed(2)}s)"
          title="Sequence length {formatTimestamp(seqDuration)} — drag to extend or shrink (min = last clip)"
          onpointerdown={startDurationResize}
          onkeydown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const step = e.shiftKey ? 1 : 0.1;
              const delta = e.key === "ArrowLeft" ? -step : step;
              setTimelineDuration(seqDuration + delta);
            }
          }}
        >
          <div class="duration-handle-bar" aria-hidden="true"></div>
          <div class="duration-handle-grip" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .timeline {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.45rem 0.55rem 0.55rem;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
    box-sizing: border-box;
  }

  .timeline-head {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
  }

  .head-left,
  .head-right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
  }

  .title {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .zoom {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  .zoom :global(.zoom-icon) {
    flex-shrink: 0;
    opacity: 0.75;
  }

  .zoom input[type="range"] {
    width: 7rem;
    accent-color: var(--accent);
  }

  .head-right :global(button) {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .duration-field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-left: 0.35rem;
    font-size: 0.85rem;
  }

  .duration-field input {
    width: 4.25rem;
  }

  .duration-label {
    color: var(--text);
    min-width: 3.2rem;
  }

  .timeline-body {
    flex: 1 1 auto;
    display: flex;
    align-items: flex-start;
    min-height: 0;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    /* Vertical scroll when many tracks; horizontal stays in .scroll */
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--bg);
  }

  .labels {
    flex: 0 0 auto;
    width: 52px;
    border-right: 1px solid var(--border);
    background: var(--surface);
    z-index: 2;
    position: sticky;
    left: 0;
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    user-select: none;
  }

  .label-row:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .label-row.selected {
    color: var(--accent);
    background: rgba(91, 140, 255, 0.1);
  }

  .scroll {
    flex: 1 1 auto;
    min-width: 0;
    /* Horizontal scrub/zoom only; vertical is on .timeline-body */
    overflow-x: auto;
    overflow-y: hidden;
    position: relative;
  }

  .content {
    position: relative;
    min-height: 100%;
    /* Own stacking root so playhead / duration stay above lanes + clips */
    isolation: isolate;
  }

  .ruler {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }

  .ruler.scrubbing {
    cursor: grabbing;
  }

  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid var(--border);
    pointer-events: none;
  }

  .tick-label {
    position: absolute;
    top: 4px;
    left: 4px;
    font-size: 0.7rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--muted);
    white-space: nowrap;
  }

  .lanes {
    position: relative;
    z-index: 1;
  }

  .lane {
    position: relative;
    z-index: 1;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .lane.selected {
    background: rgba(91, 140, 255, 0.04);
  }

  .clip {
    position: absolute;
    top: 4px;
    bottom: 4px;
    display: flex;
    align-items: center;
    background: rgba(91, 140, 255, 0.28);
    border: 1px solid rgba(91, 140, 255, 0.55);
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    touch-action: none;
    min-width: 4px;
    box-sizing: border-box;
    z-index: 1;
  }

  .clip:hover {
    background: rgba(91, 140, 255, 0.38);
  }

  .clip.active {
    border-color: var(--accent);
    background: rgba(91, 140, 255, 0.48);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .clip.dragging {
    cursor: grabbing;
    opacity: 0.92;
    z-index: 2;
  }

  .clip-label {
    flex: 1;
    min-width: 0;
    padding: 0 0.35rem;
    font-size: 0.75rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  .edge {
    flex: 0 0 auto;
    align-self: stretch;
    cursor: ew-resize;
    background: transparent;
    z-index: 2;
    touch-action: none;
  }

  .edge:hover,
  .edge:active {
    background: rgba(255, 255, 255, 0.18);
  }

  /*
   * Overlay markers must sit above sticky ruler (5) and lanes/clips (1).
   * Use a solid 2px element (not border-on-width-0) so the line doesn’t drop out
   * under sticky compositing / subpixel rounding.
   */
  .playhead {
    position: absolute;
    top: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--danger);
    z-index: 30;
    cursor: ew-resize;
    touch-action: none;
    outline: none;
    pointer-events: none;
  }

  .playhead.scrubbing {
    cursor: grabbing;
  }

  .playhead:focus-visible .playhead-hit {
    background: rgba(240, 113, 120, 0.18);
  }

  /* Wide invisible hit target for easier grab (only interactive part) */
  .playhead-hit {
    position: absolute;
    top: 0;
    left: -5px;
    width: 12px;
    height: 100%;
    background: transparent;
    pointer-events: auto;
  }

  .playhead-head {
    position: absolute;
    top: 0;
    left: -4px;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 8px solid var(--danger);
    pointer-events: none;
    z-index: 1;
  }

  .duration-handle {
    position: absolute;
    top: 0;
    z-index: 31;
    margin-left: -5px;
    cursor: ew-resize;
    touch-action: none;
    outline: none;
  }

  .duration-handle.active .duration-handle-bar,
  .duration-handle:hover .duration-handle-bar {
    background: var(--accent);
  }

  .duration-handle-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 2px;
    background: var(--accent);
    pointer-events: none;
  }

  .duration-handle-grip {
    position: absolute;
    top: 2px;
    left: 0;
    width: 10px;
    height: 14px;
    border-radius: 2px;
    background: var(--accent);
    border: 1px solid rgba(255, 255, 255, 0.35);
    pointer-events: none;
    z-index: 1;
  }

  .duration-handle:focus-visible .duration-handle-grip {
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  }
</style>
