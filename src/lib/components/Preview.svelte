<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy, untrack } from "svelte";
  import { findClip } from "$lib/clips";
  import {
    clampSourceSeek,
    clampSourceSeekPreroll,
    clipTimelineEnd,
    firstClipInSequence,
    isHardCutIntoSourceIn,
    nextClipAfter,
    shouldPrefetchNearCut,
    shouldPrerollStandby,
    sourceTimeAt,
  } from "$lib/previewTime";
  import { cloneProject, projectDuration } from "$lib/project";
  import { audioBedAtTime, videoClipAtTime } from "$lib/resolve";
  import { clamp } from "$lib/time";
  import { drawRect } from "$lib/transform";
  import type { Clip, ClipTransform, Project } from "$lib/types";
  import {
    app,
    commitProjectEdit,
    playBounds,
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
  /** Load/seek standby this far before the cut (source seconds remaining). */
  const PREFETCH_LEAD = 3.0;
  /**
   * Seek standby this far before sourceIn so free-run can roll into the cut
   * past keyframe stalls (accuracy trade-off).
   */
  const PREFETCH_PREROLL = 0.25;
  /**
   * Start muted free-run on standby this far before the cut (must be ≤ PREFETCH_LEAD
   * and usually ≥ PREFETCH_PREROLL so there is time to roll into sourceIn).
   */
  const STANDBY_PLAY_LEAD = 0.4;
  /** Tolerance for treating a cut as "into sourceIn" (seamless swap). */
  const HARD_CUT_TOL = 0.08;

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
  /** Separate underlay for audio-only beds (plays under picture). */
  let bedAudioEl: HTMLAudioElement | undefined = $state();
  let bedClipId: string | null = null;
  let bedPath: string | null = null;
  let bedLoadGen = 0;
  /** After a loop wrap, ignore end-of-clip for a short window so free-run can settle. */
  let wrapGraceUntilMs = 0;

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

  function isAudioOnlyPath(path: string | null | undefined): boolean {
    if (!path) return false;
    const meta = app.metaByPath.get(path);
    return !!meta && (meta.width === 0 || meta.height === 0);
  }

  function isAudioOnlyClip(clip: Clip): boolean {
    return isAudioOnlyPath(clip.sourcePath);
  }

  /**
   * Audio-only files often sit at HAVE_METADATA until play starts (no video frames).
   * Require only metadata for them; video still needs a decodable frame.
   */
  function mediaReady(el: HTMLVideoElement, clip: Clip): boolean {
    if (el.seeking) return false;
    if (isAudioOnlyClip(clip)) {
      return el.readyState >= HTMLMediaElement.HAVE_METADATA;
    }
    // Require a decodable frame (not metadata-only) so swap paints immediately.
    return (
      el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      el.videoWidth > 0 &&
      el.videoHeight > 0
    );
  }

  /** Unmute + play the active slot when preview/clip mute allow it. */
  function playSlotAudio(el: HTMLVideoElement, clip: Clip) {
    el.muted = app.previewMuted || clip.muted === true;
    if (el.volume !== 1) el.volume = 1;
    void el.play().catch(() => {});
  }

  function paintFrom(slot: Slot, clip: Clip): boolean {
    if (!canvasEl || !slot.el) return false;
    if (slot.path !== clip.sourcePath) return false;
    if (!mediaReady(slot.el, clip)) return false;

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return false;

    const w = canvasEl.width;
    const h = canvasEl.height;

    // Audio-only: black canvas (export will do the same).
    if (isAudioOnlyClip(clip)) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      holdFrame = true;
      return true;
    }

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
    const hit = videoClipAtTime(previewProject(), app.playhead, app.metaByPath);

    // No video (gap or audio-only bed only) — black picture
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
    let clipMuted = false;
    if (playingClipId) {
      const found = findClip(previewProject(), playingClipId);
      clipMuted = found?.clip.muted === true;
    }
    for (const s of slots) {
      if (!s.el) continue;
      // Only the active free-running slot should make sound (and only if clip not muted).
      const isActive = s === activeSlot() && playingClipId != null && s.clipId === playingClipId;
      s.el.muted = app.previewMuted || clipMuted || !app.playing || !isActive;
      if (s.el.volume !== 1) s.el.volume = 1;
    }
    // Bed mute uses loaded bedClipId — never read app.playhead here (would re-trigger
    // the play $effect every free-run tick and thrash seeks).
    if (bedAudioEl) {
      let bedMuted = !bedClipId;
      if (bedClipId) {
        const found = findClip(previewProject(), bedClipId);
        bedMuted = !found || found.clip.muted === true;
      }
      bedAudioEl.muted = app.previewMuted || bedMuted || !app.playing;
      if (bedAudioEl.volume !== 1) bedAudioEl.volume = 1;
    }
  }

  function clearBedAudio() {
    bedClipId = null;
    bedPath = null;
    if (bedAudioEl) {
      bedAudioEl.pause();
      bedAudioEl.muted = true;
    }
  }

  /**
   * Load/seek underlay bed once (scrub, play start, bed change). Not for rAF tick.
   */
  async function syncBedAudio(timelineT: number, play: boolean) {
    const el = bedAudioEl;
    if (!el) return;
    const gen = ++bedLoadGen;
    const bed = audioBedAtTime(previewProject(), timelineT, app.metaByPath);
    if (!bed) {
      clearBedAudio();
      return;
    }
    const clip = bed.clip;
    const path = clip.sourcePath;
    const st = clampSourceSeek(clip, sourceTimeAt(clip, timelineT), CLIP_END_EPS);

    if (bedPath !== path || bedClipId !== clip.id) {
      bedPath = path;
      bedClipId = clip.id;
      el.pause();
      el.src = assetUrl(path);
      el.load();
      await waitEvent(el, "loadedmetadata", 4000);
      if (gen !== bedLoadGen) return;
    }

    try {
      if (Math.abs(el.currentTime - st) > 0.05) el.currentTime = st;
    } catch {
      /* ignore */
    }
    if (gen !== bedLoadGen) return;

    el.muted = app.previewMuted || clip.muted === true || !play;
    if (el.volume !== 1) el.volume = 1;
    if (play && app.playing) {
      void el.play().catch(() => {});
    } else {
      el.pause();
      el.muted = true;
    }
  }

  /**
   * Lightweight rAF maintenance: free-run the current bed, only resync on large drift
   * or when the winning bed clip changes.
   */
  function maintainBedAudio(timelineT: number) {
    const el = bedAudioEl;
    if (!el || !app.playing) return;

    const bed = audioBedAtTime(previewProject(), timelineT, app.metaByPath);
    if (!bed) {
      if (bedClipId) clearBedAudio();
      return;
    }

    const clip = bed.clip;
    // New bed at this time — full load/seek (async once).
    if (bedClipId !== clip.id || bedPath !== clip.sourcePath) {
      void syncBedAudio(timelineT, true);
      return;
    }

    // Free-run: only correct big drift (don't fight the decoder every frame).
    const expected = sourceTimeAt(clip, timelineT);
    if (!el.seeking && Math.abs(el.currentTime - expected) > 0.45) {
      try {
        el.currentTime = clampSourceSeek(clip, expected, CLIP_END_EPS);
      } catch {
        /* ignore */
      }
    }

    el.muted = app.previewMuted || clip.muted === true;
    if (el.volume !== 1) el.volume = 1;
    if (el.paused) void el.play().catch(() => {});
  }

  function waitEvent(el: HTMLMediaElement, event: string, timeoutMs = 8000): Promise<void> {
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

  /** Wait until the element has a decodable frame (or metadata for audio-only). */
  function waitForFrame(
    el: HTMLVideoElement,
    timeoutMs = 4000,
    audioOnly = false,
  ): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener("loadeddata", onReady);
        el.removeEventListener("loadedmetadata", onReady);
        el.removeEventListener("canplay", onReady);
        el.removeEventListener("seeked", onReady);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);

      const anyEl = el as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (!audioOnly && typeof anyEl.requestVideoFrameCallback === "function") {
        anyEl.requestVideoFrameCallback(() => finish());
        // Still arm media events in case RVFC is delayed while paused
      }

      const onReady = () => {
        if (audioOnly) {
          if (el.readyState < HTMLMediaElement.HAVE_METADATA) return;
        } else {
          if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          if (el.videoWidth <= 0) return;
        }
        // Two rAFs: first layout, second after the browser presents the frame
        requestAnimationFrame(() => requestAnimationFrame(finish));
      };
      el.addEventListener("loadeddata", onReady);
      el.addEventListener("loadedmetadata", onReady);
      el.addEventListener("canplay", onReady);
      el.addEventListener("seeked", onReady);
      onReady();
    });
  }

  async function loadPath(slot: Slot, path: string): Promise<boolean> {
    const el = slot.el;
    if (!el) return false;
    const audioOnly = isAudioOnlyPath(path);
    const readyEnough = audioOnly
      ? el.readyState >= HTMLMediaElement.HAVE_METADATA
      : el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (slot.path === path && el.src && readyEnough) {
      return true;
    }

    slot.ready = false;
    slot.path = path;
    el.pause();
    el.src = assetUrl(path);
    el.load();
    // Audio-only often fires loadedmetadata first; video needs loadeddata/frame.
    if (audioOnly) {
      if (el.readyState < HTMLMediaElement.HAVE_METADATA) {
        await waitEvent(el, "loadedmetadata");
      }
    } else {
      await waitEvent(el, "loadeddata");
    }
    if (slot.path !== path) return false;
    if (!audioOnly && el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitEvent(el, "canplay", 4000);
    }
    await waitForFrame(el, 4000, audioOnly);
    return slot.path === path;
  }

  async function seekSlot(
    slot: Slot,
    t: number,
    clip: Clip,
    _force = false,
  ): Promise<void> {
    const el = slot.el;
    if (!el) return;
    const target = Math.max(0, t);
    slot.seekTo = target;
    slot.ready = false;
    const audioOnly = isAudioOnlyClip(clip);

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

    await waitForFrame(el, 4000, audioOnly);
    if (mediaReady(el, clip)) {
      slot.ready = true;
    }
  }

  /**
   * Prepare a slot for a clip at a source time.
   * Standby uses preroll seek (slightly before sourceIn) when `preroll` is set.
   * `valid()` must stay true across awaits (gen tokens).
   */
  async function prepareSlot(
    slot: Slot,
    clip: Clip,
    sourceT: number,
    opts: { play: boolean; valid: () => boolean; preroll?: boolean },
  ): Promise<boolean> {
    if (!slot.el) return false;
    slot.clipId = clip.id;
    slot.ready = false;

    const ok = await loadPath(slot, clip.sourcePath);
    if (!ok || !opts.valid()) return false;

    const st = opts.preroll
      ? clampSourceSeekPreroll(clip, PREFETCH_PREROLL, CLIP_END_EPS)
      : clampSourceSeek(clip, sourceT, CLIP_END_EPS);
    await seekSlot(slot, st, clip, true);
    if (!opts.valid() || slot.clipId !== clip.id) return false;

    slot.ready = mediaReady(slot.el, clip);
    if (!slot.ready) return false;

    if (opts.play && app.playing) {
      playSlotAudio(slot.el, clip);
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
    const hit = videoClipAtTime(previewProject(), app.playhead, app.metaByPath);
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

    const hit = videoClipAtTime(previewProject(), app.playhead, app.metaByPath);
    const active = activeSlot();
    standbySlot().el?.pause();

    void syncBedAudio(app.playhead, false);

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

  /** Warm standby with the upcoming clip (preroll seek before sourceIn). */
  function schedulePrefetch(fromClip: Clip) {
    const proj = previewProject();
    const { start: playStart, end: playEnd } = playBounds();
    // Prefer next video still inside the play range; with loop, wrap to play-in clip.
    let next = nextClipAfter(proj, fromClip, app.metaByPath);
    if (next && next.timelineStart >= playEnd - 1e-6) next = null;
    if (!next && app.loopPlayback) {
      next =
        videoClipAtTime(proj, playStart, app.metaByPath)?.clip ??
        firstClipInSequence(proj, app.metaByPath);
    }
    if (!next) {
      prefetchClipId = null;
      return;
    }
    const stand = standbySlot();
    // Already warm with a decoded frame — nothing to do.
    if (
      prefetchClipId === next.id &&
      stand.clipId === next.id &&
      stand.ready &&
      stand.el &&
      mediaReady(stand.el, next)
    ) {
      return;
    }
    // Same target still loading — don't restart.
    if (prefetchClipId === next.id && stand.clipId === next.id && !stand.ready) {
      return;
    }
    prefetchClipId = next.id;
    const gen = ++prefetchGen;
    void prepareSlot(stand, next, next.sourceIn, {
      play: false,
      preroll: true,
      valid: () => gen === prefetchGen && app.playing,
    }).then((ok) => {
      if (!ok || gen !== prefetchGen) return;
      // Keep paused until STANDBY_PLAY_LEAD; force one decode path if still cold.
      stand.el?.pause();
      if (stand.el) stand.el.muted = true;
      if (stand.el && !mediaReady(stand.el, next)) {
        stand.ready = false;
      } else if (stand.el) {
        stand.ready = true;
      }
    });
  }

  /**
   * When near the cut, start muted free-run on standby so it rolls into sourceIn
   * with a decoded frame ready for swap.
   */
  function maybePrerollStandby(fromClip: Clip, videoTime: number) {
    if (!shouldPrerollStandby(fromClip.sourceOut, videoTime, STANDBY_PLAY_LEAD)) return;
    const next = nextClipAfter(previewProject(), fromClip, app.metaByPath);
    if (!next) return;
    const stand = standbySlot();
    if (!stand.el || stand.clipId !== next.id) return;
    if (stand.el.seeking) return;
    // Soft-ready: accept HAVE_CURRENT_DATA even if the ready flag lagged.
    if (!mediaReady(stand.el, next)) return;
    stand.ready = true;
    // Keep muted; do not steal the audio clock from the active clip.
    stand.el.muted = true;
    if (stand.el.paused) void stand.el.play().catch(() => {});
  }

  function swapToStandby(nextClip: Clip): boolean {
    const stand = standbySlot();
    if (stand.clipId !== nextClip.id || !stand.el) return false;
    // Soft ready: accept HAVE_CURRENT_DATA even if the flag lagged.
    if (!mediaReady(stand.el, nextClip)) {
      stand.ready = false;
      return false;
    }
    stand.ready = true;

    // Only seamless-swap when we actually need the clip's sourceIn (hard cut).
    // Mid-clip play-in / scrub targets must go through seek, not preroll sourceIn.
    const needSt = clampSourceSeek(
      nextClip,
      sourceTimeAt(nextClip, app.playhead),
      CLIP_END_EPS,
    );
    if (!isHardCutIntoSourceIn(needSt, nextClip.sourceIn, HARD_CUT_TOL)) {
      return false;
    }

    // Paint the *next* frame before pausing the previous decoder — holds the canvas
    // even if the flip is slow.
    paintFrom(stand, nextClip);
    holdFrame = true;

    const prev = activeSlot();
    prev.el?.pause();
    if (prev.el) prev.el.muted = true;

    activeIdx = (1 - activeIdx) as 0 | 1;
    playingClipId = nextClip.id;

    const active = activeSlot();
    if (active.el) {
      // If free-run already rolled past sourceIn, keep going; only snap if still early.
      const ct = active.el.currentTime;
      if (ct < needSt - 0.02 || Math.abs(ct - needSt) > 0.35) {
        try {
          active.el.currentTime = needSt;
        } catch {
          /* ignore */
        }
      }
      playSlotAudio(active.el, nextClip);
    }
    applyAudioState();
    if (!paintFrom(active, nextClip)) {
      paint();
    }

    schedulePrefetch(nextClip);
    return true;
  }

  async function startClipPlayback(clip: Clip, gen: number): Promise<void> {
    bindSlots();
    if (!app.playing) return;

    // Always seek to the playhead's source time (respects play-in mid-clip).
    const st = clampSourceSeek(clip, sourceTimeAt(clip, app.playhead), CLIP_END_EPS);

    // Prefer prefetched standby only for true hard cuts at sourceIn.
    if (isHardCutIntoSourceIn(st, clip.sourceIn, HARD_CUT_TOL) && swapToStandby(clip)) {
      return;
    }

    // Same-file continuation on active: seek without reload
    const active = activeSlot();
    if (
      active.path === clip.sourcePath &&
      active.el &&
      active.el.readyState >= HTMLMediaElement.HAVE_METADATA
    ) {
      playingClipId = clip.id;
      active.clipId = clip.id;
      await seekSlot(active, st, clip, true);
      if (!app.playing || gen !== syncGen) {
        if (playingClipId === clip.id) playingClipId = null;
        return;
      }
      active.ready = mediaReady(active.el, clip);
      applyAudioState();
      playSlotAudio(active.el, clip);
      paint();
      schedulePrefetch(clip);
      return;
    }

    // Cold start on active (first clip / cache miss) — hold prior frame until ready.
    holdFrame = true;
    playingClipId = clip.id;
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

  /** Pause all decoders (video slots + bed). */
  function pauseAllMedia() {
    for (const s of slots) {
      s.el?.pause();
    }
    bedAudioEl?.pause();
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
    wrapGraceUntilMs = 0;
    pauseAllMedia();
    applyAudioState();
    paint();
    stopRaf();
  }

  /**
   * Loop / restart at play-in: pin playhead, pause media, then seek-start from
   * sourceTimeAt(play-in) — never from clip sourceIn alone.
   */
  function wrapToPlayIn() {
    wrapGraceUntilMs = performance.now() + 280;
    const { start } = playBounds();
    setPlayhead(start);
    void syncBedAudio(start, true);

    playingClipId = null;
    prefetchClipId = null;
    prefetchGen++;
    pauseAllMedia();
    for (const s of slots) {
      if (s.el) s.el.muted = true;
    }

    const hit = videoClipAtTime(previewProject(), start, app.metaByPath);
    if (hit) {
      const gen = ++syncGen;
      void startClipPlayback(hit.clip, gen);
    }
    applyAudioState();
    paint();
  }

  /** True when free-run timeline time has reached play-out. */
  function hitPlayOut(timelineT: number, playEnd: number): boolean {
    return timelineT >= playEnd - 1e-6;
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
    const { start: playStart, end: playEnd } = playBounds();

    let t = app.playhead;
    const inWrapGrace = now < wrapGraceUntilMs;

    // Outside play range (not during wrap settle): loop → play-in, else hard stop.
    if (!inWrapGrace && (t < playStart - 1e-6 || hitPlayOut(t, playEnd))) {
      if (app.loopPlayback || t < playStart - 1e-6) {
        wrapToPlayIn();
        rafId = requestAnimationFrame(tick);
        return;
      }
      stopPlayback(playEnd, "Paused");
      return;
    }
    if (inWrapGrace) {
      t = playStart;
    }

    const hit = videoClipAtTime(proj, t, app.metaByPath);
    const active = activeSlot();

    // Free-run underlay (no per-frame async reload/seek thrash).
    maintainBedAudio(t);

    if (hit && active.el) {
      const clip = hit.clip;
      const end = clipTimelineEnd(clip);
      const mediaLive = active.el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const playInSrc = clampSourceSeek(clip, sourceTimeAt(clip, playStart), CLIP_END_EPS);
      // Source time that corresponds to play-out (may be mid-clip).
      const playOutSrc = clampSourceSeek(
        clip,
        sourceTimeAt(clip, Math.min(playEnd, end) - 1e-4),
        CLIP_END_EPS,
      );

      if (playingClipId !== clip.id) {
        // Hold prior frame while the new winner loads (gap→clip or cold cut).
        holdFrame = true;
        const gen = ++syncGen;
        void startClipPlayback(clip, gen);
        paint();
      } else if (inWrapGrace) {
        // Only pin to play-in during loop wrap settle — not on ordinary cut seeks.
        t = playStart;
        if (!active.el.seeking && Math.abs(active.el.currentTime - playInSrc) > 0.05) {
          active.el.pause();
          try {
            active.el.currentTime = playInSrc;
          } catch {
            /* ignore */
          }
        } else if (!active.el.seeking && Math.abs(active.el.currentTime - playInSrc) <= 0.05) {
          wrapGraceUntilMs = 0;
          playSlotAudio(active.el, clip);
        }
        paint();
      } else if (active.el.seeking) {
        // Hard-cut / scrub seek: keep timeline where we already set it (don't jump to I).
        paint();
      } else if (mediaLive) {
        const vidT = active.el.currentTime;
        // Source time at this clip's exclusive timeline end (true clip past-out).
        const clipEndSrc = clampSourceSeek(clip, clip.sourceOut - CLIP_END_EPS, CLIP_END_EPS);
        // Play-out only if the range ends inside this clip (not at every clip boundary).
        const rangeEndsInThisClip = playEnd <= end + 1e-6;
        const pastPlayOut =
          rangeEndsInThisClip && vidT >= playOutSrc - CLIP_END_EPS;
        const pastClipEnd = vidT >= clipEndSrc - 1e-4 || active.el.ended;

        // Before play-in in source space (only when play-in lies inside this clip).
        if (playStart >= clip.timelineStart - 1e-9 && playStart < end && vidT < playInSrc - 0.04) {
          t = playStart;
          active.el.pause();
          try {
            active.el.currentTime = playInSrc;
          } catch {
            /* ignore */
          }
          paint();
        } else if (pastPlayOut) {
          // Hit play-out inside this clip — stop/loop (do not jump to next clip).
          pauseAllMedia();
          t = playEnd;
          playingClipId = null;
          paint();
        } else if (pastClipEnd) {
          // Natural hard cut to the next video (if still inside the play range).
          pauseAllMedia();
          let next = nextClipAfter(proj, clip, app.metaByPath);
          if (next && next.timelineStart >= playEnd - 1e-6) next = null;
          playingClipId = null;

          if (next && next.timelineStart < playEnd - 1e-6) {
            t = Math.min(Math.max(next.timelineStart, playStart), playEnd);
            // Seek uses app.playhead — update before starting the next clip.
            setPlayhead(t);
            if (!swapToStandby(next)) {
              // Keep last painted frame while the cold path seeks (no black flash).
              holdFrame = true;
              const gen = ++syncGen;
              void startClipPlayback(next, gen);
            }
          } else {
            t = playEnd;
          }
          // Prefer holdFrame over black while the next clip is still opening.
          paint();
        } else {
          if (active.el.paused) {
            applyAudioState();
            playSlotAudio(active.el, clip);
          }
          let mapped = clip.timelineStart + Math.max(0, vidT - clip.sourceIn);
          if (hitPlayOut(mapped, playEnd)) {
            pauseAllMedia();
            t = playEnd;
          } else {
            // Don't pull the head back to play-in once we're past it.
            t = mapped < playStart ? playStart : mapped;
            // Warm next as soon as we're inside the lead, or if standby is empty.
            const stand = standbySlot();
            if (
              !stand.ready ||
              stand.clipId == null ||
              shouldPrefetchNearCut(clip.sourceOut, vidT, PREFETCH_LEAD)
            ) {
              schedulePrefetch(clip);
            }
            maybePrerollStandby(clip, vidT);
          }
          paint();
        }
      } else {
        // Still loading — hold last good frame (do not clear holdFrame).
        holdFrame = true;
        paint();
      }
    } else {
      // Black gap or audio-bed-only — advance by wall clock, clamp to play range.
      playingClipId = null;
      active.el?.pause();
      t = t + wallDt;
      if (hitPlayOut(t, playEnd)) {
        pauseAllMedia();
        t = playEnd;
      }
      // Real gap: clear held frame only when nothing video is resolving at t.
      // If the next clip is already under the playhead (or imminent), keep hold.
      const stillVideo = videoClipAtTime(proj, t, app.metaByPath);
      const upcoming = videoClipAtTime(proj, t + 0.05, app.metaByPath);
      if (!stillVideo && !upcoming) {
        holdFrame = false;
        paintBlack();
      } else {
        if (stillVideo || upcoming) holdFrame = true;
        paint();
      }
      if (!hitPlayOut(t, playEnd) && upcoming && upcoming.clip.timelineStart < playEnd) {
        const stand = standbySlot();
        if (stand.clipId !== upcoming.clip.id || !stand.ready) {
          const gen = ++prefetchGen;
          prefetchClipId = upcoming.clip.id;
          void prepareSlot(stand, upcoming.clip, upcoming.clip.sourceIn, {
            play: false,
            preroll: true,
            valid: () => gen === prefetchGen && app.playing,
          }).then((ok) => {
            if (ok && gen === prefetchGen && stand.el) {
              stand.ready = mediaReady(stand.el, upcoming.clip);
            }
          });
        }
      }
    }

    // End of play range (or sequence when no range).
    if (!inWrapGrace && hitPlayOut(t, playEnd)) {
      pauseAllMedia();
      if (!app.loopPlayback) {
        stopPlayback(playEnd, "Paused");
        return;
      }
      wrapToPlayIn();
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

  // Playback loop — must NOT read app.playhead (set every free-run tick) or this
  // effect restarts continuously: stopRaf → clear playingClipId → seek thrash.
  $effect(() => {
    bindSlots();
    if (app.playing) {
      playingClipId = null;
      prefetchClipId = null;
      applyAudioState();
      startRaf();
      untrack(() => {
        void syncBedAudio(app.playhead, true);
      });
      return () => {
        stopRaf();
        playingClipId = null;
        bedAudioEl?.pause();
      };
    }
    stopRaf();
    playingClipId = null;
    prefetchClipId = null;
    for (const s of slots) s.el?.pause();
    bedAudioEl?.pause();
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
    // Re-apply when per-clip mute changes on the project.
    void project();
    applyAudioState();
  });

  $effect(() => {
    if (!canvasEl) return;
    void canvasW;
    void canvasH;
    if (canvasEl.width !== canvasW) canvasEl.width = canvasW;
    if (canvasEl.height !== canvasH) canvasEl.height = canvasH;
    // Don't subscribe to playhead via paint() — tick already paints while playing.
    untrack(() => paint());
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
    return videoClipAtTime(previewProject(), app.playhead, app.metaByPath)?.clip ?? null;
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
    bedAudioEl?.pause();
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
  <!-- Audio-only beds underlay picture (any track order) -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <audio bind:this={bedAudioEl} class="decoder" preload="auto"></audio>
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

  /*
   * Off-screen decoders must stay in the rendering tree with a non-zero box.
   * opacity:0 / 1×1 can suppress audio decode in WebKit for audio-only media.
   */
  .decoder {
    position: absolute;
    left: -9999px;
    top: 0;
    width: 16px;
    height: 16px;
    opacity: 1;
    pointer-events: none;
    overflow: hidden;
  }
</style>
