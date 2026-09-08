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

  import {
    BTN,
    CONTROL_H,
    DIVIDER,
    FIELD,
    HEADING,
    MENU_ITEM,
    MENU_PANEL,
    TEXT_BTN,
    markedBtnClass,
    menuRadioClass,
    toggleClass,
  } from "$lib/ui";

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

  /** Menu trigger: the audio editor's ToolbarMenu look. */
  const trigger = (open: boolean): string =>
    `${CONTROL_H} gap-1 px-2 text-xs ` +
    (open ? "bg-raised text-text" : "text-muted hover:bg-raised hover:text-text");

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

<header
  class="relative z-40 flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-2 text-text"
>
  <!-- file -->
  <div class="flex items-center gap-1">
    <div class="relative shrink-0" data-toolbar-menu>
      <button
        type="button"
        class={trigger(openMenu === "file")}
        aria-haspopup="menu"
        aria-expanded={openMenu === "file"}
        title="File — New, Open, Save, Save As"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => toggle("file", e)}
      >
        File<span class="text-[9px] opacity-70" aria-hidden="true">▾</span>
      </button>
      {#if openMenu === "file"}
        <div class="{MENU_PANEL} left-0" role="menu">
          <button type="button" class={MENU_ITEM} role="menuitem" title="New project" onclick={() => runAndClose(onNew)}>
            <FilePlus size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>New</span>
          </button>
          <button type="button" class={MENU_ITEM} role="menuitem" title="Open project (⌘O)" onclick={() => runAndClose(onOpen)}>
            <FolderOpen size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>Open…</span>
            <span class="ml-auto pl-4 text-muted">⌘O</span>
          </button>
          <div class="my-1 border-t border-line"></div>
          <button
            type="button"
            class={MENU_ITEM}
            role="menuitem"
            title={dirty ? "Save project — unsaved changes (⌘S)" : "Save project (⌘S)"}
            onclick={() => runAndClose(onSave)}
          >
            <Save size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>Save{dirty ? " *" : ""}</span>
            <span class="ml-auto pl-4 text-muted">⌘S</span>
          </button>
          <button type="button" class={MENU_ITEM} role="menuitem" title="Save project as… (⌘⇧S)" onclick={() => runAndClose(onSaveAs)}>
            <SaveAll size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>Save As…</span>
          </button>
        </div>
      {/if}
    </div>

    <!-- Dirty state recolours the glyph: nothing is inserted, so nothing moves. -->
    <button
      type="button"
      class={markedBtnClass(dirty)}
      onclick={onSave}
      title={dirty ? "Save — unsaved changes (⌘S)" : "Save (⌘S)"}
      aria-label="Save"
    >
      <Save size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>

  <div class={DIVIDER}></div>

  <!-- import -->
  <div class="flex items-center gap-1">
    <button type="button" class={TEXT_BTN} onclick={onImport} title="Import videos (⌘I)">
      <Film size={ICON} strokeWidth={2} aria-hidden="true" />
      <span>Import</span>
    </button>
    <div class="relative shrink-0" data-toolbar-menu>
      <button
        type="button"
        class={trigger(openMenu === "import")}
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
        <div class="{MENU_PANEL} left-0" role="menu">
          <div class="{HEADING} px-3 py-1">Place clips</div>
          <button
            type="button"
            class={menuRadioClass(importPlacement === "append")}
            role="menuitemradio"
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
            class={menuRadioClass(importPlacement === "playhead")}
            role="menuitemradio"
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
            class={menuRadioClass(importPlacement === "new-tracks")}
            role="menuitemradio"
            aria-checked={importPlacement === "new-tracks"}
            title="Create a new track for each imported file (⌘⇧I)"
            onclick={() => {
              onImportPlacementChange("new-tracks");
              close();
            }}
          >
            Each → new track
          </button>
          <div class="my-1 border-t border-line"></div>
          <button type="button" class={MENU_ITEM} role="menuitem" title="Import video files (⌘I)" onclick={() => runAndClose(onImport)}>
            <Film size={ICON} strokeWidth={2} aria-hidden="true" />
            <span>Import now…</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class={DIVIDER}></div>

  <!-- edit -->
  <div class="flex items-center gap-1">
    <button type="button" class={BTN} onclick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
      <Undo2 size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
    <button type="button" class={BTN} onclick={onRedo} disabled={!canRedo} title="Redo (⌘⇧Z)" aria-label="Redo">
      <Redo2 size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>

  <!-- options + output, pushed right -->
  <div class="ml-auto flex items-center gap-1">
    <div class="relative shrink-0" data-toolbar-menu>
      <button
        type="button"
        class="{trigger(openMenu === 'canvas')} tabular-nums"
        aria-haspopup="dialog"
        aria-expanded={openMenu === "canvas"}
        title="Canvas size — presets and custom W×H ({canvasWidth}×{canvasHeight})"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => toggle("canvas", e)}
      >
        <Ratio size={ICON} strokeWidth={2} aria-hidden="true" />
        {canvasWidth}×{canvasHeight}<span class="text-[9px] opacity-70" aria-hidden="true">▾</span>
      </button>
      {#if openMenu === "canvas"}
        <div class="{MENU_PANEL} right-0 flex flex-col gap-2 px-3 pb-2" role="dialog" aria-label="Canvas size">
          <div class={HEADING}>Canvas</div>
          <div class="flex items-center gap-1 text-[11px] text-muted">
            <label class="flex items-center gap-1">
              <span>W</span>
              <input
                class="{FIELD} w-16"
                type="number"
                min="1"
                step="1"
                bind:value={w}
                onchange={applyCanvas}
                onkeydown={onCanvasKey}
              />
            </label>
            <span class="opacity-60">×</span>
            <label class="flex items-center gap-1">
              <span>H</span>
              <input
                class="{FIELD} w-16"
                type="number"
                min="1"
                step="1"
                bind:value={h}
                onchange={applyCanvas}
                onkeydown={onCanvasKey}
              />
            </label>
          </div>
          <div class="flex flex-wrap gap-1" role="group" aria-label="Canvas presets">
            {#each CANVAS_PRESETS as preset}
              <button
                type="button"
                class={toggleClass(canvasWidth === preset.w && canvasHeight === preset.h)}
                aria-pressed={canvasWidth === preset.w && canvasHeight === preset.h}
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

    <div class={DIVIDER}></div>

    <button
      type="button"
      class="{CONTROL_H} gap-1 bg-accent px-2 text-xs font-medium whitespace-nowrap text-ground hover:bg-accent-hover disabled:opacity-50 disabled:hover:bg-accent"
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
</header>
