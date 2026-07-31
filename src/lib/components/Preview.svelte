<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";
  import { findClip } from "$lib/clips";
  import {
    clampSourceSeek,
    clipTimelineEnd,
    firstClipInSequence,
    nextClipAfter,
    shouldPrefetchNearCut,
    sourceTimeAt,
  } from "$lib/previewTime";
  import { cloneProject, projectDuration } from "$lib/project";
  import { clipAtTime } from "$lib/resolve";
  import { clamp } from "$lib/time";
  import { drawRect } from "$lib/transform";
  import type { Clip, ClipTransform, Project } from "$lib/types";
  import {
    app,
    commitProjectEdit,
    previewProject,
    project,
    replaceClip,
    selectClipOnly,
    setPlayhead,
    setPresentLive,
  } from "../../state/appState.svelte";

  /** Viewport zoom limits (wheel / trackpad). */
  const VIEW_ZOOM_MIN = 0.25;
  const VIEW_ZOOM_MAX = 8;
  /** Clip transform scale limits (Shift+drag). */
  const CLIP_SCALE_MIN = 0.05;
  const CLIP_SCALE_MAX = 8;
  /** Near end of trimmed source — treat as clip finished. */
  const CLIP_END_EPS = 1 / 30;
  /** Start warming the next clip this many seconds before the cut. */
  const PREFETCH_LEAD = 0.85;

  type Slot = {
    el: HTMLVideoElement | undefined;
    path: string | null;
    clipId: string | null;
    /** Seek target last applied (source seconds). */
    seekTo: number;
    /** True once loaded + seeked to seekTo with a decodable frame. */
    ready: boolean;
  };

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let videoA: HTMLVideoElement | undefined = $state();
  let videoB: HTMLVideoElement | undefined = $state();

  const slots: [Slot, Slot] = [
    { el: undefined, path: null, clipId: null, seekTo: 0, ready: false },
    { el: undefined, path: null, clipId: null, seekTo: 0, ready: false },
  ];
  let activeIdx = 0;
  /** Clip currently free-running on the active slot. */
  let playingClipId: string | null = null;
  let prefetchClipId: string | null = null;
  let prefetchGen = 0;
  let syncGen = 0;
  let rafId = 0;
  let lastRafMs = 0;
  /** Hold last painted frame across cuts instead of flashing black. */
  let holdFrame = false;

  // Clip transform drag (pan or Shift+scale; single undo entry on pointerup)
  type ClipDragMode = "pan" | "scale";
  let dragClipId: string | null = null;
  let dragBefore: Project | null = null;
  let dragMode: ClipDragMode = "pan";
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartScale = 1;
  let dragOriginClientX = 0;
  let dragOriginClientY = 0;
  let dragPointerId: number | null = null;
  let dragDidMove = false;
  let dragging = $state(false);
  let scaling = $state(false);

  // Viewport camera (UI only — not project data)
  let viewportEl: HTMLDivElement | undefined = $state();
  let viewZoom = $state(1);
  let viewPanX = $state(0);
  let viewPanY = $state(0);
  let viewFitW = $state(640);
  let viewFitH = $state(360);
  let panningView = $state(false);
  let viewPanPointerId: number | null = null;
  let viewPanOriginX = 0;
  let viewPanOriginY = 0;
  let viewPanStartX = 0;
  let viewPanStartY = 0;

  const p = $derived(project());
  const canvasW = $derived(Math.max(1, Math.round(p.canvas.width)));
  const canvasH = $derived(Math.max(1, Math.round(p.canvas.height)));
  /** Canvas is always interactive (viewport pan; modifiers for source ops). */
  const canTransform = true;
  /**
   * Base layout centers the stage in the viewport (left/top 50% + negative half margins).
   * Camera then only applies pan + zoom about the stage center.
   * Aspect ratio is locked to the project canvas (contain-fit).
   */
  const stageStyle = $derived(
    `width:${viewFitW}px;height:${viewFitH}px;` +
      `margin-left:${-viewFitW / 2}px;margin-top:${-viewFitH / 2}px;` +
      `transform:translate(${viewPanX}px,${viewPanY}px) scale(${viewZoom});` +
      `aspect-ratio:${canvasW} / ${canvasH};`,
  );

  function activeSlot(): Slot {
    return slots[activeIdx]!;
  }

  function standbySlot(): Slot {
    return slots[1 - activeIdx]!;
  }

  function bindSlots() {
    slots[0]!.el = videoA;
    slots[1]!.el = videoB;
  }

  function assetUrl(path: string): string {
    try {
      return convertFileSrc(path);
    } catch {
      return path;
    }
  }

  function srcDims(clip: Clip, el: HTMLVideoElement | undefined): { w: number; h: number } {
    const meta = app.metaByPath.get(clip.sourcePath);
    if (meta && meta.width > 0 && meta.height > 0) {
      return { w: meta.width, h: meta.height };
    }
    if (el && el.videoWidth > 0 && el.videoHeight > 0) {
      return { w: el.videoWidth, h: el.videoHeight };
    }
    return { w: 0, h: 0 };
  }

  function paintFrom(slot: Slot, clip: Clip): boolean {
    if (!canvasEl || !slot.el) return false;
    if (slot.el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
    if (slot.path !== clip.sourcePath) return false;

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return false;

    const w = canvasEl.width;
    const h = canvasEl.height;
    const dims = srcDims(clip, slot.el);
    if (dims.w <= 0 || dims.h <= 0) return false;

    const rect = drawRect(dims.w, dims.h, w, h, clip.transform);
    if (rect.w <= 0 || rect.h <= 0) return false;

    try {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(slot.el, rect.x, rect.y, rect.w, rect.h);
      holdFrame = true;
      return true;
    } catch {
      return false;
    }
  }

  function paintBlack() {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    holdFrame = false;
  }

  function paint() {
    if (!canvasEl) return;
    const hit = clipAtTime(previewProject(), app.playhead);

    // Timeline gap — show real black
    if (!hit) {
      paintBlack();
      return;
    }

    const clip = hit.clip;
    const active = activeSlot();
    if (paintFrom(active, clip)) return;

    // Standby already has this clip (prefetched) — draw it during/after swap
    const stand = standbySlot();
    if (stand.clipId === clip.id && paintFrom(stand, clip)) return;

    // Loading / seeking: keep previous frame instead of flashing black
    if (holdFrame) return;

    paintBlack();
  }

  function applyClipTransform(base: Project, clipId: string, transform: ClipTransform): Project {
    const found = findClip(base, clipId);
    if (!found) return base;
    return replaceClip(base, clipId, {
      ...found.clip,
      transform,
    });
  }

  function applyAudioState() {
    for (const s of slots) {
      if (!s.el) continue;
      // Only the active free-running slot should make sound.
      const isActive = s === activeSlot() && playingClipId != null && s.clipId === playingClipId;
      s.el.muted = app.previewMuted || !app.playing || !isActive;
      if (s.el.volume !== 1) s.el.volume = 1;
    }
  }

  function waitEvent(el: HTMLVideoElement, event: string, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener(event, finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      el.addEventListener(event, finish);
    });
  }

  /** Wait until the element has a decodable frame (import often races paint before this). */
  function waitForFrame(el: HTMLVideoElement, timeoutMs = 4000): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener("loadeddata", onReady);
        el.removeEventListener("canplay", onReady);
        el.removeEventListener("seeked", onReady);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);

      const anyEl = el as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (typeof anyEl.requestVideoFrameCallback === "function") {
        anyEl.requestVideoFrameCallback(() => finish());
        // Still arm media events in case RVFC is delayed while paused
      }

      const onReady = () => {
        if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && el.videoWidth > 0) {
          // Two rAFs: first layout, second after the browser presents the frame
          requestAnimationFrame(() => requestAnimationFrame(finish));
        }
      };
      el.addEventListener("loadeddata", onReady);
      el.addEventListener("canplay", onReady);
      el.addEventListener("seeked", onReady);
      onReady();
    });
  }

  async function loadPath(slot: Slot, path: string): Promise<boolean> {
    const el = slot.el;
    if (!el) return false;
    if (slot.path === path && el.src && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return true;
    }

    slot.ready = false;
    slot.path = path;
    el.pause();
    el.src = assetUrl(path);
    el.load();
    await waitEvent(el, "loadeddata");
    if (slot.path !== path) return false;
    if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitEvent(el, "canplay", 4000);
    }
    await waitForFrame(el);
    return slot.path === path;
  }

  async function seekSlot(slot: Slot, t: number, _force = false): Promise<void> {
    const el = slot.el;
    if (!el) return;
    const target = Math.max(0, t);
    slot.seekTo = target;
    slot.ready = false;

    // Already there — many engines won't fire `seeked` if currentTime is unchanged
    if (Math.abs(el.currentTime - target) > 0.01) {
      const p = waitEvent(el, "seeked", 4000);
      try {
        el.currentTime = target;
      } catch {
        return;
      }
      await p;
    }

    await waitForFrame(el);
    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && el.videoWidth > 0) {
      slot.ready = true;
    }
  }

  /**
   * Prepare a slot for a clip at a source time. Standby stays paused+muted.
   * `valid()` must stay true across awaits (gen tokens).
   */
  async function prepareSlot(
    slot: Slot,
    clip: Clip,
    sourceT: number,
    opts: { play: boolean; valid: () => boolean },
  ): Promise<boolean> {
    if (!slot.el) return false;
    slot.clipId = clip.id;
    slot.ready = false;

    const ok = await loadPath(slot, clip.sourcePath);
    if (!ok || !opts.valid()) return false;

    const st = clampSourceSeek(clip, sourceT, CLIP_END_EPS);
    await seekSlot(slot, st, true);
    if (!opts.valid() || slot.clipId !== clip.id) return false;

    slot.ready =
      slot.el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && slot.el.videoWidth > 0;
    if (!slot.ready) return false;

    if (opts.play && app.playing) {
      slot.el.muted = app.previewMuted;
      void slot.el.play().catch(() => {});
    } else {
      slot.el.pause();
      slot.el.muted = true;
    }
    return true;
  }

  /** Paint when a decoder emits a frame for the current still/playhead (fixes import black frame). */
  function onDecoderFrame() {
    if (app.playing) return;
    bindSlots();
    const hit = clipAtTime(previewProject(), app.playhead);
    if (!hit) return;
    const active = activeSlot();
    if (active.path === hit.clip.sourcePath && active.el) {
      if (active.el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        active.ready = true;
        paint();
      }
    }
  }

  async function syncPaused() {
    playingClipId = null;
    prefetchClipId = null;
    prefetchGen++;
    const gen = ++syncGen;
    bindSlots();

    const hit = clipAtTime(previewProject(), app.playhead);
    const active = activeSlot();
    standbySlot().el?.pause();

    if (!hit) {
      active.el?.pause();
      // Only clear if nothing is on the timeline at the playhead
      paintBlack();
      return;
    }

    const st = sourceTimeAt(hit.clip, app.playhead);
    const ok = await prepareSlot(active, hit.clip, st, {
      play: false,
      valid: () => gen === syncGen,
    });
    if (!ok || gen !== syncGen) return;
    active.el?.pause();
    applyAudioState();
    // Force redraw after the decoder has a frame (import used to leave a black canvas
    // until the next scrub/play interaction re-entered this path).
    paint();
    requestAnimationFrame(() => {
      if (gen === syncGen) paint();
    });
  }

  /** Warm standby with the upcoming clip at its sourceIn. */
  function schedulePrefetch(fromClip: Clip) {
    const proj = previewProject();
    // With loop on, the sequence's first clip follows the last one — warm it like any cut.
    const next =
      nextClipAfter(proj, fromClip) ?? (app.loopPlayback ? firstClipInSequence(proj) : null);
    if (!next) {
      prefetchClipId = null;
      return;
    }
    if (prefetchClipId === next.id && standbySlot().clipId === next.id && standbySlot().ready) {
      return;
    }
    prefetchClipId = next.id;
    const gen = ++prefetchGen;
    const stand = standbySlot();
    void prepareSlot(stand, next, next.sourceIn, {
      play: false,
      valid: () => gen === prefetchGen && app.playing,
    }).then((ok) => {
      if (!ok || gen !== prefetchGen) return;
      stand.el?.pause();
      if (stand.el) stand.el.muted = true;
    });
  }

  function swapToStandby(nextClip: Clip): boolean {
    const stand = standbySlot();
    if (stand.clipId !== nextClip.id || !stand.ready || !stand.el) return false;

    const prev = activeSlot();
    prev.el?.pause();
    if (prev.el) prev.el.muted = true;

    activeIdx = (1 - activeIdx) as 0 | 1;
    playingClipId = nextClip.id;

    const active = activeSlot();
    if (active.el) {
      // Already seeked to sourceIn from prefetch — play immediately
      active.el.muted = app.previewMuted;
      void active.el.play().catch(() => {});
    }
    applyAudioState();
    paint();

    schedulePrefetch(nextClip);
    return true;
  }

  async function startClipPlayback(clip: Clip, gen: number): Promise<void> {
    bindSlots();
    if (!app.playing) return;

    // Prefer prefetched standby (seamless cut)
    if (swapToStandby(clip)) return;

    // Same-file continuation on active: seek without reload
    const active = activeSlot();
    if (
      active.path === clip.sourcePath &&
      active.el &&
      active.el.readyState >= HTMLMediaElement.HAVE_METADATA
    ) {
      playingClipId = clip.id;
      active.clipId = clip.id;
      const st = clampSourceSeek(clip, sourceTimeAt(clip, app.playhead), CLIP_END_EPS);
      await seekSlot(active, st, true);
      if (!app.playing || gen !== syncGen) {
        if (playingClipId === clip.id) playingClipId = null;
        return;
      }
      active.ready = true;
      applyAudioState();
      void active.el.play().catch(() => {});
      paint();
      schedulePrefetch(clip);
      return;
    }

    // Cold start on active (first clip / cache miss)
    playingClipId = clip.id;
    const st = clampSourceSeek(clip, sourceTimeAt(clip, app.playhead), CLIP_END_EPS);
    const ok = await prepareSlot(active, clip, st, {
      play: true,
      valid: () => gen === syncGen && app.playing,
    });
    if (!ok || !app.playing || gen !== syncGen) {
      if (playingClipId === clip.id) playingClipId = null;
      return;
    }
    paint();
    schedulePrefetch(clip);
  }

  function stopRaf() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastRafMs = 0;
  }

  function stopPlayback(at: number, status: string) {
    setPlayhead(at);
    app.playing = false;
    app.status = status;
    playingClipId = null;
    prefetchClipId = null;
    for (const s of slots) {
      s.el?.pause();
    }
    applyAudioState();
    paint();
    stopRaf();
  }

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

  function tick(now: number) {
    if (!app.playing) {
      rafId = 0;
      lastRafMs = 0;
      return;
    }

    bindSlots();
    if (lastRafMs === 0) lastRafMs = now;
    const wallDt = Math.min(0.25, (now - lastRafMs) / 1000);
    lastRafMs = now;

    const proj = previewProject();
    const totalDur = projectDuration(project());
    if (!(totalDur > 0)) {
      stopPlayback(0, "Paused");
      return;
    }

    let t = app.playhead;
    const hit = clipAtTime(proj, t);
    const active = activeSlot();

    if (hit && active.el) {
      const clip = hit.clip;
      const end = clipTimelineEnd(clip);

      if (playingClipId !== clip.id) {
        const gen = ++syncGen;
        void startClipPlayback(clip, gen);
        paint();
      } else if (active.el.seeking) {
        paint(); // hold frame
      } else if (active.el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const vidT = active.el.currentTime;
        const pastOut = vidT >= clip.sourceOut - CLIP_END_EPS;
        const ended = active.el.ended;

        if (pastOut || ended) {
          t = end;
          active.el.pause();
          // Instant swap if prefetched
          const next = nextClipAfter(proj, clip);
          playingClipId = null;
          if (next && swapToStandby(next)) {
            // playhead at cut; free-run continues on new active
            t = next.timelineStart;
          }
        } else {
          t = clip.timelineStart + Math.max(0, vidT - clip.sourceIn);
          // Prefetch near the cut
          if (shouldPrefetchNearCut(clip.sourceOut, vidT, PREFETCH_LEAD)) {
            schedulePrefetch(clip);
          }
          if (active.el.paused) {
            applyAudioState();
            void active.el.play().catch(() => {});
          }
        }
        paint();
      } else {
        paint();
      }
    } else {
      // Black gap
      playingClipId = null;
      active.el?.pause();
      t = t + wallDt;
      holdFrame = false;
      paint();
      // Prefetch whatever starts after this gap
      const upcoming = clipAtTime(proj, t + 0.01);
      if (upcoming && standbySlot().clipId !== upcoming.clip.id) {
        const gen = ++prefetchGen;
        prefetchClipId = upcoming.clip.id;
        void prepareSlot(standbySlot(), upcoming.clip, upcoming.clip.sourceIn, {
          play: false,
          valid: () => gen === prefetchGen && app.playing,
        });
      }
    }

    if (t >= totalDur - 1e-6) {
      if (!app.loopPlayback) {
        stopPlayback(totalDur, "Paused");
        return;
      }
      // wrapToStart sets the playhead itself — skip the setPlayhead(t) below.
      wrapToStart();
      rafId = requestAnimationFrame(tick);
      return;
    }

    if (Math.abs(t - app.playhead) > 1e-4) setPlayhead(t);
    rafId = requestAnimationFrame(tick);
  }

  function startRaf() {
    if (rafId) return;
    lastRafMs = 0;
    rafId = requestAnimationFrame(tick);
  }

  // Playback loop
  $effect(() => {
    bindSlots();
    if (app.playing) {
      playingClipId = null;
      prefetchClipId = null;
      applyAudioState();
      startRaf();
      return () => {
        stopRaf();
        playingClipId = null;
      };
    }
    stopRaf();
    playingClipId = null;
    prefetchClipId = null;
    for (const s of slots) s.el?.pause();
    applyAudioState();
  });

  // Still-frame when paused
  $effect(() => {
    if (app.playing) return;
    void app.playhead;
    void project();
    void app.metaByPath;
    void videoA;
    void videoB;
    void syncPaused();
  });

  $effect(() => {
    void app.previewMuted;
    applyAudioState();
  });

  $effect(() => {
    if (!canvasEl) return;
    if (canvasEl.width !== canvasW) canvasEl.width = canvasW;
    if (canvasEl.height !== canvasH) canvasEl.height = canvasH;
    paint();
  });

  /**
   * Contain-fit project canvas into the viewport (zoom=1 size).
   * Preserves exact project aspect ratio (no nonuniform stretch).
   */
  function updateViewFit() {
    if (!viewportEl) return;
    const vw = Math.max(1, viewportEl.clientWidth);
    const vh = Math.max(1, viewportEl.clientHeight);
    const s = Math.min(vw / canvasW, vh / canvasH);
    // Floor the longer side, then derive the other from aspect for pixel-stable ratios
    const aspect = canvasW / canvasH;
    let w = Math.max(1, Math.floor(canvasW * s));
    let h = Math.max(1, Math.round(w / aspect));
    if (h > vh) {
      h = Math.max(1, Math.floor(canvasH * s));
      w = Math.max(1, Math.round(h * aspect));
    }
    viewFitW = w;
    viewFitH = h;
  }

  $effect(() => {
    void canvasW;
    void canvasH;
    void viewportEl;
    updateViewFit();
  });

  $effect(() => {
    if (!viewportEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateViewFit());
    ro.observe(viewportEl);
    return () => ro.disconnect();
  });

  /** Contain-fit project size into the viewport and center the camera. */
  function resetViewport() {
    updateViewFit();
    viewZoom = 1;
    viewPanX = 0;
    viewPanY = 0;
    app.status = "Viewport fit";
  }

  /** Client px → project canvas px (accounts for viewport zoom + fit). */
  function canvasScale(): { sx: number; sy: number } {
    if (!canvasEl) return { sx: 1, sy: 1 };
    const rect = canvasEl.getBoundingClientRect();
    return {
      sx: rect.width > 0 ? canvasEl.width / rect.width : 1,
      sy: rect.height > 0 ? canvasEl.height / rect.height : 1,
    };
  }

  function detachDragListeners() {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
  }

  function detachViewPanListeners() {
    window.removeEventListener("pointermove", onViewPanMove);
    window.removeEventListener("pointerup", onViewPanUp);
    window.removeEventListener("pointercancel", onViewPanUp);
  }

  function clearDrag() {
    dragClipId = null;
    dragBefore = null;
    dragMode = "pan";
    dragPointerId = null;
    dragDidMove = false;
    dragging = false;
    scaling = false;
  }

  /**
   * Transform gestures target the hard-cut winner at the playhead (what is painted),
   * not a covered selection on a lower track.
   */
  function transformTargetClip(): Clip | null {
    return clipAtTime(previewProject(), app.playhead)?.clip ?? null;
  }

  function startViewPan(e: PointerEvent) {
    e.preventDefault();
    if (panningView) detachViewPanListeners();
    panningView = true;
    viewPanPointerId = e.pointerId;
    viewPanOriginX = e.clientX;
    viewPanOriginY = e.clientY;
    viewPanStartX = viewPanX;
    viewPanStartY = viewPanY;
    window.addEventListener("pointermove", onViewPanMove);
    window.addEventListener("pointerup", onViewPanUp);
    window.addEventListener("pointercancel", onViewPanUp);
  }

  function onViewPanMove(e: PointerEvent) {
    if (!panningView) return;
    if (viewPanPointerId !== null && e.pointerId !== viewPanPointerId) return;
    viewPanX = viewPanStartX + (e.clientX - viewPanOriginX);
    viewPanY = viewPanStartY + (e.clientY - viewPanOriginY);
  }

  function onViewPanUp(e: PointerEvent) {
    if (viewPanPointerId !== null && e.pointerId !== viewPanPointerId) return;
    panningView = false;
    viewPanPointerId = null;
    detachViewPanListeners();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;

    // Clip ops: Shift = scale, Ctrl/Cmd = move source on canvas
    const scaleMode = e.button === 0 && e.shiftKey && !e.altKey;
    const moveMode = e.button === 0 && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;

    if (scaleMode || moveMode) {
      const clip = transformTargetClip();
      if (!clip) {
        // No clip under playhead / selection — fall through to viewport pan
        if (e.button === 0) startViewPan(e);
        return;
      }

      e.preventDefault();
      if (panningView) {
        detachViewPanListeners();
        panningView = false;
      }
      if (dragClipId) {
        detachDragListeners();
        clearDrag();
      }

      if (app.selectedClipId !== clip.id) {
        selectClipOnly(clip.id);
      }

      dragClipId = clip.id;
      dragMode = scaleMode ? "scale" : "pan";
      dragBefore = cloneProject(project());
      dragStartX = clip.transform.x;
      dragStartY = clip.transform.y;
      dragStartScale = clip.transform.scale;
      dragOriginClientX = e.clientX;
      dragOriginClientY = e.clientY;
      dragPointerId = e.pointerId;
      dragDidMove = false;
      dragging = dragMode === "pan";
      scaling = dragMode === "scale";

      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
      window.addEventListener("pointercancel", onWindowPointerCancel);
      return;
    }

    // Default: pan the viewport (left drag, middle, or Alt+left)
    if (e.button === 1 || e.button === 0) {
      if (dragClipId) {
        detachDragListeners();
        clearDrag();
      }
      startViewPan(e);
    }
  }

  function onWindowPointerMove(e: PointerEvent) {
    if (!dragClipId || !dragBefore) return;
    if (dragPointerId !== null && e.pointerId !== dragPointerId) return;

    const clientDx = e.clientX - dragOriginClientX;
    const clientDy = e.clientY - dragOriginClientY;
    if (!dragDidMove && Math.hypot(clientDx, clientDy) < 2) return;
    dragDidMove = true;

    const found = findClip(dragBefore, dragClipId);
    if (!found) return;

    if (dragMode === "scale") {
      // Right / up grows; exponential so fine near 1× and usable far out
      const delta = clientDx - clientDy;
      const scale = clamp(
        dragStartScale * Math.exp(delta * 0.004),
        CLIP_SCALE_MIN,
        CLIP_SCALE_MAX,
      );
      const transform: ClipTransform = {
        ...found.clip.transform,
        scale,
      };
      setPresentLive(applyClipTransform(dragBefore, dragClipId, transform));
      paint();
      return;
    }

    const { sx, sy } = canvasScale();
    const dx = clientDx * sx;
    const dy = clientDy * sy;
    const transform: ClipTransform = {
      ...found.clip.transform,
      x: dragStartX + dx,
      y: dragStartY + dy,
    };
    setPresentLive(applyClipTransform(dragBefore, dragClipId, transform));
    paint();
  }

  function finishDrag(e: PointerEvent) {
    if (!dragClipId || !dragBefore) return;
    if (dragPointerId !== null && e.pointerId !== dragPointerId) return;

    const before = dragBefore;
    const after = project();
    const moved = dragDidMove;
    const mode = dragMode;

    detachDragListeners();
    clearDrag();

    if (!moved) return;

    if (commitProjectEdit(before, after)) {
      app.status = mode === "scale" ? "Scaled transform" : "Moved transform";
    }
    paint();
  }

  function onWindowPointerUp(e: PointerEvent) {
    finishDrag(e);
  }

  function onWindowPointerCancel(e: PointerEvent) {
    if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
    if (dragBefore && dragDidMove) {
      app.history = { ...app.history, present: dragBefore };
    }
    detachDragListeners();
    clearDrag();
    paint();
  }

  /**
   * Wheel / trackpad: zoom the viewport (not clip scale).
   * Zoom toward cursor. Double-click the viewport resets fit.
   */
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (!viewportEl) return;

    // Pinch-zoom on trackpads often sets ctrlKey; treat as zoom either way.
    // Shift+wheel pans horizontally/vertically without zooming.
    if (e.shiftKey) {
      viewPanX -= e.deltaX || e.deltaY;
      viewPanY -= e.deltaY && e.deltaX ? e.deltaY : e.deltaX ? 0 : e.deltaY;
      return;
    }

    const rect = viewportEl.getBoundingClientRect();
    // Cursor relative to viewport center (stage is centered)
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;

    // Smooth trackpad deltas; clamp step for mouse wheels
    const raw = e.deltaY;
    const factor =
      Math.abs(raw) > 40
        ? raw > 0
          ? 0.9
          : 1.11
        : Math.exp(-raw * 0.002);

    const oldZoom = viewZoom;
    const newZoom = clamp(oldZoom * factor, VIEW_ZOOM_MIN, VIEW_ZOOM_MAX);
    if (newZoom === oldZoom) return;

    // Keep the point under the cursor fixed in world space
    const lx = (mx - viewPanX) / oldZoom;
    const ly = (my - viewPanY) / oldZoom;
    viewZoom = newZoom;
    viewPanX = mx - lx * newZoom;
    viewPanY = my - ly * newZoom;
  }

  function onViewportDblClick() {
    resetViewport();
  }

  onDestroy(() => {
    stopRaf();
    detachDragListeners();
    detachViewPanListeners();
    videoA?.pause();
    videoB?.pause();
  });
