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
  /** Near end of trimmed source — treat as clip finished (1 frame @ 30fps). */
  const CLIP_END_EPS = 1 / 30;

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let videoEl: HTMLVideoElement | undefined = $state();

  let loadedPath: string | null = null;
  /** Clip id currently free-running under play() — re-seek only when this changes. */
  let playingClipId: string | null = null;
  let syncGen = 0;
  let rafId = 0;
  let lastRafMs = 0;

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

  function srcDims(clip: Clip): { w: number; h: number } {
    const meta = app.metaByPath.get(clip.sourcePath);
    if (meta && meta.width > 0 && meta.height > 0) {
      return { w: meta.width, h: meta.height };
    }
    if (videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      return { w: videoEl.videoWidth, h: videoEl.videoHeight };
    }
    return { w: 0, h: 0 };
  }

  function paint() {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    const hit = clipAtTime(project(), app.playhead);
    if (!hit || !videoEl) return;
    if (videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (loadedPath !== hit.clip.sourcePath) return;

    const dims = srcDims(hit.clip);
    if (dims.w <= 0 || dims.h <= 0) return;

    const rect = drawRect(dims.w, dims.h, w, h, hit.clip.transform);
    if (rect.w <= 0 || rect.h <= 0) return;

    try {
      ctx.drawImage(videoEl, rect.x, rect.y, rect.w, rect.h);
    } catch {
      // Frame not decodable yet
    }
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

  /** Hear clip audio while playing (unless user muted); stay silent while paused/scrubbing. */
  function applyAudioState() {
    if (!videoEl) return;
    videoEl.muted = app.previewMuted || !app.playing;
    if (videoEl.volume !== 1) videoEl.volume = 1;
  }

  async function ensureVideo(path: string, gen: number): Promise<boolean> {
    if (!videoEl) return false;
    if (loadedPath === path && videoEl.src) {
      applyAudioState();
      return gen === syncGen;
    }

    loadedPath = path;
    videoEl.pause();
    videoEl.src = assetUrl(path);
    videoEl.load();
    applyAudioState();

    await new Promise<void>((resolve) => {
      const el = videoEl;
      if (!el) {
        resolve();
        return;
      }
      const done = () => {
        el.removeEventListener("loadeddata", done);
        el.removeEventListener("error", done);
        resolve();
      };
      el.addEventListener("loadeddata", done);
      el.addEventListener("error", done);
    });

    return gen === syncGen && loadedPath === path;
  }

  async function seekVideo(t: number, gen: number, force = false): Promise<void> {
    if (!videoEl) return;
    if (!force && Math.abs(videoEl.currentTime - t) <= 0.01) return;

    await new Promise<void>((resolve) => {
      const el = videoEl;
      if (!el) {
        resolve();
        return;
      }
      const done = () => {
        el.removeEventListener("seeked", done);
        resolve();
      };
      el.addEventListener("seeked", done);
      try {
        el.currentTime = Math.max(0, t);
      } catch {
        el.removeEventListener("seeked", done);
        resolve();
      }
    });
    if (gen !== syncGen) return;
  }

  async function syncPaused() {
    playingClipId = null;
    const gen = ++syncGen;
    const hit = clipAtTime(project(), app.playhead);

    if (!videoEl) {
      paint();
      return;
    }

    if (!hit) {
      videoEl.pause();
      applyAudioState();
      if (gen === syncGen) paint();
      return;
    }

    const ok = await ensureVideo(hit.clip.sourcePath, gen);
    if (!ok || gen !== syncGen) return;

    const st = sourceTime(hit.clip, app.playhead);
    await seekVideo(st, gen);
    if (gen !== syncGen) return;

    videoEl.pause();
    applyAudioState();
    paint();
  }

  /**
   * Start free-running a clip under play(). Seeks once to the playhead-mapped
   * source time, then lets the element run — no per-frame drift correction.
   */
  async function startClipPlayback(clip: Clip, gen: number): Promise<void> {
    if (!videoEl || !app.playing) return;

    playingClipId = clip.id;
    const ok = await ensureVideo(clip.sourcePath, gen);
    if (!ok || !app.playing || gen !== syncGen) {
      if (playingClipId === clip.id) playingClipId = null;
      return;
    }

    const dur = clipDuration(clip);
    const local = app.playhead - clip.timelineStart;
    const st = clamp(
      clip.sourceIn + local,
      clip.sourceIn,
      Math.max(clip.sourceIn, clip.sourceOut - CLIP_END_EPS),
    );

    await seekVideo(st, gen, true);
    if (!app.playing || !videoEl || gen !== syncGen) {
      if (playingClipId === clip.id) playingClipId = null;
      return;
    }

    // If we're already at/past the out point, don't play — tick will advance.
    if (dur <= 0 || st >= clip.sourceOut - CLIP_END_EPS) {
      videoEl.pause();
      playingClipId = null;
      return;
    }

    applyAudioState();
    void videoEl.play().catch(() => {});
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
    videoEl?.pause();
    applyAudioState();
    paint();
    stopRaf();
  }

  /**
   * Playback clock:
   * - On a clip: free-run `<video>` and drive the playhead from `currentTime`
   *   (no wall-clock + drift-seek — that caused ~1s snap-back jitter).
   * - In a black gap: advance playhead with wall-clock.
   * - Clip change: one seek + play(), then free-run again.
   */
  function tick(now: number) {
    if (!app.playing) {
      rafId = 0;
      lastRafMs = 0;
      return;
    }

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

    if (hit && videoEl) {
      const clip = hit.clip;
      const clipEnd = clip.timelineStart + clipDuration(clip);

      // New clip (or first frame) → one-time lock, then free-run
      if (playingClipId !== clip.id || loadedPath !== clip.sourcePath) {
        const gen = ++syncGen;
        void startClipPlayback(clip, gen);
        paint();
      } else if (videoEl.seeking) {
        // Wait for seek to land; don't wall-clock-fight the element
        paint();
      } else if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const vidT = videoEl.currentTime;
        const pastOut = vidT >= clip.sourceOut - CLIP_END_EPS;
        const ended = videoEl.ended;

        if (pastOut || ended) {
          // Trim out or media EOF → leave this clip
          t = clipEnd;
          videoEl.pause();
          playingClipId = null;
        } else {
          // Free-run: timeline follows the decoder clock
          t = clip.timelineStart + Math.max(0, vidT - clip.sourceIn);
          if (videoEl.paused) {
            applyAudioState();
            void videoEl.play().catch(() => {});
          }
        }
        paint();
      } else {
        paint();
      }
    } else {
      // Black gap (or no decoder yet): wall-clock advance
      playingClipId = null;
      videoEl?.pause();
      t = t + wallDt;
      paint();
    }

    if (t >= totalDur - 1e-6) {
      stopPlayback(totalDur, "Paused");
      return;
    }

    if (t !== app.playhead) setPlayhead(t);
    rafId = requestAnimationFrame(tick);
  }

  function startRaf() {
    if (rafId) return;
    lastRafMs = 0;
    rafId = requestAnimationFrame(tick);
  }

  // Playback loop only
  $effect(() => {
    if (app.playing) {
      playingClipId = null; // force re-lock on play start
      applyAudioState();
      startRaf();
      return () => {
        stopRaf();
        playingClipId = null;
      };
    }
    stopRaf();
    playingClipId = null;
    videoEl?.pause();
    applyAudioState();
  });

  // Still-frame when paused: seek on playhead / project / meta changes
  $effect(() => {
    if (app.playing) return;
    void app.playhead;
    void project();
    void app.metaByPath;
    void syncPaused();
  });

  // Mute toggle while playing
  $effect(() => {
    void app.previewMuted;
    applyAudioState();
  });

  // Keep canvas buffer size in sync with project canvas
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
    // cloneProject — structuredClone throws on Svelte 5 $state proxies
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
    videoEl?.pause();
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
  <!-- Decoder for local media frames + preview audio (unmuted only while playing) -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={videoEl} class="decoder" playsinline preload="auto"></video>
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
