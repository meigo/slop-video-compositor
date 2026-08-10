<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Layers from "@lucide/svelte/icons/layers";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Plus from "@lucide/svelte/icons/plus";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import {
    addTrack,
    moveClip,
    moveClipsByDelta,
    splitClip,
    trimClipIn,
    trimClipOut,
  } from "$lib/clips";
  import { clipColorCssVars } from "$lib/clipColor";
  import {
    clipDuration,
    cloneProject,
    contentDuration,
    projectDuration,
    setProjectDuration,
  } from "$lib/project";
  import {
    collectSnapTimes,
    DEFAULT_SNAP_THRESHOLD,
    snapClipStart,
    snapTime,
  } from "$lib/snap";
  import { clamp, formatTimestamp } from "$lib/time";
  import type { Project } from "$lib/types";
  import {
    app,
    basename,
    clearClipSelection,
    commitProject,
    commitProjectEdit,
    deleteMarker,
    deleteSelectedClips,
    isClipSelected,
    project,
    selectClipOnly,
    setPlayhead,
    setPresentLive,
    setTimelineDuration,
    stepPlayheadFrames,
    stepPlayheadSeconds,
    toggleClipInSelection,
    toggleSoloTrack,
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

  let dragKind = $state<DragKind | null>(null);
  /** Reactive so `.dragging` class updates during pointer capture. */
  let dragClipId = $state<string | null>(null);
  /** Ids moved together (includes dragClipId). */
  let dragGroupIds = $state<string[]>([]);
  let dragBefore: Project | null = null;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let startTimelineStart = 0;
  let startSourceIn = 0;
  let startSourceOut = 0;
  let startTrackId = "";
  let didMove = $state(false);
  let pointerId: number | null = null;

  /** Ruler / playhead / empty-lane scrub (separate from clip drag). */
  let scrubbing = $state(false);
  let scrubPointerId: number | null = null;

  /** Sequence-length handle at the right of the timeline. */
  let resizingDuration = $state(false);
  let durationPointerId: number | null = null;
  let durationDragBefore: Project | null = null;
  /**
   * Rubber-band preview while dragging the program-out handle.
   * Destructive trim is applied only on release (from the pre-drag snapshot).
   */
  let durationPreview: number | null = $state(null);

  /** Bound to the length number field (seconds). */
  let durationInput = $state(10);

  const p = $derived(project());
  const seqDuration = $derived(projectDuration(p));
  const contentEnd = $derived(contentDuration(p));
  /** Handle / field / width while resizing use the live preview time. */
  const displayDuration = $derived(durationPreview ?? seqDuration);
  /** Timeline content ends exactly at sequence length (no dead overflow). */
  const endTime = $derived(Math.max(displayDuration, 1));
  /** Only a few px past the end so the duration grip isn’t clipped by the scroller. */
  const contentWidth = $derived(Math.ceil(endTime * pxPerSecond) + DURATION_HANDLE_PX);
  /** Highest priority (last array index) at top of UI. */
  const displayTracks = $derived([...p.tracks].reverse());
  const clipCount = $derived(p.tracks.reduce((n, t) => n + t.clips.length, 0));

  $effect(() => {
    // Keep the number field in sync when duration changes elsewhere
    if (!resizingDuration) {
      durationInput = Math.round(seqDuration * 100) / 100;
    } else if (durationPreview != null) {
      durationInput = Math.round(durationPreview * 100) / 100;
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
    dragGroupIds = [];
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
    durationPreview = null;
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

    // Rubber-band only during drag — trim applied on release so left/right scrub is safe.
    const t = Math.max(0, clientXToTime(e.clientX));
    durationPreview = t;
    durationInput = Math.round(t * 100) / 100;

    window.addEventListener("pointermove", onDurationPointerMove);
    window.addEventListener("pointerup", onDurationPointerUp);
    window.addEventListener("pointercancel", onDurationPointerUp);
  }

  function onDurationPointerMove(e: PointerEvent) {
    if (!resizingDuration) return;
    if (durationPointerId !== null && e.pointerId !== durationPointerId) return;
    const t = Math.max(0, clientXToTime(e.clientX));
    durationPreview = t;
    durationInput = Math.round(t * 100) / 100;
  }

  function onDurationPointerUp(e: PointerEvent) {
    if (durationPointerId !== null && e.pointerId !== durationPointerId) return;
    const before = durationDragBefore;
    const t = durationPreview ?? projectDuration(project());
    durationDragBefore = null;
    endDurationResize();

    // One undo entry: pre-drag snapshot → program out (trim if shorter than content).
    if (before) {
      const after = setProjectDuration(before, t);
      if (commitProjectEdit(before, after)) {
        app.status =
          t < contentDuration(before)
            ? `Sequence out ${projectDuration(after).toFixed(2)}s (trimmed)`
            : `Timeline ${projectDuration(after).toFixed(2)}s`;
      }
      if (app.playhead > projectDuration(project())) {
        app.playhead = projectDuration(project());
      }
    } else {
      setTimelineDuration(t);
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
    clearClipSelection();
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

    const additive = e.metaKey || e.ctrlKey;
    if (additive) {
      toggleClipInSelection(clipId, trackId);
      // Additive click only — no drag (avoids fighting multi-toggle)
      return;
    }

    // If clicking an unselected clip, become sole selection; if already selected, keep multi-set.
    if (!isClipSelected(clipId)) {
      selectClipOnly(clipId, trackId);
    } else {
      // Ensure primary is the drag handle clip
      app.selectedClipId = clipId;
      app.selectedTrackId = trackId;
    }

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
    // Multi move only for body drag (not trim edges)
    dragGroupIds =
      dragKind === "move" && app.selectedClipIds.length > 1
        ? [...app.selectedClipIds]
        : [clipId];
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
    // Shift = free (no snap). Threshold scales slightly with zoom.
    const snapOn = !e.shiftKey;
    const thresh = Math.max(DEFAULT_SNAP_THRESHOLD, 8 / pxPerSecond);
    const before = dragBefore;
    const targets = snapOn
      ? collectSnapTimes(before, {
          excludeClipId: dragClipId,
          playhead: app.playhead,
        }).filter((t) => {
          // Also ignore edges of other group members
          if (dragGroupIds.length <= 1) return true;
          for (const id of dragGroupIds) {
            if (id === dragClipId) continue;
            const c = before.tracks.flatMap((tr) => tr.clips).find((x) => x.id === id);
            if (!c) continue;
            const end = c.timelineStart + (c.sourceOut - c.sourceIn);
            if (Math.abs(t - c.timelineStart) < 1e-9 || Math.abs(t - end) < 1e-9) return false;
          }
          return true;
        })
      : [];

    if (dragKind === "move") {
      let newStart = Math.max(0, startTimelineStart + dt);
      if (snapOn) {
        const dur = startSourceOut - startSourceIn;
        newStart = snapClipStart(newStart, dur, targets, thresh);
      }
      const delta = newStart - startTimelineStart;

      if (dragGroupIds.length > 1) {
        // Group: same Δt, no track change
        setPresentLive(moveClipsByDelta(before, dragGroupIds, delta));
        return;
      }

      const toTrackId = trackIdAtClientY(e.clientY) ?? startTrackId;
      setPresentLive(moveClip(before, dragClipId, newStart, toTrackId));
      if (toTrackId) app.selectedTrackId = toTrackId;
      return;
    }

    if (dragKind === "trim-in") {
      let newIn = startSourceIn + dt;
      if (snapOn) {
        // Map source-in change to timeline left edge and snap that edge.
        const rawStart = startTimelineStart + (newIn - startSourceIn);
        const snappedStart = snapTime(rawStart, targets, thresh);
        newIn = startSourceIn + (snappedStart - startTimelineStart);
      }
      setPresentLive(trimClipIn(before, dragClipId, newIn));
      return;
    }

    if (dragKind === "trim-out") {
      let newOut = startSourceOut + dt;
      const clip = before.tracks.flatMap((t) => t.clips).find((c) => c.id === dragClipId);
      if (clip) {
        const meta = app.metaByPath.get(clip.sourcePath);
        if (meta && Number.isFinite(meta.duration)) {
          newOut = Math.min(newOut, meta.duration);
        }
        if (snapOn) {
          const rawEnd = startTimelineStart + (newOut - startSourceIn);
          const snappedEnd = snapTime(rawEnd, targets, thresh);
          newOut = startSourceIn + (snappedEnd - startTimelineStart);
        }
      }
      setPresentLive(trimClipOut(before, dragClipId, newOut));
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

    if (!commitProjectEdit(before, after)) return;
    app.status =
      kind === "move"
        ? app.selectedClipIds.length > 1
          ? `Moved ${app.selectedClipIds.length} clips`
          : "Moved clip"
        : kind === "trim-in"
          ? "Trimmed in"
          : "Trimmed out";
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
      clearClipSelection();
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

  /** Fit full sequence width into the visible scroll area (100% / reset zoom). */
  function fitZoomToWidth() {
    if (!scrollEl) return;
    const available = Math.max(1, scrollEl.clientWidth - DURATION_HANDLE_PX - 2);
    const secs = Math.max(seqDuration, 1e-3);
    pxPerSecond = clamp(available / secs, MIN_PPS, MAX_PPS);
    scrollEl.scrollLeft = 0;
    app.status = `Zoom fit ${Math.round(pxPerSecond)} px/s`;
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
      if (app.selectedClipIds.length === 0 && !app.selectedClipId) return;
      e.preventDefault();
      deleteSelectedClips();
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
        title="Sequence end (program out). Values shorter than media trim clips past that time."
      >
        <span class="muted">Length</span>
        <input
          class="compact mono"
          type="number"
          min="0"
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
        <button
          type="button"
          class="ghost zoom-fit"
          onclick={fitZoomToWidth}
          title="Fit sequence to timeline width (100%)"
          aria-label="Fit sequence to timeline width"
        >
          <Maximize2 size={14} strokeWidth={2} aria-hidden="true" />
          <span>Fit</span>
        </button>
      </label>
      <button
        type="button"
        class="ghost"
        onclick={onAddTrack}
        title="Add video track"
        aria-label="Add track"
      >
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
          class:solo={app.previewSoloTrackId === track.id}
          style:height="{TRACK_H}px"
          role="button"
          tabindex="0"
          title="Click select · double-click solo (preview only)"
          onclick={() => selectTrack(track.id)}
          ondblclick={(e) => {
            e.preventDefault();
            toggleSoloTrack(track.id);
          }}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectTrack(track.id);
            }
          }}
        >
          <span class="track-name">{track.name}</span>
          {#if app.previewSoloTrackId === track.id}
            <span class="solo-badge" aria-label="Solo">S</span>
          {/if}
        </div>
      {/each}
    </div>

    <div
      class="scroll"
      bind:this={scrollEl}
      onwheel={onWheel}
    >
      <div class="content" style:width="{contentWidth}px">
        <div class="timeline-stack">
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
            {#each p.markers ?? [] as marker (marker.id)}
              <button
                type="button"
                class="marker"
                style:left="{marker.t * pxPerSecond}px"
                title="{marker.label} @ {formatTimestamp(marker.t)} — click seek, Alt+click remove"
                aria-label="Marker {marker.label}"
                onpointerdown={(e) => {
                  e.stopPropagation();
                  if (e.altKey) {
                    e.preventDefault();
                    deleteMarker(marker.id);
                    return;
                  }
                  setPlayhead(marker.t);
                  app.status = `Marker ${marker.label}`;
                }}
              >
                <span class="marker-flag" aria-hidden="true"></span>
                <span class="marker-label">{marker.label}</span>
              </button>
            {/each}
          </div>

          <!-- Tracks / clips -->
          <div class="lanes" bind:this={lanesEl} style:min-height="{displayTracks.length * TRACK_H}px">
            {#each displayTracks as track (track.id)}
              <div
                class="lane"
                class:selected={track.id === app.selectedTrackId}
                class:has-gaps={track.clips.length > 0}
                data-track-id={track.id}
                style:height="{TRACK_H}px"
                role="presentation"
                onpointerdown={(e) => onLaneBackgroundPointerDown(e, track.id)}
              >
                {#each track.clips as clip (clip.id)}
                  {@const dur = clipDuration(clip)}
                  {@const usedLeft = clip.timelineStart * pxPerSecond}
                  {@const usedW = Math.max(dur * pxPerSecond, 4)}
                  {@const mediaDur = app.metaByPath.get(clip.sourcePath)?.duration ?? 0}
                  {@const preSec = clip.sourceIn > 0 ? clip.sourceIn : 0}
                  {@const postSec =
                    mediaDur > clip.sourceOut ? mediaDur - clip.sourceOut : 0}
                  {@const preW = preSec * pxPerSecond}
                  {@const postW = postSec * pxPerSecond}
                  {@const colorVars = clipColorCssVars(clip.sourcePath)}
                  <!-- Trimmed source still on disk: dim handles around the used range -->
                  {#if preW >= 2}
                    <div
                      class="clip-handle left"
                      class:active={isClipSelected(clip.id)}
                      style="{colorVars}; left: {usedLeft - preW}px; width: {preW}px"
                      title="Trimmed head ({preSec.toFixed(2)}s) — drag left edge of clip to restore"
                      aria-hidden="true"
                    ></div>
                  {/if}
                  {#if postW >= 2}
                    <div
                      class="clip-handle right"
                      class:active={isClipSelected(clip.id)}
                      style="{colorVars}; left: {usedLeft + usedW}px; width: {postW}px"
                      title="Trimmed tail ({postSec.toFixed(2)}s) — drag right edge of clip to restore"
                      aria-hidden="true"
                    ></div>
                  {/if}
                  <div
                    class="clip"
                    class:active={isClipSelected(clip.id)}
                    class:primary={clip.id === app.selectedClipId && app.selectedClipIds.length > 1}
                    class:muted-clip={clip.muted === true}
                    class:dragging={dragClipId === clip.id ||
                      (dragKind === "move" && dragGroupIds.includes(clip.id) && didMove)}
                    style="{colorVars}; left: {usedLeft}px; width: {usedW}px"
                    title={clip.muted ? `${clip.sourcePath} (muted)` : clip.sourcePath}
                    role="button"
                    tabindex="0"
                    onpointerdown={(e) => onClipPointerDown(e, clip.id, track.id)}
                    onkeydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        selectClipOnly(clip.id, track.id);
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
                    {#if clip.muted}
                      <span class="clip-mute" title="Muted" aria-hidden="true">
                        <VolumeX size={12} strokeWidth={2.5} />
                      </span>
                    {/if}
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
        </div>

        <!--
          Markers live in a dedicated overlay so the sticky ruler never paints over them.
          pointer-events none on the layer; hits re-enabled on the handles.
        -->
        <div
          class="markers"
          style:height="{RULER_H + displayTracks.length * TRACK_H}px"
          aria-hidden="false"
        >
          <!-- Playhead (drag to scrub) -->
          <div
            class="playhead"
            class:scrubbing
            style:left="{app.playhead * pxPerSecond}px"
            style:height="100%"
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
                e.stopPropagation();
                const dir = e.key === "ArrowLeft" ? -1 : 1;
                if (e.shiftKey) stepPlayheadSeconds(dir);
                else stepPlayheadFrames(dir);
              }
            }}
          >
            <div class="playhead-hit" aria-hidden="true"></div>
            <div class="playhead-head" aria-hidden="true"></div>
          </div>

          <!-- Sequence end handle — program out (extend black or trim clips on release) -->
          <div
            class="duration-handle"
            class:active={resizingDuration}
            class:preview-trim={resizingDuration &&
              durationPreview != null &&
              durationPreview < contentEnd}
            style:left="{displayDuration * pxPerSecond}px"
            style:height="100%"
            style:width="{DURATION_HANDLE_PX}px"
            role="slider"
            tabindex="0"
            aria-label="Sequence end — drag to set program out (trims clips when shortened)"
            aria-valuemin={0}
            aria-valuemax={Math.max(contentEnd + 3600, displayDuration)}
            aria-valuenow={displayDuration}
            aria-valuetext="{formatTimestamp(displayDuration)} ({displayDuration.toFixed(2)}s)"
            title="Sequence end {formatTimestamp(displayDuration)} — drag right for black tail, left to trim clips past this time"
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

  .zoom-fit {
    padding: 0.2em 0.45em;
    font-size: 0.8rem;
    font-weight: 500;
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

  .label-row.solo {
    color: var(--warn);
    background: rgba(212, 160, 23, 0.12);
  }

  .label-row .track-name {
    pointer-events: none;
  }

  .solo-badge {
    margin-left: 0.2rem;
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--warn);
    pointer-events: none;
  }

  /* Empty timeline (no media on this track) — not the same as trimmed handles */
  .lane.has-gaps {
    background-image: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 6px,
      rgba(255, 255, 255, 0.025) 6px,
      rgba(255, 255, 255, 0.025) 12px
    );
  }

  /* Selection tint must layer with hatch (shorthand `background` would wipe it). */
  .lane.has-gaps.selected {
    background-color: rgba(91, 140, 255, 0.06);
    background-image: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 6px,
      rgba(255, 255, 255, 0.035) 6px,
      rgba(255, 255, 255, 0.035) 12px
    );
  }

  /**
   * Unused source before in / after out, aligned to the active clip.
   * Visual only (no drag) — trim edges on the solid clip restore this media.
   */
  .clip-handle {
    position: absolute;
    top: 6px;
    bottom: 6px;
    box-sizing: border-box;
    border-radius: 3px;
    pointer-events: none;
    z-index: 0;
    background: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc(var(--clip-l) * 1%),
      0.12
    );
    border: 1px dashed hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.4);
    opacity: 0.9;
  }

  .clip-handle.left {
    border-right: none;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .clip-handle.right {
    border-left: none;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .clip-handle.active {
    background: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc(var(--clip-l) * 1%),
      0.18
    );
    border-color: hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.55);
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
  }

  .timeline-stack {
    position: relative;
    z-index: 1;
  }

  .ruler {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }

  .ruler.scrubbing {
    cursor: grabbing;
  }

  /* Always above sticky ruler + tracks (sibling stacking, not trapped under sticky) */
  .markers {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    z-index: 20;
    pointer-events: none;
  }

  .markers .playhead,
  .markers .duration-handle {
    pointer-events: none;
  }

  .markers .playhead-hit,
  .markers .duration-handle {
    pointer-events: auto;
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

  .marker {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 12px;
    margin-left: -6px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    z-index: 3;
  }

  .marker-flag {
    position: absolute;
    top: 2px;
    left: 5px;
    width: 0;
    height: 0;
    border-left: 5px solid var(--warn);
    border-right: 0 solid transparent;
    border-bottom: 7px solid transparent;
  }

  .marker-label {
    position: absolute;
    top: 12px;
    left: 2px;
    max-width: 4rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.65rem;
    color: var(--warn);
    pointer-events: none;
  }

  .lanes {
    position: relative;
  }

  .lane {
    position: relative;
    border-bottom: 1px solid var(--border);
    background-color: var(--bg);
  }

  .lane.selected {
    background-color: rgba(91, 140, 255, 0.06);
  }

  .clip {
    /* Per-source colors via --clip-h/s/l (clipColorCssVars); fallback = accent blue */
    --clip-h: 217;
    --clip-s: 78;
    --clip-l: 62;
    position: absolute;
    top: 4px;
    bottom: 4px;
    z-index: 1;
    display: flex;
    align-items: center;
    background: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc(var(--clip-l) * 1%),
      0.28
    );
    border: 1px solid
      hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.55);
    border-left: 3px solid
      hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.95);
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
    background: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc(var(--clip-l) * 1%),
      0.4
    );
  }

  .clip.active {
    border-color: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc((var(--clip-l) + 8) * 1%),
      0.95
    );
    border-left-color: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc((var(--clip-l) + 10) * 1%),
      1
    );
    background: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc(var(--clip-l) * 1%),
      0.52
    );
    box-shadow: 0 0 0 1px
      hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.85);
  }

  .clip.primary {
    box-shadow:
      0 0 0 1px hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.85),
      0 0 0 3px rgba(255, 255, 255, 0.2);
  }

  .clip.dragging {
    cursor: grabbing;
    opacity: 0.92;
    z-index: 2;
  }

  .clip-mute {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    margin-left: 0.2rem;
    opacity: 0.9;
    pointer-events: none;
  }

  .clip.muted-clip {
    opacity: 0.78;
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

  .playhead {
    position: absolute;
    top: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--danger);
    cursor: ew-resize;
    touch-action: none;
    outline: none;
  }

  .playhead.scrubbing {
    cursor: grabbing;
  }

  .playhead:focus-visible .playhead-hit {
    background: rgba(240, 113, 120, 0.18);
  }

  /* Wide invisible hit target for easier grab */
  .playhead-hit {
    position: absolute;
    top: 0;
    left: -5px;
    width: 12px;
    height: 100%;
    background: transparent;
  }

  .playhead-head {
    position: absolute;
    top: 0;
    left: -5px;
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 9px solid var(--danger);
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
  }

  .duration-handle {
    position: absolute;
    top: 0;
    margin-left: -5px;
    cursor: ew-resize;
    touch-action: none;
    outline: none;
  }

  .duration-handle.active .duration-handle-bar,
  .duration-handle:hover .duration-handle-bar {
    background: var(--accent-hover);
  }

  .duration-handle.preview-trim .duration-handle-bar,
  .duration-handle.preview-trim .duration-handle-grip {
    background: var(--warn);
  }

  .duration-handle-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 2px;
    background: var(--accent);
  }

  .duration-handle-grip {
    position: absolute;
    top: 3px;
    left: 0;
    width: 10px;
    height: 16px;
    border-radius: 2px;
    background: var(--accent);
    border: 1px solid rgba(255, 255, 255, 0.45);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
  }

  .duration-handle:focus-visible .duration-handle-grip {
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  }
</style>
