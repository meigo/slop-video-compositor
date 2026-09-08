<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Inspector from "$lib/components/Inspector.svelte";
  import MissingDeps from "$lib/components/MissingDeps.svelte";
  import Preview from "$lib/components/Preview.svelte";
  import StatusLine from "$lib/components/StatusLine.svelte";
  import Timeline from "$lib/components/Timeline.svelte";
  import Toolbar from "$lib/components/Toolbar.svelte";
  import Transport from "$lib/components/Transport.svelte";
  import {
    addMarkerAtPlayhead,
    app,
    basename,
    truncateMiddle,
    canExport,
    canRedo,
    canUndo,
    clearPlayRange,
    clampTimelineHeight,
    copySelectedClip,
    duration,
    duplicateSelectedClip,
    exportVideo,
    hasPlayRange,
    importVideos,
    initApp,
    newProject,
    openProject,
    pasteClipboard,
    playBounds,
    project,
    refreshDeps,
    relinkSelected,
    resetSelectedTransform,
    revealSelectedSource,
    saveProject,
    saveProjectAs,
    seekNextCut,
    seekPlayheadEnd,
    seekPlayheadHome,
    seekPrevCut,
    selectedClip,
    selectedClipDurationSecs,
    selectedMeta,
    setCanvasSize,
    setPlayInAtPlayhead,
    setPlayOutAtPlayhead,
    setPlayhead,
    setTimelineHeight,
    stepPlayheadFrames,
    stepPlayheadSeconds,
    toggleLoopPlayback,
    undo,
    redo,
    updateSelectedClipFields,
  } from "../state/appState.svelte";

  const p = $derived(project());
  const clip = $derived(selectedClip());
  const meta = $derived(selectedMeta());
  const dur = $derived(duration());
  const clipDur = $derived(selectedClipDurationSecs());
  const undoOk = $derived(canUndo(app.history));
  const redoOk = $derived(canRedo(app.history));
  const exportOk = $derived(canExport());
  const nSel = $derived(app.selectedClipIds.length);

  /** Contextual status-bar tip (does not overwrite action/error status). */
  const statusHint = $derived.by(() => {
    if (app.exporting) return "Export runs in the background — keep this window open";
    if (app.missingSources.length > 0) {
      return "Select a clip → Relink… or Reveal in Inspector";
    }
    if (app.playing) {
      return hasPlayRange()
        ? "Space pause · L loop range · I/O set play range"
        : "Space pause · [ ] cuts · L loop · I/O play range";
    }
    if (nSel > 1) {
      return `${nSel} selected · drag any to move group · Delete all · ⌘C copy · ⌘-click to toggle`;
    }
    if (nSel === 1 && clipDur != null) {
      return `Clip ${clipDur.toFixed(2)}s · ⌘-click add more · S split · edge-drag trim · Delete remove`;
    }
    if (clipCountHint(p) === 0) {
      return "Import clips (⌘I) · append is default placement";
    }
    return "Click clip to select · ⌘-click multi-select · Space play";
  });

  function clipCountHint(proj: typeof p): number {
    let n = 0;
    for (const t of proj.tracks) n += t.clips.length;
    return n;
  }

  let resizingTimeline = $state(false);
  let resizeStartY = 0;
  let resizeStartH = 0;

  function togglePlay() {
    if (!app.playing) {
      const { start, end } = playBounds();
      if (end > start && (app.playhead < start || app.playhead >= end)) {
        setPlayhead(start);
      }
    }
    app.playing = !app.playing;
    app.status = app.playing ? "Playing" : "Paused";
  }

  function stop() {
    app.playing = false;
    setPlayhead(playBounds().start);
    app.status = "Stopped";
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (event.shiftKey) void saveProjectAs();
      else void saveProject();
      return;
    }
    if (mod && event.key.toLowerCase() === "o") {
      event.preventDefault();
      void openProject();
      return;
    }
    if (mod && event.key.toLowerCase() === "i") {
      event.preventDefault();
      // Shift+⌘I → each file new track; else current placement mode
      void importVideos(event.shiftKey ? "new-tracks" : app.importPlacement);
      return;
    }
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelectedClip();
      return;
    }
    if (mod && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteClipboard();
      return;
    }
    if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelectedClip();
      return;
    }

    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      togglePlay();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      seekPlayheadHome();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      seekPlayheadEnd();
      return;
    }
    if (event.key === "[" || event.key === "PageUp") {
      event.preventDefault();
      seekPrevCut();
      return;
    }
    if (event.key === "]" || event.key === "PageDown") {
      event.preventDefault();
      seekNextCut();
      return;
    }
    if (event.key.toLowerCase() === "m" && !mod) {
      event.preventDefault();
      addMarkerAtPlayhead();
      return;
    }
    if (event.key.toLowerCase() === "l" && !mod) {
      event.preventDefault();
      toggleLoopPlayback();
      return;
    }
    if (event.key.toLowerCase() === "i" && !mod) {
      event.preventDefault();
      setPlayInAtPlayhead();
      return;
    }
    if (event.key.toLowerCase() === "o" && !mod) {
      event.preventDefault();
      setPlayOutAtPlayhead();
      return;
    }
    if (event.key === "Escape" && hasPlayRange()) {
      event.preventDefault();
      clearPlayRange();
      return;
    }

    // Frame step (export fps = 30). Shift = 1 second.
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const dir = event.key === "ArrowLeft" ? -1 : 1;
      if (event.shiftKey) stepPlayheadSeconds(dir);
      else stepPlayheadFrames(dir);
    }
  }

  function onSplitterPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    resizingTimeline = true;
    resizeStartY = e.clientY;
    resizeStartH = app.timelineHeightPx;
    window.addEventListener("pointermove", onSplitterPointerMove);
    window.addEventListener("pointerup", onSplitterPointerUp);
    window.addEventListener("pointercancel", onSplitterPointerUp);
  }

  function onSplitterPointerMove(e: PointerEvent) {
    if (!resizingTimeline) return;
    // Drag up → taller timeline
    const next = resizeStartH + (resizeStartY - e.clientY);
    app.timelineHeightPx = clampTimelineHeight(next);
  }

  function onSplitterPointerUp() {
    if (!resizingTimeline) return;
    resizingTimeline = false;
    window.removeEventListener("pointermove", onSplitterPointerMove);
    window.removeEventListener("pointerup", onSplitterPointerUp);
    window.removeEventListener("pointercancel", onSplitterPointerUp);
    setTimelineHeight(app.timelineHeightPx, true);
  }

  function onWindowResize() {
    app.timelineHeightPx = clampTimelineHeight(app.timelineHeightPx);
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onWindowResize);
    void initApp();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("pointermove", onSplitterPointerMove);
    window.removeEventListener("pointerup", onSplitterPointerUp);
    window.removeEventListener("pointercancel", onSplitterPointerUp);
  });
