<script lang="ts">
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
    <button type="button" class="ghost" onclick={onNew}>New</button>
    <button type="button" class="ghost" onclick={onOpen}>Open</button>
    <button type="button" class="ghost" onclick={onSave} title={dirty ? "Unsaved changes" : "Save"}>
      Save{dirty ? " *" : ""}
    </button>
    <button type="button" class="ghost" onclick={onSaveAs}>Save As</button>
  </div>

  <div class="group">
    <button type="button" class="ghost" onclick={onImport}>Import</button>
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
      {exporting ? "Exporting…" : "Export"}
    </button>
  </div>

  <div class="group">
    <button type="button" class="ghost" onclick={onUndo} disabled={!canUndo}>Undo</button>
    <button type="button" class="ghost" onclick={onRedo} disabled={!canRedo}>Redo</button>
  </div>

  <div class="group canvas">
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

  .canvas {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.85rem;
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
</style>
