<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";
  import { findClip } from "$lib/clips";
  import { clipDuration, cloneProject, projectDuration } from "$lib/project";
  import { clipAtTime } from "$lib/resolve";
  import { clamp } from "$lib/time";
  import { drawRect } from "$lib/transform";
  import type { Clip, ClipTransform, Project } from "$lib/types";
  import {
    app,
    commitProject,
    project,
    replaceClip,
    selectedClip,
    setPlayhead,
  } from "../../state/appState.svelte";

  const SCALE_MIN = 0.05;
  const SCALE_MAX = 8;
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

  // Transform pan drag (single undo entry on pointerup)
  let dragClipId: string | null = null;
  let dragBefore: Project | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginClientX = 0;
  let dragOriginClientY = 0;
  let dragPointerId: number | null = null;
  let dragDidMove = false;
  let dragging = $state(false);

  const p = $derived(project());
  const canvasW = $derived(Math.max(1, Math.round(p.canvas.width)));
  const canvasH = $derived(Math.max(1, Math.round(p.canvas.height)));
  const canTransform = $derived(!!selectedClip());

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

  function sourceTime(clip: Clip, t: number): number {
    return clip.sourceIn + (t - clip.timelineStart);
  }

  function clipEnd(clip: Clip): number {
    return clip.timelineStart + clipDuration(clip);
  }

  /** Clip that starts at or after this clip's exclusive timeline end (skipping black). */
  function nextClipAfter(proj: Project, clip: Clip): Clip | null {
    let t = clipEnd(clip);
    const total = projectDuration(proj);
    // Walk past black gaps a bit so we find the next media cut.
    for (let i = 0; i < 8 && t < total; i++) {
      const hit = clipAtTime(proj, t);
      if (hit) return hit.clip;
      // Jump to next critical time: sample slightly forward
      t += 1 / 60;
    }
    return null;
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
    const hit = clipAtTime(project(), app.playhead);

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

  function setPresentLive(next: Project) {
    app.history = { ...app.history, present: next };
    app.dirty = true;
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

  async function loadPath(slot: Slot, path: string): Promise<boolean> {
    const el = slot.el;
    if (!el) return false;
    if (slot.path === path && el.src) return true;

    slot.ready = false;
    slot.path = path;
    el.pause();
    el.src = assetUrl(path);
    el.load();
    await waitEvent(el, "loadeddata");
    return slot.path === path;
  }

  async function seekSlot(slot: Slot, t: number, force = false): Promise<void> {
    const el = slot.el;
    if (!el) return;
    const target = Math.max(0, t);
    slot.seekTo = target;

    // Already there — many engines won't fire `seeked` if currentTime is unchanged
    if (Math.abs(el.currentTime - target) <= 0.01) {
      if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) slot.ready = true;
      return;
    }
    if (!force && slot.ready) {
      // Non-force and close enough handled above; fall through only when far
    }

    slot.ready = false;
    const p = waitEvent(el, "seeked", 4000);
    try {
      el.currentTime = target;
    } catch {
      return;
    }
    await p;
    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
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

    const st = clamp(
      sourceT,
      clip.sourceIn,
      Math.max(clip.sourceIn, clip.sourceOut - CLIP_END_EPS),
    );
    await seekSlot(slot, st, true);
    if (!opts.valid() || slot.clipId !== clip.id) return false;

    slot.ready = slot.el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
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

  async function syncPaused() {
    playingClipId = null;
    prefetchClipId = null;
    prefetchGen++;
    const gen = ++syncGen;
    bindSlots();

    const hit = clipAtTime(project(), app.playhead);
    const active = activeSlot();
    standbySlot().el?.pause();

    if (!hit) {
      active.el?.pause();
      paintBlack();
      return;
    }

    const st = sourceTime(hit.clip, app.playhead);
    const ok = await prepareSlot(active, hit.clip, st, {
      play: false,
      valid: () => gen === syncGen,
    });
    if (!ok || gen !== syncGen) return;
    active.el?.pause();
    applyAudioState();
    paint();
  }

  /** Warm standby with the upcoming clip at its sourceIn. */
  function schedulePrefetch(fromClip: Clip) {
    const proj = project();
    const next = nextClipAfter(proj, fromClip);
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
      const local = app.playhead - clip.timelineStart;
      const st = clamp(
        clip.sourceIn + local,
        clip.sourceIn,
        Math.max(clip.sourceIn, clip.sourceOut - CLIP_END_EPS),
      );
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
    const local = app.playhead - clip.timelineStart;
    const st = clamp(
      clip.sourceIn + local,
      clip.sourceIn,
      Math.max(clip.sourceIn, clip.sourceOut - CLIP_END_EPS),
    );
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

    const proj = project();
    const totalDur = projectDuration(proj);
    if (!(totalDur > 0)) {
      stopPlayback(0, "Paused");
      return;
    }

    let t = app.playhead;
    const hit = clipAtTime(proj, t);
    const active = activeSlot();

    if (hit && active.el) {
      const clip = hit.clip;
      const end = clipEnd(clip);

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
          if (clip.sourceOut - vidT <= PREFETCH_LEAD) {
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
      stopPlayback(totalDur, "Paused");
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

  function clearDrag() {
    dragClipId = null;
    dragBefore = null;
    dragPointerId = null;
    dragDidMove = false;
    dragging = false;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const clip = selectedClip();
    if (!clip) return;

    e.preventDefault();
    if (dragClipId) {
      detachDragListeners();
      clearDrag();
    }

    dragClipId = clip.id;
    dragBefore = cloneProject(project());
    dragStartX = clip.transform.x;
    dragStartY = clip.transform.y;
    dragOriginClientX = e.clientX;
    dragOriginClientY = e.clientY;
    dragPointerId = e.pointerId;
    dragDidMove = false;
    dragging = true;

    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
  }

  function onWindowPointerMove(e: PointerEvent) {
    if (!dragClipId || !dragBefore) return;
    if (dragPointerId !== null && e.pointerId !== dragPointerId) return;

    const { sx, sy } = canvasScale();
    const dx = (e.clientX - dragOriginClientX) * sx;
    const dy = (e.clientY - dragOriginClientY) * sy;
    if (!dragDidMove && Math.hypot(dx, dy) < 2) return;
    dragDidMove = true;

    const found = findClip(dragBefore, dragClipId);
    if (!found) return;

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

    detachDragListeners();
    clearDrag();

    if (!moved) return;

    app.history = {
      past: [...app.history.past, before].slice(-50),
      present: after,
      future: [],
    };
    app.dirty = true;
    app.status = "Moved transform";
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

  function onWheel(e: WheelEvent) {
    const clip = selectedClip();
    if (!clip) return;
    e.preventDefault();

    const factor = e.deltaY > 0 ? 0.95 : 1.05;
    const scale = clamp(clip.transform.scale * factor, SCALE_MIN, SCALE_MAX);
    if (scale === clip.transform.scale) return;

    commitProject(
      applyClipTransform(project(), clip.id, {
        ...clip.transform,
        scale,
      }),
    );
    app.status = "Scaled transform";
    paint();
  }

  onDestroy(() => {
    stopRaf();
    detachDragListeners();
    videoA?.pause();
    videoB?.pause();
  });
</script>

<div class="preview-frame" aria-label="Preview">
  <canvas
    bind:this={canvasEl}
    width={canvasW}
    height={canvasH}
    class:interactive={canTransform}
    class:dragging
    onpointerdown={onPointerDown}
    onwheel={onWheel}
  ></canvas>
  <!-- Dual decoders: active free-runs, standby prefetches the next cut -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={videoA} class="decoder" playsinline preload="auto"></video>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={videoB} class="decoder" playsinline preload="auto"></video>
</div>

<style>
  .preview-frame {
    flex: 1;
    min-height: 200px;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    position: relative;
  }

  canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    background: #000;
    cursor: default;
    touch-action: none;
  }

  canvas.interactive {
    cursor: grab;
  }

  canvas.dragging {
    cursor: grabbing;
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