</script>

<div class="preview-frame" aria-label="Preview">
  <div
    class="viewport"
    class:panning={panningView}
    bind:this={viewportEl}
    onwheel={onWheel}
    ondblclick={onViewportDblClick}
    role="presentation"
  >
    <div class="stage" style={stageStyle}>
      <div class="output-frame" title="Output {canvasW}×{canvasH}">
        <canvas
          bind:this={canvasEl}
          width={canvasW}
          height={canvasH}
          class:interactive={canTransform}
          class:dragging
          class:scaling
          onpointerdown={onPointerDown}
        ></canvas>
        <div class="frame-label mono" aria-hidden="true">{canvasW}×{canvasH}</div>
      </div>
    </div>
  </div>
  <div class="view-hud">
    {#if viewZoom !== 1 || viewPanX !== 0 || viewPanY !== 0}
      <span class="mono">{Math.round(viewZoom * 100)}%</span>
      <button type="button" class="ghost fit-btn" onclick={resetViewport} title="Fit & center (double-click)">
        Fit
      </button>
    {:else}
      <span class="mono muted-hud">fit</span>
    {/if}
  </div>
  <!-- Dual decoders: active free-runs, standby prefetches the next cut -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoA}
    class="decoder"
    playsinline
    preload="auto"
    onloadeddata={onDecoderFrame}
    onseeked={onDecoderFrame}
    oncanplay={onDecoderFrame}
  ></video>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoB}
    class="decoder"
    playsinline
    preload="auto"
    onloadeddata={onDecoderFrame}
    onseeked={onDecoderFrame}
    oncanplay={onDecoderFrame}
  ></video>
