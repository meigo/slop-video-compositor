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
    app,
    basename,
    canRedo,
    canUndo,
    duration,
    exportStub,
    importVideos,
    initApp,
    newProject,
    openProject,
    project,
    refreshDeps,
    relinkSelected,
    resetSelectedTransform,
    saveProject,
    saveProjectAs,
    selectedClip,
    selectedMeta,
    setCanvasSize,
    setPlayhead,
    undo,
    redo,
    updateSelectedClipFields,
  } from "../state/appState.svelte";

  const p = $derived(project());
  const clip = $derived(selectedClip());
  const meta = $derived(selectedMeta());
  const dur = $derived(duration());
  const undoOk = $derived(canUndo(app.history));
  const redoOk = $derived(canRedo(app.history));

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
      void importVideos();
      return;
    }
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }

    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      togglePlay();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    void initApp();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", onKeyDown);
  });
</script>

<div class="shell">
  {#if app.deps && !app.deps.ffmpeg}
    <MissingDeps deps={app.deps} onRecheck={() => void refreshDeps()} />
  {/if}

  <Toolbar
    canvasWidth={p.canvas.width}
    canvasHeight={p.canvas.height}
    dirty={app.dirty}
    exporting={app.exporting}
    canUndo={undoOk}
    canRedo={redoOk}
    onNew={newProject}
    onOpen={() => void openProject()}
    onSave={() => void saveProject()}
    onSaveAs={() => void saveProjectAs()}
    onImport={() => void importVideos()}
    onExport={exportStub}
    onUndo={undo}
    onRedo={redo}
    onCanvasChange={setCanvasSize}
  />

  <StatusLine
    status={app.status}
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
        onTogglePlay={togglePlay}
        onStop={stop}
      />
    </section>

    <Inspector
      {clip}
      {meta}
      {basename}
      onUpdate={updateSelectedClipFields}
      onResetTransform={resetSelectedTransform}
      onRelink={() => void relinkSelected()}
    />
  </div>

  <Timeline />
</div>

<style>
  .shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.65rem 0.85rem 0.85rem;
  }

  .main {
    display: grid;
    grid-template-columns: minmax(0, 1.65fr) minmax(240px, 0.9fr);
    gap: 0.55rem;
    flex: 1;
    min-height: 220px;
    min-width: 0;
  }

  .preview-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  @media (max-width: 800px) {
    .main {
      grid-template-columns: 1fr;
    }
  }
</style>
