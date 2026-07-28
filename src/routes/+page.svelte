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
    clampTimelineHeight,
    copySelectedClip,
    duration,
    duplicateSelectedClip,
    exportVideo,
    importVideos,
    initApp,
    newProject,
    openProject,
    pasteClipboard,
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
    setPlayhead,
    setTimelineHeight,
    stepPlayheadFrames,
    stepPlayheadSeconds,
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
      return "Space pause · [ ] cuts · Home/End ends";
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
      const d = duration();
      if (d > 0 && app.playhead >= d) {
        setPlayhead(0);
      }
    }
    app.playing = !app.playing;
    app.status = app.playing ? "Playing" : "Paused";
  }

  function stop() {
    app.playing = false;
    setPlayhead(0);
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

<div class="shell" class:resizing={resizingTimeline}>
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

  <StatusLine
    status={app.missingSources.length > 0
      ? `${app.status} · ${app.missingSources.length} missing media`
      : app.status}
    hint={statusHint}
    dirty={app.dirty}
    projectPath={app.projectPath}
    projectName={p.name}
  />

  <div class="main">
    <section class="preview-col" aria-label="Preview">
      <Preview />
      <Transport
        playhead={app.playhead}
        duration={dur}
        playing={app.playing}
        muted={app.previewMuted}
        onTogglePlay={togglePlay}
        onStop={stop}
        onToggleMute={() => {
          app.previewMuted = !app.previewMuted;
          app.status = app.previewMuted ? "Preview muted" : "Preview unmuted";
        }}
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
    class="splitter"
    class:active={resizingTimeline}
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
    <span class="splitter-grip" aria-hidden="true"></span>
  </button>

  <div class="timeline-panel" style:height="{app.timelineHeightPx}px">
    <Timeline />
  </div>
</div>

<style>
  .shell {
    height: 100vh;
    max-height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.65rem 0.85rem 0.65rem;
    box-sizing: border-box;
    /* Let toolbar menus stack above preview/status without being covered */
    isolation: isolate;
  }

  .shell :global(header.toolbar) {
    flex: 0 0 auto;
    z-index: 40;
  }

  .shell.resizing {
    cursor: row-resize;
    user-select: none;
  }

  .main {
    display: grid;
    grid-template-columns: minmax(0, 1.65fr) minmax(240px, 0.9fr);
    gap: 0.55rem;
    flex: 1 1 auto;
    min-height: 120px;
    min-width: 0;
  }

  .preview-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .splitter {
    flex: 0 0 8px;
    margin: 0 -0.15rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: row-resize;
    touch-action: none;
    border-radius: 4px;
    border: none;
    padding: 0;
    background: transparent;
    color: inherit;
    width: 100%;
  }

  .splitter:hover:not(:disabled) {
    background: rgba(91, 140, 255, 0.12);
  }

  .splitter:hover,
  .splitter.active,
  .splitter:focus-visible {
    background: rgba(91, 140, 255, 0.12);
  }

  .splitter:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .splitter-grip {
    width: 36px;
    height: 3px;
    border-radius: 2px;
    background: var(--border);
  }

  .splitter:hover .splitter-grip,
  .splitter.active .splitter-grip {
    background: var(--accent);
  }

  .timeline-panel {
    flex: 0 0 auto;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 800px) {
    .main {
      grid-template-columns: 1fr;
    }
  }
</style>
