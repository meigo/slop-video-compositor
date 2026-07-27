<script lang="ts">
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Save from "@lucide/svelte/icons/save";
  import SaveAll from "@lucide/svelte/icons/save-all";
  import Film from "@lucide/svelte/icons/film";
  import Download from "@lucide/svelte/icons/download";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import Ratio from "@lucide/svelte/icons/ratio";

  interface Props {
    canvasWidth: number;
    canvasHeight: number;
    dirty: boolean;
    exporting: boolean;
    canExport: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onNew: () => void;
    onOpen: () => void;
    onSave: () => void;
    onSaveAs: () => void;
    onImport: () => void;
    onExport: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCanvasChange: (width: number, height: number) => void;
  }

  let {
    canvasWidth,
    canvasHeight,
    dirty,
    exporting,
    canExport,
    canUndo,
    canRedo,
    onNew,
    onOpen,
    onSave,
    onSaveAs,
    onImport,
    onExport,
    onUndo,
    onRedo,
    onCanvasChange,
  }: Props = $props();

  const ICON = 16;

  let w = $state(1920);
  let h = $state(1080);

  $effect(() => {
    w = canvasWidth;
    h = canvasHeight;
  });

  function applyCanvas() {
    const nw = Math.round(Number(w));
    const nh = Math.round(Number(h));
    if (!(nw > 0) || !(nh > 0)) {
      w = canvasWidth;
      h = canvasHeight;
      return;
    }
    onCanvasChange(nw, nh);
  }

  function onCanvasKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      applyCanvas();
      (e.target as HTMLElement).blur();
    }
  }
</script>

<header class="toolbar">
  <div class="group">
    <button type="button" class="ghost" onclick={onNew}>
      <FilePlus size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>New</span>
    </button>
    <button type="button" class="ghost" onclick={onOpen}>
      <FolderOpen size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Open</span>
    </button>
    <button
      type="button"
      class="ghost"
      onclick={onSave}
      title={dirty ? "Unsaved changes" : "Save"}
    >
      <Save size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Save{dirty ? " *" : ""}</span>
    </button>
    <button type="button" class="ghost" onclick={onSaveAs}>
      <SaveAll size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Save As</span>
    </button>
  </div>

  <div class="group">
    <button type="button" class="ghost" onclick={onImport}>
      <Film size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Import</span>
    </button>
    <button
      type="button"
      onclick={onExport}
      disabled={!canExport}
      title={exporting
        ? "Export in progress"
        : !canExport
          ? "Needs ffmpeg and at least one clip"
          : "Export H.264+AAC MP4"}
    >
      {#if exporting}
        <LoaderCircle class="spin" size={ICON} strokeWidth={2} aria-hidden="true" />
        <span>Exporting…</span>
      {:else}
        <Download size={ICON} strokeWidth={2} aria-hidden="true" />
        <span>Export</span>
      {/if}
    </button>
  </div>

  <div class="group">
    <button type="button" class="ghost" onclick={onUndo} disabled={!canUndo} title="Undo">
      <Undo2 size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Undo</span>
    </button>
    <button type="button" class="ghost" onclick={onRedo} disabled={!canRedo} title="Redo">
      <Redo2 size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Redo</span>
    </button>
  </div>

  <div class="group canvas">
    <Ratio size={ICON} strokeWidth={2} class="canvas-icon" aria-hidden="true" />
    <label>
      <span>W</span>
      <input
        class="compact"
        type="number"
        min="1"
        step="1"
        bind:value={w}
        onchange={applyCanvas}
        onkeydown={onCanvasKey}
      />
    </label>
    <span class="times">×</span>
    <label>
      <span>H</span>
      <input
        class="compact"
        type="number"
        min="1"
        step="1"
        bind:value={h}
        onchange={applyCanvas}
        onkeydown={onCanvasKey}
      />
    </label>
  </div>
</header>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem 1rem;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .group :global(button) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .canvas {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .canvas :global(.canvas-icon) {
    flex-shrink: 0;
    opacity: 0.75;
  }

  .canvas label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .canvas input {
    width: 4.5rem;
  }

  .times {
    opacity: 0.6;
    padding: 0 0.1rem;
  }

  :global(.spin) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