</script>

<div
  class="legacy flex h-screen flex-col overflow-hidden bg-ground text-text {resizingTimeline
    ? 'cursor-row-resize select-none'
    : ''}"
>
  {#if app.deps && !app.deps.ffmpeg}
    <MissingDeps deps={app.deps} onRecheck={() => void refreshDeps()} />
  {/if}

  <Toolbar
    canvasWidth={p.canvas.width}
    canvasHeight={p.canvas.height}
    dirty={app.dirty}
    exporting={app.exporting}
    canExport={exportOk}
    canUndo={undoOk}
    canRedo={redoOk}
    importPlacement={app.importPlacement}
    onNew={newProject}
    onOpen={() => void openProject()}
    onSave={() => void saveProject()}
    onSaveAs={() => void saveProjectAs()}
    onImport={() => void importVideos()}
    onExport={() => void exportVideo()}
    onUndo={undo}
    onRedo={redo}
    onCanvasChange={setCanvasSize}
    onImportPlacementChange={(mode) => {
      app.importPlacement = mode;
      app.status =
        mode === "append"
          ? "Import: append on track"
          : mode === "playhead"
            ? "Import: at playhead"
            : "Import: each file → new track";
    }}
  />

  <div
    class="grid min-h-[120px] min-w-0 flex-1 max-[800px]:grid-cols-1"
    style="grid-template-columns: minmax(0, 1.65fr) minmax(240px, 0.9fr)"
  >
    <section class="flex min-h-0 min-w-0 flex-col" aria-label="Preview">
      <Preview />
      <Transport
        playhead={app.playhead}
        duration={dur}
        playing={app.playing}
        muted={app.previewMuted}
        loop={app.loopPlayback}
        onTogglePlay={togglePlay}
        onStop={stop}
        onToggleLoop={toggleLoopPlayback}
        onToggleMute={() => {
          app.previewMuted = !app.previewMuted;
          app.status = app.previewMuted ? "Preview muted" : "Preview unmuted";
        }}
        onHome={seekPlayheadHome}
        onEnd={seekPlayheadEnd}
        onPrevCut={seekPrevCut}
        onNextCut={seekNextCut}
      />
    </section>

    <Inspector
      {clip}
      {meta}
      {basename}
      {truncateMiddle}
      onUpdate={updateSelectedClipFields}
      onResetTransform={resetSelectedTransform}
      onRelink={() => void relinkSelected()}
      onReveal={() => void revealSelectedSource()}
    />
  </div>

  <button
    type="button"
    class="group flex h-2 w-full shrink-0 cursor-row-resize touch-none items-center justify-center border-y border-line bg-panel"
    aria-label="Resize timeline height ({app.timelineHeightPx} pixels)"
    title="Drag to resize timeline"
    onpointerdown={onSplitterPointerDown}
    onkeydown={(e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const step = e.shiftKey ? 24 : 8;
        const delta = e.key === "ArrowUp" ? step : -step;
        setTimelineHeight(app.timelineHeightPx + delta, true);
      }
    }}
  >
    <span
      class="h-0.5 w-9 rounded-full group-hover:bg-accent group-focus-visible:bg-accent {resizingTimeline
        ? 'bg-accent'
        : 'bg-line'}"
      aria-hidden="true"
    ></span>
  </button>

  <div class="flex min-h-0 min-w-0 shrink-0 flex-col" style:height="{app.timelineHeightPx}px">
    <Timeline />
  </div>

  <StatusLine
    status={app.missingSources.length > 0
      ? `${app.status} · ${app.missingSources.length} missing media`
      : app.status}
    hint={statusHint}
    dirty={app.dirty}
    projectPath={app.projectPath}
    projectName={p.name}
  />
</div>
