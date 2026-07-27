<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Inspector from "$lib/components/Inspector.svelte";
  import MissingDeps from "$lib/components/MissingDeps.svelte";
  import StatusLine from "$lib/components/StatusLine.svelte";
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
      <div class="preview-placeholder">
        <p>Preview</p>
        <p class="muted">{p.canvas.width}×{p.canvas.height} · playhead {app.playhead.toFixed(2)}s</p>
        <p class="muted">Full preview lands in a later task</p>
      </div>
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

  <section class="timeline-placeholder" aria-label="Timeline">
    <div class="timeline-head">
      <span>Timeline</span>
      <span class="muted">
        {p.tracks.length} track{p.tracks.length === 1 ? "" : "s"}
        · {p.tracks.reduce((n, t) => n + t.clips.length, 0)} clip{p.tracks.reduce((n, t) => n + t.clips.length, 0) === 1
          ? ""
          : "s"}
        · selected track
        {p.tracks.find((t) => t.id === app.selectedTrackId)?.name ?? "—"}
      </span>
    </div>
    <div class="tracks">
      {#each [...p.tracks].reverse() as track (track.id)}
        <div
          class="track-row"
          class:selected={track.id === app.selectedTrackId}
          role="button"
          tabindex="0"
          onclick={() => {
            app.selectedTrackId = track.id;
          }}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              app.selectedTrackId = track.id;
            }
          }}
        >
          <span class="track-name">{track.name}</span>
          <span class="track-clips muted">
            {#if track.clips.length === 0}
              empty
            {:else}
              {track.clips.length} clip{track.clips.length === 1 ? "" : "s"}
              {#each track.clips as c (c.id)}
                <button
                  type="button"
                  class="clip-chip"
                  class:active={c.id === app.selectedClipId}
                  onclick={(e) => {
                    e.stopPropagation();
                    app.selectedClipId = c.id;
                    app.selectedTrackId = track.id;
                  }}
                >
                  {basename(c.sourcePath)}
                </button>
              {/each}
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </section>
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

  .preview-placeholder {
    flex: 1;
    min-height: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    text-align: center;
    padding: 1rem;
  }

  .preview-placeholder p {
    margin: 0;
  }

  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .timeline-placeholder {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.55rem 0.75rem 0.65rem;
    min-height: 120px;
  }

  .timeline-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.45rem;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .timeline-head .muted {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }

  .tracks {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .track-row {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    width: 100%;
    text-align: left;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.55rem;
    color: var(--text);
    cursor: pointer;
  }

  .track-row:hover {
    background: var(--surface-2);
  }

  .track-row.selected {
    border-color: var(--accent);
  }

  .track-name {
    flex: 0 0 2.2rem;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .track-clips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
    min-width: 0;
  }

  .clip-chip {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.15em 0.45em;
    font-size: 0.8rem;
    color: var(--text);
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clip-chip:hover:not(:disabled) {
    background: #2c2c34;
  }

  .clip-chip.active {
    border-color: var(--accent);
    background: rgba(91, 140, 255, 0.18);
  }

  @media (max-width: 800px) {
    .main {
      grid-template-columns: 1fr;
    }
  }
</style>
