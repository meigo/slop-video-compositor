<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Download from "@lucide/svelte/icons/download";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import Film from "@lucide/svelte/icons/film";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Ratio from "@lucide/svelte/icons/ratio";
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import Save from "@lucide/svelte/icons/save";
  import SaveAll from "@lucide/svelte/icons/save-all";
  import Undo2 from "@lucide/svelte/icons/undo-2";

  import type { ImportPlacement } from "../../state/appState.svelte";

  interface Props {
    canvasWidth: number;
    canvasHeight: number;
    dirty: boolean;
    exporting: boolean;
    canExport: boolean;
    canUndo: boolean;
    canRedo: boolean;
    importPlacement: ImportPlacement;
    onNew: () => void;
    onOpen: () => void;
    onSave: () => void;
    onSaveAs: () => void;
    onImport: () => void;
    onExport: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCanvasChange: (width: number, height: number) => void;
    onImportPlacementChange: (mode: ImportPlacement) => void;
  }

  let {
    canvasWidth,
    canvasHeight,
    dirty,
    exporting,
    canExport,
    canUndo,
    canRedo,
    importPlacement,
    onNew,
    onOpen,
    onSave,
    onSaveAs,
    onImport,
    onExport,
    onUndo,
    onRedo,
    onCanvasChange,
    onImportPlacementChange,
  }: Props = $props();

  const CANVAS_PRESETS = [
    { label: "1080p", w: 1920, h: 1080 },
    { label: "720p", w: 1280, h: 720 },
    { label: "Vertical", w: 1080, h: 1920 },
    { label: "Square", w: 1080, h: 1080 },
  ] as const;

  const PLACEMENT_LABEL: Record<ImportPlacement, string> = {
    append: "Append",
    playhead: "Playhead",
    "new-tracks": "New tracks",
  };

  const ICON = 16;
  const CHEV = 14;

  type MenuId = "file" | "import" | "canvas" | null;
  let openMenu = $state<MenuId>(null);

  let w = $state(1920);
  let h = $state(1080);

  $effect(() => {
    w = canvasWidth;
    h = canvasHeight;
  });

  function toggle(id: NonNullable<MenuId>, e?: Event) {
    e?.stopPropagation();
    openMenu = openMenu === id ? null : id;
  }

  function close() {
    openMenu = null;
  }

  function runAndClose(fn: () => void) {
    close();
    fn();
  }

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

  function onPreset(pw: number, ph: number) {
    onCanvasChange(pw, ph);
    close();
  }

  function onDocPointerDown(e: PointerEvent) {
    if (openMenu == null) return;
    const t = e.target as Node | null;
    if (t instanceof Element && t.closest("[data-toolbar-menu]")) return;
    close();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  onMount(() => {
    // Bubble phase (not capture) so the trigger's click can open first.
    document.addEventListener("pointerdown", onDocPointerDown);
    window.addEventListener("keydown", onKeyDown);
  });

  onDestroy(() => {
    document.removeEventListener("pointerdown", onDocPointerDown);
    window.removeEventListener("keydown", onKeyDown);
  });
</script>

<header class="toolbar">
  <div class="group">
    <!-- File: secondary project actions -->
    <div class="menu" data-toolbar-menu class:open={openMenu === "file"}>
      <button
        type="button"
        class="ghost menu-trigger"
        class:open={openMenu === "file"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "file"}
        title="File — New, Open, Save, Save As"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => toggle("file", e)}
      >
        <span>File</span>
        <ChevronDown size={CHEV} strokeWidth={2} aria-hidden="true" />
      </button>
      {#if openMenu === "file"}
        <div class="menu-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            title="New project"
            onclick={() => runAndClose(onNew)}
          >
            <FilePlus size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>New</span>
          </button>
          <button
            type="button"
            role="menuitem"
            title="Open project (⌘O)"
            onclick={() => runAndClose(onOpen)}
          >
            <FolderOpen size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>Open…</span>
            <kbd>⌘O</kbd>
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            title={dirty ? "Save project — unsaved changes (⌘S)" : "Save project (⌘S)"}
            onclick={() => runAndClose(onSave)}
          >
            <Save size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>Save{dirty ? " *" : ""}</span>
            <kbd>⌘S</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            title="Save project as… (⌘⇧S)"
            onclick={() => runAndClose(onSaveAs)}
          >
            <SaveAll size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>Save As…</span>
          </button>
        </div>
      {/if}
    </div>

    <button
      type="button"
      class="ghost"
      onclick={onSave}
      title={dirty ? "Unsaved changes" : "Save (⌘S)"}
    >
      <Save size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Save{dirty ? " *" : ""}</span>
    </button>
  </div>

  <div class="group">
    <!-- Import split: main action + options -->
    <div class="split" data-toolbar-menu>
      <button type="button" class="ghost split-main" onclick={onImport} title="Import videos (⌘I)">
        <Film size={ICON} strokeWidth={2} aria-hidden="true" />
        <span>Import</span>
      </button>
      <button
        type="button"
        class="ghost split-chev"
        class:open={openMenu === "import"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "import"}
        aria-label="Import placement options"
        title="Placement: {PLACEMENT_LABEL[importPlacement]}"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => toggle("import", e)}
      >
        <ChevronDown size={CHEV} strokeWidth={2} aria-hidden="true" />
      </button>
      {#if openMenu === "import"}
        <div class="menu-panel import-panel" role="menu">
          <div class="panel-label">Place clips</div>
          <button
            type="button"
            role="menuitemradio"
            class:active={importPlacement === "append"}
            aria-checked={importPlacement === "append"}
            title="Place each import after the last clip on the selected track"
            onclick={() => {
              onImportPlacementChange("append");
              close();
            }}
          >
            Append on track
          </button>
          <button
            type="button"
            role="menuitemradio"
            class:active={importPlacement === "playhead"}
            aria-checked={importPlacement === "playhead"}
            title="Place imports at the current playhead time"
            onclick={() => {
              onImportPlacementChange("playhead");
              close();
            }}
          >
            At playhead
          </button>
          <button
            type="button"
            role="menuitemradio"
            class:active={importPlacement === "new-tracks"}
            aria-checked={importPlacement === "new-tracks"}
            title="Create a new track for each imported file (⌘⇧I)"
            onclick={() => {
              onImportPlacementChange("new-tracks");
              close();
            }}
          >
            Each → new track
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            title="Import video files (⌘I)"
            onclick={() => runAndClose(onImport)}
          >
            <Film size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>Import now…</span>
          </button>
        </div>
      {/if}
    </div>

    <button
      type="button"
      onclick={onExport}
      disabled={!canExport}
      title={exporting
        ? "Export in progress"
        : !canExport
          ? "Needs ffmpeg and at least one clip"
          : "Export H.264+AAC MP4 at canvas size"}
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
    <button type="button" class="ghost icon-only" onclick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
      <Undo2 size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="ghost icon-only"
      onclick={onRedo}
      disabled={!canRedo}
      title="Redo (⌘⇧Z)"
    >
      <Redo2 size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>

  <div class="group canvas-group">
    <div class="menu menu-end" data-toolbar-menu class:open={openMenu === "canvas"}>
      <button
        type="button"
        class="ghost menu-trigger canvas-trigger"
        class:open={openMenu === "canvas"}
        aria-haspopup="dialog"
        aria-expanded={openMenu === "canvas"}
        title="Canvas size — presets and custom W×H ({canvasWidth}×{canvasHeight})"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => toggle("canvas", e)}
      >
        <Ratio size={ICON} strokeWidth={2} aria-hidden="true" />
        <span class="mono">{canvasWidth}×{canvasHeight}</span>
        <ChevronDown size={CHEV} strokeWidth={2} aria-hidden="true" />
      </button>
      {#if openMenu === "canvas"}
        <div class="menu-panel canvas-panel" role="dialog" aria-label="Canvas size">
          <div class="panel-label">Canvas</div>
          <div class="canvas-fields">
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
          <div class="presets" role="group" aria-label="Canvas presets">
            {#each CANVAS_PRESETS as preset}
              <button
                type="button"
                class="ghost preset"
                class:active={canvasWidth === preset.w && canvasHeight === preset.h}
                title="{preset.w}×{preset.h}"
                onclick={() => onPreset(preset.w, preset.h)}
              >
                {preset.label}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</header>

<style>
  .toolbar {
    position: relative;
    z-index: 40;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding: 0.4rem 0.65rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    min-width: 0;
    /* Must stay visible — overflow clips absolute menu panels */
    overflow: visible;
  }

  .group {
    position: relative;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .group :global(button) {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .canvas-group {
    margin-left: auto;
  }

  .icon-only {
    padding: 0.4em 0.5em;
  }

  /* —— Menus —— */
  .menu,
  .split {
    position: relative;
    display: inline-flex;
    align-items: stretch;
  }

  .menu-trigger {
    gap: 0.2rem;
  }

  .menu-trigger.open,
  .split-chev.open {
    border-color: var(--accent);
    color: var(--accent);
  }

  .split-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right-width: 0;
  }

  .split-chev {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    padding: 0.4em 0.35em;
    min-width: 1.6rem;
    justify-content: center;
  }

  .menu-panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 100;
    min-width: 11.5rem;
    padding: 0.3rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .menu-end .menu-panel {
    left: auto;
    right: 0;
  }

  .menu-panel hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.25rem 0;
  }

  .menu-panel :global(button) {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    text-align: left;
    padding: 0.4em 0.55em;
    border-radius: 5px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text);
    font-weight: 450;
    font-size: 0.85rem;
  }

  .menu-panel :global(button:hover) {
    background: var(--surface-2);
    border-color: transparent;
  }

  .menu-panel :global(button.active) {
    background: rgba(91, 140, 255, 0.12);
    color: var(--accent);
  }

  .menu-panel kbd {
    margin-left: auto;
    font-size: 0.7rem;
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-weight: 400;
  }

  .panel-label {
    padding: 0.25rem 0.5rem 0.35rem;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .import-panel {
    min-width: 12rem;
  }

  .canvas-panel {
    min-width: 14rem;
    gap: 0.45rem;
  }

  .canvas-fields {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.35rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .canvas-fields label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .canvas-fields input {
    width: 4.25rem;
  }

  .times {
    opacity: 0.6;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0 0.25rem 0.15rem;
  }

  .preset {
    padding: 0.25em 0.45em !important;
    width: auto !important;
    font-size: 0.75rem !important;
    background: var(--surface-2) !important;
    border-color: var(--border) !important;
  }

  .preset.active {
    border-color: var(--accent) !important;
    color: var(--accent) !important;
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
