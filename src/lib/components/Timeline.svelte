<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import BookmarkPlus from "@lucide/svelte/icons/bookmark-plus";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Image from "@lucide/svelte/icons/image";
  import ImageOff from "@lucide/svelte/icons/image-off";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Plus from "@lucide/svelte/icons/plus";
  import Music from "@lucide/svelte/icons/music";
  import Scissors from "@lucide/svelte/icons/scissors";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import X from "@lucide/svelte/icons/x";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import {
    addTrack,
    duplicateClipTo,
    duplicateClipsByDelta,
    findClip,
    moveClip,
    moveClipsByDelta,
    splitClip,
    trimClipIn,
    trimClipOut,
  } from "$lib/clips";
  import { clipColorCssVars } from "$lib/clipColor";
  import { BTN, DIVIDER, FIELD, toggleClass, toggleSquareClass } from "$lib/ui";
  import ClipFilmstrip from "$lib/components/ClipFilmstrip.svelte";
  import ClipWaveform from "$lib/components/ClipWaveform.svelte";
  import {
    clearFilmstripErrors,
    clearFilmstripMemoryCache,
    ensureFilmstrip,
    getFilmstripLastError,
    getFilmstripLoadingCount,
    peekFilmstrip,
    subscribeFilmstrips,
  } from "$lib/filmstripCache";
  import type { FilmstripReady } from "$lib/filmstripCache";
  import {
    clearWaveformErrors,
    clearWaveformMemoryCache,
    ensureWaveform,
    getWaveformLastError,
    getWaveformLoadingCount,
    peekWaveform,
    subscribeWaveforms,
  } from "$lib/waveformCache";
  import type { WaveformReady } from "$lib/waveformCache";
  import {
    clipDuration,
    cloneProject,
    contentDuration,
    projectDuration,
    setProjectDuration,
  } from "$lib/project";
  import { collectSnapTimes, DEFAULT_SNAP_THRESHOLD, snapClipStart, snapTime } from "$lib/snap";
  import { clamp, formatTimestamp } from "$lib/time";
  import { trackRowMetrics, type TrackRowSize } from "$lib/trackRow";
  import type { Project } from "$lib/types";
  import {
    addMarkerAtPlayhead,
    app,
    basename,
    clearClipSelection,
    clearPlayRange,
    commitProject,
    commitProjectEdit,
    deleteMarker,
    deleteSelectedClips,
    hasPlayRange,
    isClipSelected,
    playBounds,
    project,
    renameMarkerLabel,
    seekNextCut,
    seekPrevCut,
    selectClipOnly,
    setPlayInAtPlayhead,
    setPlayOutAtPlayhead,
    setMarkerTimeLive,
    setPlayhead,
    setPresentLive,
    setTimelineDuration,
    setTrackRowSize,
    stepPlayheadFrames,
    stepPlayheadSeconds,
    toggleClipInSelection,
    toggleFilmstrips,
    toggleSoloTrack,
  } from "../../state/appState.svelte";

  const RULER_H = 28;
  const row = $derived(trackRowMetrics(app.trackRowSize));
  const TRACK_H = $derived(row.trackH);
  const FILMSTRIP_H = $derived(row.filmstripH);
  const EDGE_PX = 7;
  const DURATION_HANDLE_PX = 10;
  const MIN_PPS = 6;
  const MAX_PPS = 240;
  const DEFAULT_PPS = 48;

  let pxPerSecond = $state(DEFAULT_PPS);
  let scrollEl: HTMLDivElement | undefined = $state();
  let lanesEl: HTMLDivElement | undefined = $state();
  /** Marker id currently being renamed (inline input). */
  let editingMarkerId = $state<string | null>(null);
  let editingMarkerLabel = $state("");
  let markerRenameInput: HTMLInputElement | undefined = $state();
  /** Bumps when a filmstrip / waveform finishes loading so clip backgrounds refresh. */
  let filmstripTick = $state(0);
  let waveformTick = $state(0);

  type DragKind = "move" | "trim-in" | "trim-out";

  let dragKind = $state<DragKind | null>(null);
  /** Reactive so `.dragging` class updates during pointer capture. */
  let dragClipId = $state<string | null>(null);
  /** Ids moved together (includes dragClipId). */
  let dragGroupIds = $state<string[]>([]);
  let dragBefore = $state<Project | null>(null);
  /** Option/Alt-drag duplicate (NLE convention); Shift still disables snap. */
  let dragCopying = $state(false);
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

  // Read present directly so Svelte tracks history replacement after import/commit.
  const p = $derived(app.history.present);
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
    dragCopying = false;
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

  // --- Marker drag -------------------------------------------------------------------------
  // Same shape as the clip drag: a few pixels of travel before a press counts as a drag, so a
  // plain click still reads as a click and seeks. That is also why the seek moved to pointerUP —
  // seeking on press would jump the playhead the instant you grabbed a marker to move it.
  let dragMarkerId = $state<string | null>(null);
  let markerDragBefore: Project | null = null;
  let markerOriginX = 0;
  let markerStartT = 0;
  let markerLabel = "";
  let markerDidMove = $state(false);
  let markerPointerId: number | null = null;

  function clearMarkerDrag() {
    dragMarkerId = null;
    markerDragBefore = null;
    markerDidMove = false;
    markerPointerId = null;
  }

  function onMarkerPointerDown(e: PointerEvent, id: string, t: number, label: string) {
    // Keep hits on the marker (not ruler scrub / playhead).
    e.stopPropagation();
    if (e.altKey) {
      e.preventDefault();
      deleteMarker(id);
      return;
    }
    // detail >= 2 is the second click of a double-click — leave it to the rename handler.
    if (e.detail >= 2) return;
    if (dragKind || resizingDuration) return;

    dragMarkerId = id;
    markerDragBefore = project();
    markerOriginX = e.clientX;
    markerStartT = t;
    markerLabel = label;
    markerDidMove = false;
    markerPointerId = e.pointerId;

    window.addEventListener("pointermove", onMarkerPointerMove);
    window.addEventListener("pointerup", onMarkerPointerUp);
    window.addEventListener("pointercancel", onMarkerPointerUp);
  }

  function onMarkerPointerMove(e: PointerEvent) {
    if (!dragMarkerId || !markerDragBefore) return;
    if (markerPointerId !== null && e.pointerId !== markerPointerId) return;

    const dx = e.clientX - markerOriginX;
    if (!markerDidMove && Math.abs(dx) < 3) return;
    markerDidMove = true;

    let t = Math.max(0, markerStartT + dx / pxPerSecond);
    // Shift = free, matching clip drags. The threshold widens as you zoom out so the pull stays
    // the same distance on screen rather than the same number of seconds.
    if (!e.shiftKey) {
      const targets = collectSnapTimes(markerDragBefore, {
        excludeMarkerId: dragMarkerId,
        playhead: app.playhead,
      });
      t = snapTime(t, targets, Math.max(DEFAULT_SNAP_THRESHOLD, 8 / pxPerSecond));
    }
    setMarkerTimeLive(dragMarkerId, t);
  }

  function onMarkerPointerUp(e: PointerEvent) {
    if (!dragMarkerId || !markerDragBefore) return;
    if (markerPointerId !== null && e.pointerId !== markerPointerId) return;

    const before = markerDragBefore;
    const moved = markerDidMove;
    const id = dragMarkerId;
    const label = markerLabel;
    const startT = markerStartT;

    window.removeEventListener("pointermove", onMarkerPointerMove);
    window.removeEventListener("pointerup", onMarkerPointerUp);
    window.removeEventListener("pointercancel", onMarkerPointerUp);
    clearMarkerDrag();

    if (!moved) {
      setPlayhead(startT);
      app.status = `Marker ${label}`;
      return;
    }
    if (!commitProjectEdit(before, project())) return;
    const at = (project().markers ?? []).find((m) => m.id === id)?.t ?? startT;
    app.status = `Marker ${label} moved to ${formatTimestamp(at)}`;
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
      forceEdge ??
      ((target.closest("[data-edge]") as HTMLElement | null)?.dataset.edge as
        "in" | "out" | undefined);
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
      dragKind === "move" && app.selectedClipIds.length > 1 ? [...app.selectedClipIds] : [clipId];
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
      // Option (macOS) / Alt (Windows): leave originals, place copies (NLE convention).
      dragCopying = e.altKey;

      if (dragGroupIds.length > 1) {
        setPresentLive(
          dragCopying
            ? duplicateClipsByDelta(before, dragGroupIds, delta)
            : moveClipsByDelta(before, dragGroupIds, delta),
        );
        return;
      }

      const toTrackId = trackIdAtClientY(e.clientY) ?? startTrackId;
      setPresentLive(
        dragCopying
          ? duplicateClipTo(before, dragClipId, newStart, toTrackId)
          : moveClip(before, dragClipId, newStart, toTrackId),
      );
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
    const copied = dragCopying;

    detachDragListeners();
    clearDragState();

    if (!moved) {
      // Click only — present never mutated
      return;
    }

    if (!commitProjectEdit(before, after)) return;

    if (kind === "move" && copied) {
      // Select the new copies (ids present in after but not before).
      const beforeIds = new Set<string>();
      for (const tr of before.tracks) {
        for (const c of tr.clips) beforeIds.add(c.id);
      }
      const newIds: string[] = [];
      for (const tr of after.tracks) {
        for (const c of tr.clips) {
          if (!beforeIds.has(c.id)) newIds.push(c.id);
        }
      }
      if (newIds.length > 0) {
        app.selectedClipIds = newIds;
        app.selectedClipId = newIds[newIds.length - 1] ?? null;
        const primary = app.selectedClipId ? findClip(after, app.selectedClipId) : null;
        if (primary) app.selectedTrackId = after.tracks[primary.trackIndex]!.id;
      }
      app.status = newIds.length > 1 ? `Duplicated ${newIds.length} clips` : "Duplicated clip";
      return;
    }

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

  function splitSelectedAtPlayhead() {
    const id = app.selectedClipId;
    if (!id) {
      app.status = "Select a clip to split";
      return;
    }
    const next = splitClip(project(), id, app.playhead);
    if (next === project()) {
      app.status = "Playhead not inside selected clip";
      return;
    }
    commitProject(next);
    app.status = "Split clip";
  }

  function beginRenameMarker(id: string, label: string) {
    editingMarkerId = id;
    editingMarkerLabel = label;
    queueMicrotask(() => {
      markerRenameInput?.focus();
      markerRenameInput?.select();
    });
  }

  function commitRenameMarker() {
    const id = editingMarkerId;
    if (!id) return;
    const label = editingMarkerLabel;
    editingMarkerId = null;
    editingMarkerLabel = "";
    renameMarkerLabel(id, label);
  }

  function cancelRenameMarker() {
    editingMarkerId = null;
    editingMarkerLabel = "";
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
      e.preventDefault();
      splitSelectedAtPlayhead();
    }
  }

  const hasSelection = $derived(app.selectedClipIds.length > 0 || app.selectedClipId != null);
  const rangeActive = $derived(hasPlayRange());
  const bounds = $derived(playBounds());

  function updateThumbsStatus() {
    if (!app.showFilmstrips) return;
    const n = getFilmstripLoadingCount() + getWaveformLoadingCount();
    if (n > 0) {
      app.status = n === 1 ? "Generating thumbs…" : `Generating thumbs… (${n})`;
      return;
    }
    const err = getFilmstripLastError() ?? getWaveformLastError();
    if (err) {
      app.status = `Thumbs: ${err}`;
      return;
    }
    if (app.status.startsWith("Generating thumbs") || app.status.startsWith("Thumbs:")) {
      app.status = "Thumbs ready";
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    const unsubStrip = subscribeFilmstrips(() => {
      filmstripTick++;
      updateThumbsStatus();
    });
    const unsubWave = subscribeWaveforms(() => {
      waveformTick++;
      updateThumbsStatus();
    });
    return () => {
      unsubStrip();
      unsubWave();
    };
  });

  onDestroy(() => {
    window.removeEventListener("keydown", onKeyDown);
    detachDragListeners();
    endScrub();
    endDurationResize();
  });

  // Kick off full-media filmstrips / waveforms outside of render (safe side effects).
  $effect(() => {
    if (!app.showFilmstrips) return;
    void p;
    void app.metaByPath;
    void FILMSTRIP_H;
    for (const track of p.tracks) {
      for (const clip of track.clips) {
        const meta = app.metaByPath.get(clip.sourcePath);
        ensureFilmstrip(clip, meta, FILMSTRIP_H);
        ensureWaveform(clip, meta, FILMSTRIP_H);
      }
    }
  });

  /** Render-only peek — never starts ffmpeg (that would mutate state mid-paint). */
  function filmstripForClip(clip: (typeof p.tracks)[0]["clips"][0]): FilmstripReady | null {
    void filmstripTick;
    if (!app.showFilmstrips) return null;
    return peekFilmstrip(clip, app.metaByPath.get(clip.sourcePath), FILMSTRIP_H);
  }

  function waveformForClip(clip: (typeof p.tracks)[0]["clips"][0]): WaveformReady | null {
    void waveformTick;
    if (!app.showFilmstrips) return null;
    return peekWaveform(clip, app.metaByPath.get(clip.sourcePath), FILMSTRIP_H);
  }

  function onToggleFilmstrips() {
    toggleFilmstrips();
    if (app.showFilmstrips) {
      clearFilmstripErrors();
      clearFilmstripMemoryCache();
      clearWaveformErrors();
      clearWaveformMemoryCache();
      filmstripTick++;
      waveformTick++;
    }
  }
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-ground" aria-label="Timeline">
  <!-- The region's heading, for heading navigation only: the strip below carries no visible
       title, because "TIMELINE" plus a live count of tracks and clips only restated what the
       tracks themselves already show. -->
  <h2 class="sr-only">Timeline</h2>

  <!-- The timeline's ONE strip. Every edit tool is icon-only: the status line echoes the hovered
       control's `title`, so a label costs horizontal space and buys nothing. That is what frees
       the width for Length, Zoom and Fit, which used to need a second strip of their own.
       Hand-typed near-copy of STRIP: deliberately adds `overflow-x-auto` because this row can
       still overflow on a narrow window. `scrollbar-none` and the `::-webkit-scrollbar` rule
       below hide the scrollbar (a classic, non-overlay scrollbar on Windows/WebView2 would
       otherwise take ~15px out of this 28px strip) while keeping it scrollable. -->
  <div
    class="scroll-strip flex h-7 shrink-0 scrollbar-none items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2 text-[11px] whitespace-nowrap text-muted"
    role="toolbar"
    aria-label="Timeline tools"
  >
    <div class="flex items-center gap-1" role="group" aria-label="Navigate">
      <button
        type="button"
        class={BTN}
        onclick={() => seekPrevCut()}
        title="Previous cut or marker ([)"
        aria-label="Previous cut or marker"
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        class={BTN}
        onclick={() => seekNextCut()}
        title="Next cut or marker (])"
        aria-label="Next cut or marker"
      >
        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
    <div class={DIVIDER} aria-hidden="true"></div>
    <div class="flex items-center gap-1" role="group" aria-label="Edit">
      <button
        type="button"
        class={BTN}
        onclick={splitSelectedAtPlayhead}
        disabled={!app.selectedClipId}
        title="Split selected clip at playhead (S)"
        aria-label="Split clip at playhead"
      >
        <Scissors size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        class={BTN}
        onclick={() => deleteSelectedClips()}
        disabled={!hasSelection}
        title="Delete selected clip(s) (Delete)"
        aria-label="Delete selected clips"
      >
        <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        class={BTN}
        onclick={() => addMarkerAtPlayhead()}
        title="Add marker at playhead (M)"
        data-hint="Click a marker to seek, double-click to rename, Alt+click to remove"
        aria-label="Add marker at playhead"
      >
        <BookmarkPlus size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
    <div class={DIVIDER} aria-hidden="true"></div>
    <div class="flex items-center gap-1" role="group" aria-label="Display">
      <!-- Keeps its label: no icon reads as "filmstrips" without being decoded first. -->
      <button
        type="button"
        class={toggleClass(app.showFilmstrips)}
        onclick={onToggleFilmstrips}
        title={app.showFilmstrips
          ? "Hide filmstrips / audio waveforms (ffmpeg)"
          : "Show filmstrips / audio waveforms (ffmpeg)"}
        aria-label="Toggle filmstrips"
        aria-pressed={app.showFilmstrips}
      >
        {#if app.showFilmstrips}
          <Image size={16} strokeWidth={2} aria-hidden="true" />
        {:else}
          <ImageOff size={16} strokeWidth={2} aria-hidden="true" />
        {/if}
        <span>Thumbs</span>
      </button>
      {#each ["s", "m", "l"] as size (size)}
        <button
          type="button"
          class={toggleSquareClass(app.trackRowSize === size)}
          onclick={() => setTrackRowSize(size as TrackRowSize)}
          title={trackRowMetrics(size as TrackRowSize).title}
          aria-label={trackRowMetrics(size as TrackRowSize).title}
          aria-pressed={app.trackRowSize === size}
        >
          {trackRowMetrics(size as TrackRowSize).label}
        </button>
      {/each}
    </div>
    <div class={DIVIDER} aria-hidden="true"></div>
    <div class="flex items-center gap-1" role="group" aria-label="Play range">
      <!-- warn: the play range is preview-only and never reaches the export. The letter IS the
           keyboard shortcut, so it stays visible where other tools went icon-only. -->
      <button
        type="button"
        class={toggleSquareClass(app.playIn != null, "bg-warn text-ground")}
        onclick={() => setPlayInAtPlayhead()}
        title="Set play-in at playhead (I) — preview only, never affects the export"
        aria-label="Set play in"
        aria-pressed={app.playIn != null}
      >
        I
      </button>
      <button
        type="button"
        class={toggleSquareClass(app.playOut != null, "bg-warn text-ground")}
        onclick={() => setPlayOutAtPlayhead()}
        title="Set play-out at playhead (O) — preview only, never affects the export"
        aria-label="Set play out"
        aria-pressed={app.playOut != null}
      >
        O
      </button>
      <button
        type="button"
        class={BTN}
        onclick={() => clearPlayRange()}
        disabled={!rangeActive}
        title="Clear play range (Esc)"
        aria-label="Clear play range"
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {#if rangeActive}
        <span class="tabular-nums" title="Preview plays only this range; export is unchanged">
          {formatTimestamp(bounds.start)}–{formatTimestamp(bounds.end)}
        </span>
      {/if}
    </div>

    <div class={DIVIDER} aria-hidden="true"></div>

    <!-- Sequence and view controls, pushed right. These moved down from the header row that this
         strip replaced. -->
    <div class="ml-auto flex shrink-0 items-center gap-1">
      <label
        class="inline-flex items-center gap-1"
        title="Sequence end (program out). Values shorter than media trim clips past that time."
      >
        <span>Length</span>
        <input
          class="{FIELD} w-16"
          type="number"
          min="0"
          step="0.1"
          bind:value={durationInput}
          onchange={applyDurationInput}
          onkeydown={onDurationKey}
          aria-label="Timeline length in seconds"
        />
        <span>s</span>
      </label>
      <div class={DIVIDER} aria-hidden="true"></div>
      <label class="inline-flex items-center gap-1" title="Timeline zoom">
        <ZoomIn size={14} strokeWidth={2} class="opacity-75" aria-hidden="true" />
        <input
          type="range"
          class="slider w-24"
          style="--fill-from: 0%; --fill-to: {((pxPerSecond - MIN_PPS) / (MAX_PPS - MIN_PPS)) *
            100}%"
          min={MIN_PPS}
          max={MAX_PPS}
          step="1"
          value={pxPerSecond}
          oninput={onZoomInput}
          aria-label="Timeline zoom pixels per second"
        />
        <span class="w-14 text-right tabular-nums">{Math.round(pxPerSecond)} px/s</span>
      </label>
      <button
        type="button"
        class={BTN}
        onclick={fitZoomToWidth}
        title="Fit sequence to timeline width (100%)"
        aria-label="Fit sequence to timeline width"
      >
        <Maximize2 size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  </div>

  <div class="timeline-body">
    <div class="labels">
      <!-- A command that creates a thing belongs next to that thing. This cell is the space the
           labels column already reserved to clear the ruler, so the button costs no height and
           stays in one place however many tracks exist. -->
      <button
        type="button"
        class="add-track"
        style:height="{RULER_H}px"
        onclick={onAddTrack}
        title="Add video track"
        aria-label="Add track"
      >
        <Plus size={12} strokeWidth={2} aria-hidden="true" />
        <span>Track</span>
      </button>
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

    <div class="scroll" bind:this={scrollEl} onwheel={onWheel}>
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
            {#if rangeActive && bounds.end > bounds.start}
              <div
                class="play-range"
                style:left="{bounds.start * pxPerSecond}px"
                style:width="{(bounds.end - bounds.start) * pxPerSecond}px"
                title="Play range {formatTimestamp(bounds.start)} – {formatTimestamp(
                  bounds.end,
                )} (preview only)"
                aria-hidden="true"
              ></div>
              <!-- Asymmetric half-wedges, so they differ from the playhead head in SHAPE: red on
                   amber is the worst pair for the common colour blindnesses. -->
              {#if app.playIn != null}
                <div
                  class="play-io in"
                  style:left="{bounds.start * pxPerSecond}px"
                  aria-hidden="true"
                ></div>
              {/if}
              {#if app.playOut != null}
                <div
                  class="play-io out"
                  style:left="{bounds.end * pxPerSecond - 8}px"
                  aria-hidden="true"
                ></div>
              {/if}
            {/if}
            {#each p.markers ?? [] as marker (marker.id)}
              {#if editingMarkerId === marker.id}
                <div
                  class="marker editing"
                  style:left="{marker.t * pxPerSecond}px"
                  role="group"
                  aria-label="Rename marker"
                >
                  <span class="marker-flag" aria-hidden="true"></span>
                  <input
                    bind:this={markerRenameInput}
                    class="marker-rename"
                    type="text"
                    maxlength={48}
                    value={editingMarkerLabel}
                    oninput={(e) => {
                      editingMarkerLabel = (e.currentTarget as HTMLInputElement).value;
                    }}
                    onpointerdown={(e) => e.stopPropagation()}
                    onkeydown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRenameMarker();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelRenameMarker();
                      }
                    }}
                    onblur={() => commitRenameMarker()}
                    aria-label="Marker name"
                  />
                </div>
              {:else}
                <button
                  type="button"
                  class="marker"
                  style:left="{marker.t * pxPerSecond}px"
                  class:dragging={dragMarkerId === marker.id && markerDidMove}
                  title="{marker.label} @ {formatTimestamp(marker.t)}"
                  data-hint="Drag to move (Shift for free) · click to seek · double-click to rename · Alt+click to remove"
                  aria-label="Marker {marker.label}"
                  onpointerdown={(e) => onMarkerPointerDown(e, marker.id, marker.t, marker.label)}
                  ondblclick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    beginRenameMarker(marker.id, marker.label);
                  }}
                >
                  <span class="marker-flag" aria-hidden="true"></span>
                  <span class="marker-label">{marker.label}</span>
                </button>
              {/if}
            {/each}
          </div>

          <!-- Tracks / clips -->
          <div
            class="lanes"
            bind:this={lanesEl}
            style:min-height="{displayTracks.length * TRACK_H}px"
          >
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
                  {@const postSec = mediaDur > clip.sourceOut ? mediaDur - clip.sourceOut : 0}
                  {@const preW = preSec * pxPerSecond}
                  {@const postW = postSec * pxPerSecond}
                  {@const colorVars = clipColorCssVars(clip.sourcePath)}
                  {@const strip = filmstripForClip(clip)}
                  {@const wave = waveformForClip(clip)}
                  <!-- Trimmed source still on disk: dim handles around the used range -->
                  {#if preW >= 2}
                    <div
                      class="clip-handle left"
                      class:active={isClipSelected(clip.id)}
                      style="{colorVars}; left: {usedLeft - preW}px; width: {preW}px"
                      title="Trimmed head ({preSec.toFixed(
                        2,
                      )}s) — drag left edge of clip to restore"
                      aria-hidden="true"
                    ></div>
                  {/if}
                  {#if postW >= 2}
                    <div
                      class="clip-handle right"
                      class:active={isClipSelected(clip.id)}
                      style="{colorVars}; left: {usedLeft + usedW}px; width: {postW}px"
                      title="Trimmed tail ({postSec.toFixed(
                        2,
                      )}s) — drag right edge of clip to restore"
                      aria-hidden="true"
                    ></div>
                  {/if}
                  <div
                    class="clip"
                    class:active={isClipSelected(clip.id)}
                    class:primary={clip.id === app.selectedClipId && app.selectedClipIds.length > 1}
                    class:muted-clip={clip.muted === true}
                    class:has-filmstrip={!!strip || !!wave}
                    class:dragging={dragClipId === clip.id ||
                      (dragKind === "move" && dragGroupIds.includes(clip.id) && didMove)}
                    class:copying={dragCopying &&
                      didMove &&
                      dragKind === "move" &&
                      dragBefore != null &&
                      !findClip(dragBefore, clip.id)}
                    style="{colorVars}; left: {usedLeft}px; width: {usedW}px"
                    title={clip.muted
                      ? `${clip.sourcePath} (muted) · ⌥/Alt-drag to duplicate`
                      : `${clip.sourcePath} · ⌥/Alt-drag to duplicate`}
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
                    {#if strip}
                      <ClipFilmstrip
                        url={strip.url}
                        count={strip.count}
                        width={strip.width}
                        height={strip.height}
                        sourceIn={clip.sourceIn}
                        sourceOut={clip.sourceOut}
                        mediaDuration={strip.mediaDuration}
                      />
                    {:else if wave}
                      <ClipWaveform
                        url={wave.url}
                        sourceIn={clip.sourceIn}
                        sourceOut={clip.sourceOut}
                        mediaDuration={wave.mediaDuration}
                      />
                    {/if}
                    <span
                      class="edge in"
                      data-edge="in"
                      style:width="{EDGE_PX}px"
                      aria-hidden="true"
                      onpointerdown={(e) => onClipPointerDown(e, clip.id, track.id, "in")}
                    ></span>
                    {#if (app.metaByPath.get(clip.sourcePath)?.width ?? 1) === 0}
                      <span class="clip-mute" title="Audio only" aria-hidden="true">
                        <Music size={12} strokeWidth={2.5} />
                      </span>
                    {/if}
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
          style:--ruler-h="{RULER_H}px"
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
            title="Sequence end {formatTimestamp(
              displayDuration,
            )} — drag right for black tail, left to trim clips past this time"
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
  /* Both header strips overflow at ordinary window widths. `scrollbar-width: none` (set via
     utility class) hides it on Firefox/Chromium; this hides it on WebKit/Blink, including
     Windows/WebView2, where a classic scrollbar would otherwise take ~15px out of a 28px strip. */
  .scroll-strip::-webkit-scrollbar {
    display: none;
  }

  .timeline-body {
    flex: 1 1 auto;
    display: flex;
    align-items: flex-start;
    min-height: 0;
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--color-ground);
  }

  .labels {
    flex: 0 0 auto;
    width: 52px;
    border-right: 1px solid var(--color-line);
    background: var(--color-panel);
    z-index: 2;
    position: sticky;
    left: 0;
  }

  /* Sits in the cell the labels column reserves to clear the ruler, so it aligns with the ruler's
     own bottom border and never moves as tracks come and go. */
  .add-track {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border-bottom: 1px solid var(--color-line);
    font-size: 10px;
    color: var(--color-muted);
    cursor: pointer;
  }

  .add-track:hover {
    background: var(--color-raised);
    color: var(--color-text);
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-muted);
    border-bottom: 1px solid var(--color-line);
    border-left: 2px solid transparent;
    cursor: pointer;
    user-select: none;
  }

  .label-row:hover {
    color: var(--color-text);
  }

  /* Selection is the 2px left bar, reserved at all times so nothing moves. */
  .label-row.selected {
    border-left-color: var(--color-accent);
    color: var(--color-text);
  }

  .label-row.solo {
    color: var(--color-text);
  }

  .label-row .track-name {
    pointer-events: none;
  }

  /* Solo is session-only: warn, as a fixed 20px square like the audio editor's S flag. */
  .solo-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    color: var(--color-ground);
    background: var(--color-warn);
    pointer-events: none;
  }

  /* Gap hatch on tracks that hold clips. Stripes are text at 3%, so they track the palette. */
  .lane.has-gaps {
    background-image: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 6px,
      color-mix(in srgb, var(--color-text) 3%, transparent) 6px,
      color-mix(in srgb, var(--color-text) 3%, transparent) 12px
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
    background: hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.12);
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
    background: hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.18);
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
    background: var(--color-panel);
    border-bottom: 1px solid var(--color-line);
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

  /* Ticks grow up from the bottom; labels sit at the top, 3px right of their tick. */
  .tick {
    position: absolute;
    bottom: 0;
    width: 1px;
    height: 12px;
    background: var(--color-line);
    pointer-events: none;
  }

  .tick-label {
    position: absolute;
    bottom: 11px;
    left: 3px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--color-muted);
    white-space: nowrap;
  }

  /* Hit box covers stem + flag + label (not just the 2px line). */
  .marker {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: max-content;
    min-width: 24px;
    max-width: 96px;
    margin-left: -8px;
    padding: 1px 4px 0 3px;
    border: none;
    background: transparent;
    cursor: grab;
    z-index: 5;
    box-sizing: border-box;
  }

  /* Markers are SAVED document state, so they are deliberately not amber: amber is reserved for
     session-only state that never reaches the export, which is the in/out range. Sharing the
     colour made a bookmark and a preview boundary read as the same kind of thing. */
  .marker::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 7px;
    width: 1px;
    background: var(--color-text);
    opacity: 0.5;
    pointer-events: none;
  }

  .marker:hover::before {
    opacity: 0.9;
  }

  /* 8px, matching the in/out wedges, but SYMMETRIC where those are half-wedges: the three
     shapes at the top of the ruler differ by direction as well as colour, so they stay
     distinguishable without relying on hue alone. */
  .marker-flag {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    margin-left: 3px;
    width: 8px;
    height: 8px;
    background: var(--color-text);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    pointer-events: none;
  }

  .marker-label {
    position: relative;
    z-index: 1;
    max-width: 80px;
    margin-top: 1px;
    margin-left: 1px;
    padding: 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 600;
    line-height: 14px;
    color: var(--color-ground);
    background: var(--color-text);
    border-radius: 2px;
    pointer-events: none;
  }

  .marker.dragging {
    cursor: grabbing;
    z-index: 6;
  }

  .marker.editing {
    width: auto;
    max-width: none;
    z-index: 6;
    pointer-events: auto;
  }

  .marker-rename {
    position: relative;
    z-index: 1;
    width: 96px;
    min-width: 64px;
    max-width: 160px;
    margin: 1px 0 0 1px;
    padding: 0 4px;
    height: 16px;
    font-size: 10px;
    line-height: 16px;
    color: var(--color-text);
    background: var(--color-raised);
    border: none;
    border-radius: 4px;
  }

  /* warn: the play range is preview-only. Wash in the ruler, 1px lines, 8px half-wedges. */
  .play-range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--color-warn) 15%, transparent);
    border-left: 1px solid var(--color-warn);
    border-right: 1px solid var(--color-warn);
    pointer-events: none;
    z-index: 1;
  }

  .play-io {
    position: absolute;
    top: 0;
    width: 8px;
    height: 8px;
    background: var(--color-warn);
    pointer-events: none;
    z-index: 2;
  }

  .play-io.in {
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }

  .play-io.out {
    clip-path: polygon(100% 0, 0 0, 100% 100%);
  }

  .lanes {
    position: relative;
  }

  .lane {
    position: relative;
    border-bottom: 1px solid var(--color-line);
    background-color: var(--color-ground);
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
    background: hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.28);
    border: 1px solid hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.55);
    border-left: 3px solid
      hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.95);
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    touch-action: none;
    min-width: 4px;
    box-sizing: border-box;
  }

  .clip.has-filmstrip {
    background: hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.18);
  }

  .clip.has-filmstrip::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background: linear-gradient(
      to top,
      hsla(var(--clip-h), calc(var(--clip-s) * 1%), 12%, 0.55),
      transparent 55%
    );
  }

  .clip:hover {
    background: hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.4);
  }

  .clip.has-filmstrip:hover {
    background: hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.22);
  }

  /* Selection is the accent OUTLINE; the fill stays calm so hue keeps meaning "which file". */
  .clip.active {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }

  /* The clip the inspector edits, among a multi-selection. */
  .clip.primary {
    box-shadow: 0 0 0 2px var(--color-accent);
  }

  .clip.dragging {
    cursor: grabbing;
    opacity: 0.92;
    z-index: 2;
  }

  .clip.copying {
    cursor: copy;
    outline: 1px dashed hsla(var(--clip-h), calc(var(--clip-s) * 1%), 70%, 0.9);
    outline-offset: 1px;
    z-index: 3;
  }

  .clip-mute {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    margin-left: 3px;
    opacity: 0.9;
    pointer-events: none;
    position: relative;
    z-index: 1;
  }

  .clip.muted-clip {
    opacity: 0.78;
  }

  .clip-label {
    flex: 1;
    min-width: 0;
    padding: 0 5px;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    position: relative;
    z-index: 1;
    text-shadow:
      0 0 4px rgba(0, 0, 0, 0.85),
      0 1px 2px rgba(0, 0, 0, 0.9);
  }

  .edge {
    flex: 0 0 auto;
    align-self: stretch;
    cursor: ew-resize;
    position: relative;
    z-index: 2;
    background: transparent;
    touch-action: none;
  }

  .edge:hover,
  .edge:active {
    background: color-mix(in srgb, var(--color-text) 18%, transparent);
  }

  .playhead {
    position: absolute;
    top: 0;
    width: 1px;
    background: var(--color-danger);
    cursor: ew-resize;
    touch-action: none;
    outline: none;
  }

  .playhead.scrubbing {
    cursor: grabbing;
  }

  .playhead:focus-visible .playhead-hit {
    background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  }

  /*
   * Wide grab target for the playhead — starts *below* the ruler so marker
   * flags/labels stay clickable after a seek lands the playhead on a marker.
   * Scrub in the ruler still works via the ruler surface itself.
   */
  .playhead-hit {
    position: absolute;
    top: var(--ruler-h);
    left: -6px;
    width: 12px;
    height: calc(100% - var(--ruler-h));
    background: transparent;
  }

  /* 12 wide × 6 tall: half-width equals height, so the point is a right angle. */
  .playhead-head {
    position: absolute;
    top: 0;
    left: -6px;
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid var(--color-danger);
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
    pointer-events: none;
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
    background: var(--color-accent-hover);
  }

  .duration-handle.preview-trim .duration-handle-bar,
  .duration-handle.preview-trim .duration-handle-grip {
    background: var(--color-warn);
  }

  .duration-handle-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 2px;
    background: var(--color-accent);
  }

  /* The same 8px wedge language as the in/out markers, pointing left because this is where the
     program ENDS — accent rather than amber, because a program out is saved and exported.
     Visual only: the 10px-wide handle around it is what takes the drag. */
  .duration-handle-grip {
    position: absolute;
    top: 0;
    left: -3px;
    width: 8px;
    height: 8px;
    background: var(--color-accent);
    clip-path: polygon(100% 0, 0 0, 100% 100%);
  }

  .duration-handle:focus-visible .duration-handle-grip {
    box-shadow:
      0 0 0 2px var(--color-ground),
      0 0 0 4px var(--color-accent);
  }
</style>
