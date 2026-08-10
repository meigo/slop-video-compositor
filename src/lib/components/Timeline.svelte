<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import BookmarkPlus from "@lucide/svelte/icons/bookmark-plus";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Image from "@lucide/svelte/icons/image";
  import ImageOff from "@lucide/svelte/icons/image-off";
  import Layers from "@lucide/svelte/icons/layers";
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
  import ClipFilmstrip from "$lib/components/ClipFilmstrip.svelte";
  import ClipWaveform from "$lib/components/ClipWaveform.svelte";
  import {
    clearFilmstripErrors,
    clearFilmstripMemoryCache,
    ensureFilmstrip,
    getFilmstrip,
    getFilmstripLastError,
    subscribeFilmstrips,
  } from "$lib/filmstripCache";
  import type { FilmstripReady } from "$lib/filmstripCache";
  import {
    clearWaveformErrors,
    clearWaveformMemoryCache,
    ensureWaveform,
    getWaveform,
    getWaveformLastError,
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
  import {
    collectSnapTimes,
    DEFAULT_SNAP_THRESHOLD,
    snapClipStart,
    snapTime,
  } from "$lib/snap";
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
      app.status =
        newIds.length > 1 ? `Duplicated ${newIds.length} clips` : "Duplicated clip";
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

  const hasSelection = $derived(
    app.selectedClipIds.length > 0 || app.selectedClipId != null,
  );
  const markerCount = $derived((p.markers ?? []).length);
  const rangeActive = $derived(hasPlayRange());
  const bounds = $derived(playBounds());

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    const unsubStrip = subscribeFilmstrips(() => {
      filmstripTick++;
      const err = getFilmstripLastError();
      if (err && app.showFilmstrips) {
        app.status = `Filmstrip: ${err}`;
      }
    });
    const unsubWave = subscribeWaveforms(() => {
      waveformTick++;
      const err = getWaveformLastError();
      if (err && app.showFilmstrips) {
        app.status = `Waveform: ${err}`;
      }
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

  // Full-media filmstrips / waveforms per source+height (not per trim / zoom).
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

  function filmstripForClip(
    clip: (typeof p.tracks)[0]["clips"][0],
  ): FilmstripReady | null {
    void filmstripTick;
    if (!app.showFilmstrips) return null;
    const meta = app.metaByPath.get(clip.sourcePath);
    const key = ensureFilmstrip(clip, meta, FILMSTRIP_H);
    return key ? getFilmstrip(key) : null;
  }

  function waveformForClip(
    clip: (typeof p.tracks)[0]["clips"][0],
  ): WaveformReady | null {
    void waveformTick;
    if (!app.showFilmstrips) return null;
    const meta = app.metaByPath.get(clip.sourcePath);
    const key = ensureWaveform(clip, meta, FILMSTRIP_H);
    return key ? getWaveform(key) : null;
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
        · {markerCount} marker{markerCount === 1 ? "" : "s"}
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

  <!-- Discoverable edit tools (keyboard shortcuts still work). -->
  <div class="timeline-tools" role="toolbar" aria-label="Timeline tools">
    <div class="tool-group" role="group" aria-label="Navigate">
      <button
        type="button"
        class="ghost tool-btn"
        onclick={() => seekPrevCut()}
        title="Previous cut or marker ([)"
        aria-label="Previous cut or marker"
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        <span>Prev</span>
      </button>
      <button
        type="button"
        class="ghost tool-btn"
        onclick={() => seekNextCut()}
        title="Next cut or marker (])"
        aria-label="Next cut or marker"
      >
        <span>Next</span>
        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
    <div class="tool-sep" aria-hidden="true"></div>
    <div class="tool-group" role="group" aria-label="Edit">
      <button
        type="button"
        class="ghost tool-btn"
        onclick={splitSelectedAtPlayhead}
        disabled={!app.selectedClipId}
        title="Split selected clip at playhead (S)"
        aria-label="Split clip at playhead"
      >
        <Scissors size={15} strokeWidth={2} aria-hidden="true" />
        <span>Split</span>
      </button>
      <button
        type="button"
        class="ghost tool-btn"
        onclick={() => deleteSelectedClips()}
        disabled={!hasSelection}
        title="Delete selected clip(s) (Delete)"
        aria-label="Delete selected clips"
      >
        <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
        <span>Delete</span>
      </button>
    </div>
    <div class="tool-sep" aria-hidden="true"></div>
    <div class="tool-group" role="group" aria-label="Display">
      <button
        type="button"
        class="ghost tool-btn"
        class:on={app.showFilmstrips}
        onclick={onToggleFilmstrips}
        title={app.showFilmstrips
          ? "Hide filmstrips / audio waveforms (ffmpeg)"
          : "Show filmstrips / audio waveforms (ffmpeg)"}
        aria-label="Toggle filmstrips"
        aria-pressed={app.showFilmstrips}
      >
        {#if app.showFilmstrips}
          <Image size={15} strokeWidth={2} aria-hidden="true" />
        {:else}
          <ImageOff size={15} strokeWidth={2} aria-hidden="true" />
        {/if}
        <span>Thumbs</span>
      </button>
      <span class="tool-sep-inline" aria-hidden="true"></span>
      {#each ["s", "m", "l"] as size (size)}
        <button
          type="button"
          class="ghost tool-btn tool-btn-sq"
          class:on={app.trackRowSize === size}
          onclick={() => setTrackRowSize(size as TrackRowSize)}
          title={trackRowMetrics(size as TrackRowSize).title}
          aria-label={trackRowMetrics(size as TrackRowSize).title}
          aria-pressed={app.trackRowSize === size}
        >
          <span class="io-key">{trackRowMetrics(size as TrackRowSize).label}</span>
        </button>
      {/each}
    </div>
    <div class="tool-sep" aria-hidden="true"></div>
    <div class="tool-group" role="group" aria-label="Play range">
      <button
        type="button"
        class="ghost tool-btn"
        class:on={app.playIn != null}
        onclick={() => setPlayInAtPlayhead()}
        title="Set play-in at playhead (I) — preview only"
        aria-label="Set play in"
        aria-pressed={app.playIn != null}
      >
        <span class="io-key">I</span>
        <span>In</span>
      </button>
      <button
        type="button"
        class="ghost tool-btn"
        class:on={app.playOut != null}
        onclick={() => setPlayOutAtPlayhead()}
        title="Set play-out at playhead (O) — preview only"
        aria-label="Set play out"
        aria-pressed={app.playOut != null}
      >
        <span class="io-key">O</span>
        <span>Out</span>
      </button>
      <button
        type="button"
        class="ghost tool-btn"
        onclick={() => clearPlayRange()}
        disabled={!rangeActive}
        title="Clear play range (Esc)"
        aria-label="Clear play range"
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
        <span>Clear</span>
      </button>
      {#if rangeActive}
        <span class="mono tool-hint" title="Preview plays only this range; export is unchanged">
          {formatTimestamp(bounds.start)}–{formatTimestamp(bounds.end)}
        </span>
      {/if}
    </div>
    <div class="tool-sep" aria-hidden="true"></div>
    <div class="tool-group" role="group" aria-label="Markers">
      <button
        type="button"
        class="ghost tool-btn"
        onclick={() => addMarkerAtPlayhead()}
        title="Add marker at playhead (M) — click seek, double-click rename, Alt+click remove"
        aria-label="Add marker at playhead"
      >
        <BookmarkPlus size={15} strokeWidth={2} aria-hidden="true" />
        <span>Marker</span>
      </button>
      <span
        class="tool-hint muted"
        title="Markers are seek bookmarks (not exported). ⌥/Alt-drag duplicates clips."
      >
        dbl-click rename · ⌥-drag copy
      </span>
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
            {#if rangeActive && bounds.end > bounds.start}
              <div
                class="play-range"
                style:left="{bounds.start * pxPerSecond}px"
                style:width="{(bounds.end - bounds.start) * pxPerSecond}px"
                title="Play range {formatTimestamp(bounds.start)} – {formatTimestamp(bounds.end)} (preview only)"
                aria-hidden="true"
              ></div>
              {#if app.playIn != null}
                <div
                  class="play-io in"
                  style:left="{bounds.start * pxPerSecond}px"
                  aria-hidden="true"
                >
                  I
                </div>
              {/if}
              {#if app.playOut != null}
                <div
                  class="play-io out"
                  style:left="{bounds.end * pxPerSecond}px"
                  aria-hidden="true"
                >
                  O
                </div>
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
                  title="{marker.label} @ {formatTimestamp(marker.t)} — click seek, double-click rename, Alt+click remove"
                  aria-label="Marker {marker.label}"
                  onpointerdown={(e) => {
                    // Keep hits on the marker (not ruler scrub / playhead).
                    e.stopPropagation();
                    if (e.altKey) {
                      e.preventDefault();
                      deleteMarker(marker.id);
                      return;
                    }
                    // detail >= 2 is the 2nd click of a double-click — skip seek
                    // so the playhead doesn't jump under the cursor before rename.
                    if (e.detail >= 2) return;
                    setPlayhead(marker.t);
                    app.status = `Marker ${marker.label}`;
                  }}
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
                  {@const strip = filmstripForClip(clip)}
                  {@const wave = waveformForClip(clip)}
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

  /* Hit box covers stem + flag + label (not just the 2px line). */
  .marker {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: max-content;
    min-width: 1.75rem;
    max-width: 6rem;
    margin-left: -8px;
    padding: 1px 4px 0 3px;
    border: none;
    background: transparent;
    cursor: pointer;
    z-index: 5;
    box-sizing: border-box;
  }

  .marker::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 7px;
    width: 2px;
    background: var(--warn);
    opacity: 0.85;
    pointer-events: none;
  }

  .marker:hover::before {
    opacity: 1;
    box-shadow: 0 0 0 1px rgba(212, 160, 23, 0.35);
  }

  .marker-flag {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    width: 0;
    height: 0;
    margin-top: 0;
    border-left: 10px solid var(--warn);
    border-right: 0 solid transparent;
    border-bottom: 9px solid transparent;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45));
    pointer-events: none;
  }

  .marker-label {
    position: relative;
    z-index: 1;
    max-width: 5rem;
    margin-top: 1px;
    margin-left: 1px;
    padding: 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.65rem;
    font-weight: 600;
    line-height: 1.25;
    color: #1a1408;
    background: var(--warn);
    border-radius: 2px;
    pointer-events: none;
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
    width: 6.5rem;
    min-width: 4rem;
    max-width: 10rem;
    margin: 1px 0 0 1px;
    padding: 0.1em 0.3em;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.25;
    color: #1a1408;
    background: #ffe6a0;
    border: 1px solid #c4920f;
    border-radius: 3px;
    outline: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  }

  .marker-rename:focus {
    border-color: var(--accent);
  }

  .timeline-tools {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
    padding: 0.3rem 0.35rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .tool-group {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }

  .tool-sep {
    width: 1px;
    height: 1.35rem;
    background: var(--border);
    margin: 0 0.15rem;
  }

  .timeline-tools :global(.tool-btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 1.85rem;
    padding: 0.25em 0.55em;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .timeline-tools :global(.tool-btn.on) {
    color: var(--accent);
    border-color: var(--accent);
  }

  .timeline-tools :global(.tool-btn-sq) {
    min-width: 1.85rem;
    padding-left: 0.4em;
    padding-right: 0.4em;
    justify-content: center;
  }

  .tool-sep-inline {
    width: 1px;
    height: 1.2rem;
    background: var(--border);
    margin: 0 0.1rem;
  }

  .io-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .tool-hint {
    font-size: 0.72rem;
    max-width: 14rem;
    line-height: 1.2;
  }

  .play-range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(91, 140, 255, 0.18);
    border-left: 2px solid var(--accent);
    border-right: 2px solid var(--accent);
    pointer-events: none;
    z-index: 1;
  }

  .play-io {
    position: absolute;
    top: 1px;
    z-index: 2;
    min-width: 0.9rem;
    padding: 0 2px;
    font-size: 0.65rem;
    font-weight: 700;
    line-height: 1.15;
    color: #fff;
    background: var(--accent);
    border-radius: 2px;
    pointer-events: none;
    transform: translateX(-50%);
  }

  .play-io.in {
    transform: translateX(0);
  }

  .play-io.out {
    transform: translateX(-100%);
  }

  @media (max-width: 900px) {
    .tool-hint {
      display: none;
    }
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
  }

  .clip.has-filmstrip {
    background: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc(var(--clip-l) * 1%),
      0.18
    );
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
    background: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc(var(--clip-l) * 1%),
      0.4
    );
  }

  .clip.has-filmstrip:hover {
    background: hsla(
      var(--clip-h),
      calc(var(--clip-s) * 1%),
      calc(var(--clip-l) * 1%),
      0.22
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
    margin-left: 0.2rem;
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
    padding: 0 0.35rem;
    font-size: 0.75rem;
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

  /*
   * Wide grab target for the playhead — starts *below* the ruler so marker
   * flags/labels stay clickable after a seek lands the playhead on a marker.
   * Scrub in the ruler still works via the ruler surface itself.
   */
  .playhead-hit {
    position: absolute;
    top: 28px; /* = RULER_H */
    left: -5px;
    width: 12px;
    height: calc(100% - 28px);
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