</div>

<style>
  .preview-frame {
    flex: 1;
    min-height: 200px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    position: relative;
  }

  .viewport {
    flex: 1;
    min-height: 0;
    min-width: 0;
    position: relative;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    /* Chrome outside the output frame — not pure black so the project rect reads clearly */
    background-color: #1a1a1e;
    background-image:
      linear-gradient(45deg, #222228 25%, transparent 25%),
      linear-gradient(-45deg, #222228 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #222228 75%),
      linear-gradient(-45deg, transparent 75%, #222228 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }

  .viewport.panning {
    cursor: grabbing;
  }

  .stage {
    position: absolute;
    left: 50%;
    top: 50%;
    transform-origin: center center;
    will-change: transform;
    /* Lock box sizing so aspect-ratio + explicit size stay consistent */
    box-sizing: border-box;
  }

  .output-frame {
    position: relative;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    /* Clear “this is the export rectangle” chrome */
    outline: 1px solid rgba(255, 255, 255, 0.55);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.65),
      0 8px 28px rgba(0, 0, 0, 0.45);
    background: #000;
    overflow: hidden;
  }

  .frame-label {
    position: absolute;
    top: 0.3rem;
    left: 0.35rem;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.55);
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.65rem;
    letter-spacing: 0.02em;
    pointer-events: none;
    z-index: 1;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* Project pixels only — no letterbox stretch */
    object-fit: fill;
    background: #000;
    cursor: default;
    touch-action: none;
  }

  canvas.interactive {
    cursor: grab;
  }

  canvas.dragging {
    cursor: move;
  }

  canvas.scaling {
    cursor: nwse-resize;
  }

  .view-hud {
    position: absolute;
    right: 0.5rem;
    bottom: 0.45rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.35rem;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--muted);
    z-index: 2;
  }

  .view-hud .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    min-width: 2.5rem;
    text-align: right;
    color: var(--text);
  }

  .view-hud .muted-hud {
    opacity: 0.7;
    min-width: auto;
  }

  .fit-btn {
    padding: 0.15em 0.45em;
    font-size: 0.75rem;
  }

  .decoder {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
  }
</style>
