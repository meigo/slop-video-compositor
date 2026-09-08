# Style Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `slop-video-compositor` so it looks like `slop-audio-editor` and the shared family spec, without changing a single behaviour.

**Architecture:** Tailwind 4 is added with the family `@theme` tokens. Chrome components are rewritten to utility classes with no `<style>` block; the timeline body and preview keep scoped CSS but every colour becomes a token. A temporary alias block in `app.css` keeps unmigrated components rendering between tasks and is deleted in the last task.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tauri 2, Tailwind 4 (`@tailwindcss/vite`), prettier with svelte and tailwind plugins, `@lucide/svelte` icons, vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-style-alignment-design.md` — read it first; every task cites its section.

## Global Constraints

- Appearance only. No handler, prop, shortcut, gesture, persistence or export change. `npm test` must stay at 19 files / 166 tests passing throughout.
- `npm run check` must report `0 ERRORS 0 WARNINGS` after every task.
- Token values are the family's, verbatim (spec §2). Never hard-code a hex in a component except the preview's `#000` letterbox.
- On-state classes are literals (`"bg-warn text-ground"`), never interpolated from a variable name.
- Shared class strings come from `src/lib/ui.ts`; do not redefine them in a component.
- Icons render at `size={16}` in bars, `size={14}` inline in text, `size={12}` inside clips.
- No `font-mono` anywhere; digits use `tabular-nums` in a fixed-width box.
- Work on branch `style-alignment`. Commit after every task with the trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011DQ5GhUokRgf45naWgDJtA
  ```
- Visual check for every task: `npm run dev`, open `http://localhost:1420` in a browser. Tauri calls fail gracefully there (the ffmpeg banner appears, no project loads), which is enough for the chrome. The timeline body needs `npm run tauri dev` with a project open.

---

### Task 1: Tailwind, tokens, shared classes, legacy bridge

Spec §1, §2, §10.

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Create: `.prettierrc.json`, `.prettierignore`
- Modify: `src/app.css` (full rewrite)
- Create: `src/lib/ui.ts`

**Interfaces:**
- Produces: every export in `src/lib/ui.ts` below, used by Tasks 2–6. The `--color-*` custom properties, used by Tasks 4 and 7. The `.slider` range class, used by Task 6. The `.spin` keyframe, used by Task 3.

- [ ] **Step 1: Install dependencies**

```bash
npm install -D tailwindcss@^4.2.2 @tailwindcss/vite@^4.2.2 prettier@^3.9.6 prettier-plugin-svelte@^4.1.1 prettier-plugin-tailwindcss@^0.8.1
```

Expected: `package.json` devDependencies gain those five entries; `package-lock.json` updates.

- [ ] **Step 2: Add format scripts and prettier config**

In `package.json` `"scripts"`, add after `"test"`:

```json
    "format": "prettier --write .",
    "format:check": "prettier --check ."
```

Create `.prettierrc.json`:

```json
{
  "printWidth": 100,
  "plugins": ["prettier-plugin-svelte", "prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/app.css",
  "overrides": [{ "files": "*.svelte", "options": { "parser": "svelte" } }]
}
```

Create `.prettierignore`:

```
node_modules
build
.svelte-kit
src-tauri/target
package-lock.json
docs
temp
```

- [ ] **Step 2b: Install ESLint and add the config**

```bash
npm install -D eslint@^10.10.0 @eslint/js@^10 typescript-eslint@^8.69.0 eslint-plugin-svelte@^3.23.0 globals@^16.5.0 eslint-config-prettier@^10.1.8 eslint-plugin-better-tailwindcss@^4.7.0
```

If `@eslint/js@^10` does not resolve, use the major that matches the installed `eslint` (`npm view eslint version`).

Add to `package.json` scripts after `format:check`:

```json
    "lint": "eslint src/"
```

Create `eslint.config.js` in the repo root:

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteConfig from "./svelte.config.js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import betterTailwind from "eslint-plugin-better-tailwindcss";

// Mirrors slop-audio-editor/eslint.config.js so the family lints the same way.
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-constant-condition": "warn",
      "prefer-const": ["warn", { destructuring: "all" }],
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
        svelteConfig,
      },
    },
  },
  {
    rules: {
      // svelte-check owns compiler + a11y diagnostics.
      "svelte/valid-compile": "off",
      // Drag gestures and the preview canvas write element geometry directly on purpose.
      "svelte/no-dom-manipulating": "off",
    },
  },
  {
    files: ["**/*.svelte"],
    rules: {
      "prefer-const": "off",
      "svelte/prefer-const": ["warn", { destructuring: "all" }],
    },
  },
  prettier,
  ...svelte.configs.prettier,
  {
    files: ["**/*.test.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Only the conflict/duplicate rules: two classes fighting over one property is decided by
    // Tailwind's emit order, not by the markup, and reads as a control that silently does nothing.
    files: ["**/*.svelte", "**/*.html"],
    plugins: { "better-tailwindcss": betterTailwind },
    settings: {
      "better-tailwindcss": { entryPoint: "src/app.css" },
    },
    rules: {
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-duplicate-classes": "warn",
      "better-tailwindcss/enforce-canonical-classes": "warn",
      "better-tailwindcss/no-unnecessary-whitespace": "warn",
    },
  },
  {
    ignores: ["build/", ".svelte-kit/", "src-tauri/"],
  },
);
```

Run: `npm run lint`
Expected: exit code 0 with **no errors**. Warnings in existing TypeScript are allowed; note their count in the task report and do not fix them (they are outside this work). If any rule reports an *error* on existing code that is not a Tailwind conflict, downgrade that one rule to `"warn"` in the config with a one-line comment and mention it in the report.

- [ ] **Step 3: Register the Vite plugin**

In `vite.config.js`, add the import at the top and the plugin after `sveltekit()`:

```js
import tailwindcss from "@tailwindcss/vite";
```

```js
  plugins: [sveltekit(), tailwindcss()],
```

- [ ] **Step 4: Rewrite `src/app.css`**

Replace the whole file with:

```css
@import "tailwindcss";

/* Shared slop timeline palette — see /Users/meigo/Projects/slop/SLOP-TIMELINE-UI.md.
   Roles, not hexes, are what component markup names: `bg-panel`, `border-line`, `text-muted`.
   Values are identical to slop-audio-editor's; if one changes, change both. */
@theme {
  --color-ground: #101013;
  --color-panel: #1e1e22;
  --color-raised: #2d2d33;
  --color-line: #2e2e35;
  --color-text: #f4f4f5;
  --color-muted: #a1a1aa;
  --color-media-clip: #172036;
  --color-media-clip-border: #384b75;
  --color-accent: #5b8cff;
  --color-accent-hover: #7aa3ff;
  --color-danger: #f87171;
  --color-warn: #f59e0b;
  --color-ok: #34d399;
  --color-disabled: #52525b;
}

/* Native controls are drawn by the browser: without these they keep the OS light palette. */
:root {
  color-scheme: dark;
  accent-color: var(--color-accent);
}

/* The browser's own focus ring is an OS blue; restate it in the app's accent, globally. */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

html,
body {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
body {
  overscroll-behavior: none;
}

/* Number inputs never show spinners: the family's fields are plain boxes. */
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* Range inputs: 4px track, 12px round thumb, fill rebuilt from --fill-from / --fill-to. */
input[type="range"].slider {
  --slider-fill: color-mix(in srgb, var(--color-accent) 50%, var(--color-raised));
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--color-raised) 0 var(--fill-from, 0%),
    var(--slider-fill) var(--fill-from, 0%) var(--fill-to, 0%),
    var(--color-raised) var(--fill-to, 0%) 100%
  );
  cursor: pointer;
}
input[type="range"].slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-accent);
  border: none;
}
input[type="range"].slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-accent);
  border: none;
}

/* Export button's in-progress icon. */
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------------------------------------------------------------------
   LEGACY BRIDGE — deleted in the last task of the style-alignment plan.
   Keeps components that still use the old token names and global button styles rendering
   while they are migrated one by one. Nothing new may reference anything below this line.
   ------------------------------------------------------------------------------------------ */
:root {
  --bg: var(--color-ground);
  --surface: var(--color-panel);
  --surface-2: var(--color-raised);
  --border: var(--color-line);
  --text: var(--color-text);
  --muted: var(--color-muted);
  --accent: var(--color-accent);
  --accent-hover: var(--color-accent-hover);
  --danger: var(--color-danger);
  --warn: var(--color-warn);
  --ok: var(--color-ok);
  --disabled: var(--color-disabled);
  font-size: 14px;
  line-height: 1.4;
}
button.legacy,
.legacy button {
  border-radius: 6px;
  border: 1px solid transparent;
  padding: 0.4em 0.75em;
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  cursor: pointer;
}
.legacy button:disabled {
  background: var(--disabled);
  color: var(--muted);
  cursor: not-allowed;
}
.legacy button.ghost {
  background: var(--surface-2);
  border-color: var(--border);
  color: var(--text);
}
.legacy input[type="text"],
.legacy input[type="number"],
.legacy input:not([type]) {
  border-radius: 6px;
  border: 1px solid var(--border);
  padding: 0.35em 0.55em;
  background: var(--bg);
  min-width: 0;
}
```

Then in `src/routes/+page.svelte`, add `legacy` to the shell class so the bridge applies:

```svelte
<div class="shell legacy" class:resizing={resizingTimeline}>
```

- [ ] **Step 5: Create `src/lib/ui.ts`**

```ts
/**
 * Shared class strings for the slop family look — see
 * docs/superpowers/specs/2026-09-08-style-alignment-design.md §1.
 *
 * Plain strings rather than `@apply`: in Tailwind 4 an `@apply` inside a component <style>
 * needs an `@reference` in every file. Every control in a bar is 24px tall (`h-6`); padding
 * alone gave icon buttons and text toggles different heights.
 */

/** Every bar control: 24px tall, centred, 4px radius. */
export const CONTROL_H = "flex h-6 shrink-0 items-center justify-center rounded";

/** Icon-only button, 24×24, transparent until hover. */
export const BTN = `${CONTROL_H} w-6 text-text hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent`;

/** Labelled button (icon + text), same height as BTN. */
export const TEXT_BTN = `${CONTROL_H} gap-1 px-2 text-xs whitespace-nowrap text-text hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent`;

/** 1px rule between toolbar groups. Whitespace alone reads as accidental at this size. */
export const DIVIDER = "mx-1 h-5 w-px shrink-0 bg-line";

export const MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-1 text-left text-xs whitespace-nowrap text-text hover:bg-raised";

/** Dropdown surface. Position (`left-0` / `right-0`) is added by the caller. */
export const MENU_PANEL =
  "absolute top-full z-30 mt-1 min-w-44 rounded border border-line bg-panel py-1 shadow-lg";

/** Text toggle. `onClass` is always a literal: "bg-accent text-ground" (document state) or
 *  "bg-warn text-ground" (session-only state). */
export const toggleClass = (on: boolean, onClass = "bg-accent text-ground"): string =>
  `${CONTROL_H} gap-1 px-2 text-xs whitespace-nowrap ` +
  (on ? `${onClass} font-medium` : "text-muted hover:bg-raised hover:text-text");

/** Icon toggle, 24×24. One string, never `class:` layered over BTN (equal specificity). */
export const toggleIconClass = (on: boolean, onClass = "bg-accent text-ground"): string =>
  `${CONTROL_H} w-6 ` + (on ? onClass : "text-text hover:bg-raised");

/** Single-letter toggle in a fixed 24px square (S / M / L). */
export const toggleSquareClass = (on: boolean): string =>
  `${CONTROL_H} w-6 text-xs font-bold ` +
  (on ? "bg-accent text-ground" : "text-muted hover:bg-raised hover:text-text");

/** Icon button whose glyph is recoloured to show state (the dirty Save). One string: adding
 *  `text-accent` after BTN's `text-text` would leave the winner to Tailwind's emit order. */
export const markedBtnClass = (marked: boolean): string =>
  marked
    ? `${CONTROL_H} w-6 text-accent hover:bg-raised`
    : BTN;

/** Inspector / bar input. `raised`, never `panel`: a panel-coloured field is invisible on a
 *  panel. */
export const FIELD =
  "h-6 w-full min-w-0 rounded bg-raised px-1 text-right text-xs text-text tabular-nums";

/** Bordered action button for panels (Relink, Reveal, Reset, Recheck). */
export const BORDERED_BTN =
  "inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs whitespace-nowrap text-muted hover:bg-raised hover:text-text disabled:opacity-30";

/** 28px thin strip: header rows, tool strips, status line. Caller adds `border-b` / `border-t`. */
export const STRIP =
  "flex h-7 shrink-0 items-center gap-1 border-line bg-panel px-2 text-[11px] text-muted";

/** Section heading inside a panel. */
export const HEADING = "text-[11px] tracking-wide text-muted uppercase";
```

- [ ] **Step 6: Verify build and tests**

Run: `npm run check && npm test`
Expected: `0 ERRORS 0 WARNINGS`; `19 passed (19)`, `166 passed (166)`.

Run: `npm run dev`, open `http://localhost:1420`.
Expected: the app renders as before, with slightly darker ground and lighter panel tones (the family values), no missing styles. The zoom slider is still the native one (it gets `.slider` in Task 6).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.js .prettierrc.json .prettierignore eslint.config.js src/app.css src/lib/ui.ts src/routes/+page.svelte
git commit -m "style: add Tailwind, prettier and eslint with the family tokens and a legacy bridge"
```

---

### Task 2: Shell, status line, ffmpeg banner

Spec §3, §8, §9.

**Files:**
- Modify: `src/routes/+page.svelte` (markup lines 273–375, delete the `<style>` block 376–472)
- Modify: `src/lib/components/StatusLine.svelte` (markup 31–55, delete `<style>` 57–140)
- Modify: `src/lib/components/MissingDeps.svelte` (markup 17–51, delete `<style>` 53–133)

**Interfaces:**
- Consumes: `BORDERED_BTN`, `STRIP` from `src/lib/ui.ts`.
- Produces: the flush shell that Tasks 3–6 sit in. `Toolbar`, `Transport`, `Inspector`, `Timeline` are still legacy-styled after this task; that is expected.

- [ ] **Step 1: Rewrite the shell markup in `+page.svelte`**

Replace from `<div class="shell legacy"` through the closing `</div>` of the shell (line 374) with:

```svelte
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
```

Note the grid template is inline because Tailwind will not generate an arbitrary value containing a comma. The `.shell :global(header.toolbar) { z-index: 40 }` rule is gone; Task 3 puts `relative z-40` on the toolbar itself.

- [ ] **Step 2: Delete the `<style>` block in `+page.svelte`**

Remove everything from `<style>` to `</style>` at the end of the file.

- [ ] **Step 3: Rewrite `StatusLine.svelte` markup and drop its style**

Replace from `<div class="status-line"` to the end of the file with:

```svelte
<div
  class="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-panel px-3 text-[11px] text-muted"
  role="status"
>
  <span class="flex shrink-0 items-center gap-1">
    <FileText size={14} strokeWidth={2} class="opacity-75" aria-hidden="true" />
    <strong class="font-medium text-text">{label}</strong>
    {#if dirty}
      <span class="font-bold text-accent" title="Unsaved changes">•</span>
    {/if}
  </span>
  <span class="opacity-45" aria-hidden="true">·</span>
  <span class="flex min-w-0 items-center gap-1 {isError ? 'text-danger' : ''}">
    {#if isError}
      <CircleAlert size={14} strokeWidth={2} class="shrink-0" aria-hidden="true" />
    {:else}
      <Info size={14} strokeWidth={2} class="shrink-0 opacity-80" aria-hidden="true" />
    {/if}
    <span class="truncate">{status}</span>
  </span>
  {#if showHint}
    <span class="opacity-45" aria-hidden="true">·</span>
    <span class="flex min-w-0 flex-1 items-center gap-1" title={hint}>
      <Lightbulb size={14} strokeWidth={2} class="shrink-0 text-accent" aria-hidden="true" />
      <span class="truncate">{hint}</span>
    </span>
  {/if}
</div>
```

- [ ] **Step 4: Rewrite `MissingDeps.svelte` markup and drop its style**

Replace from `<div class="banner"` to the end of the file with:

```svelte
<div
  class="flex shrink-0 items-center gap-2 border-b border-line bg-danger/25 px-3 py-1 text-xs"
  role="alert"
>
  <TriangleAlert size={16} strokeWidth={2} class="shrink-0 text-danger" aria-hidden="true" />
  <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
    <strong class="font-medium text-text">ffmpeg not found</strong>
    <span class="text-muted">
      Install with
      <code class="inline-flex items-center gap-1 rounded bg-ground px-1 tabular-nums">
        <Terminal size={12} strokeWidth={2} class="opacity-80" aria-hidden="true" />
        brew install ffmpeg
      </code>
      {#if deps.ffmpeg_path}
        · path: {deps.ffmpeg_path}
      {/if}
    </span>
    <span class="inline-flex items-center gap-1 {deps.ffmpeg ? 'text-ok' : 'text-danger'}">
      {#if deps.ffmpeg}
        <Check size={14} strokeWidth={2.25} aria-hidden="true" />
      {:else}
        <X size={14} strokeWidth={2.25} aria-hidden="true" />
      {/if}
      <span>ffmpeg</span>
    </span>
  </div>
  <button type="button" class={BORDERED_BTN} onclick={onRecheck} title="Check PATH for ffmpeg again">
    <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
    <span>Recheck</span>
  </button>
</div>
```

Add to the script imports:

```ts
  import { BORDERED_BTN } from "$lib/ui";
```

- [ ] **Step 5: Verify**

Run: `npm run check && npm run lint && npm test`
Expected: `0 ERRORS 0 WARNINGS` from svelte-check; lint exits 0 with no errors; 166 tests pass.

Browser at `http://localhost:1420`: the window is edge to edge with no rounded cards; the ffmpeg banner is a flush red-tinted strip at the top; the status line is a 28px panel strip at the bottom reading "Untitled · Deps check failed…" in danger; the splitter is a thin panel strip with a short grip. The toolbar, inspector and timeline still have their old chip buttons (migrated in Tasks 3–6).

- [ ] **Step 6: Commit**

```bash
git add src/routes/+page.svelte src/lib/components/StatusLine.svelte src/lib/components/MissingDeps.svelte
git commit -m "style: flush shell, status line at the bottom, banner on tokens"
```

---

### Task 3: Toolbar

Spec §4.

**Files:**
- Modify: `src/lib/components/Toolbar.svelte` (markup 148–394 replaced; `<style>` 396–608 deleted; script: swap `ICON`/`CHEV`, add ui import)

**Interfaces:**
- Consumes: `BTN`, `TEXT_BTN`, `DIVIDER`, `MENU_ITEM`, `MENU_PANEL`, `CONTROL_H`, `FIELD`, `HEADING`, `toggleClass` from `src/lib/ui.ts`; `.spin` from `app.css`.
- Produces: nothing other tasks use. All props and handlers unchanged.

- [ ] **Step 1: Script changes**

Replace the two constants:

```ts
  const ICON = 18;
  const CHEV = 16;
```

with:

```ts
  const ICON = 16;
  const CHEV = 14;

  /** Menu trigger: the audio editor's ToolbarMenu look. */
  const trigger = (open: boolean): string =>
    `${CONTROL_H} gap-1 px-2 text-xs ` +
    (open ? "bg-raised text-text" : "text-muted hover:bg-raised hover:text-text");
  /** `menuitemradio`: the checked item reads in accent. */
  const radioItem = (checked: boolean): string =>
    `${MENU_ITEM} ${checked ? "text-accent" : ""}`;
```

Add the import after the lucide imports:

```ts
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
    toggleClass,
  } from "$lib/ui";
```

Everything else in the script (menu state, `toggle`, `close`, `runAndClose`, `applyCanvas`, `onCanvasKey`, `onPreset`, document listeners) stays exactly as is.

- [ ] **Step 2: Replace the markup**

Replace from `<header class="toolbar">` through `</header>` with:

```svelte
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
            class={radioItem(importPlacement === "append")}
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
            class={radioItem(importPlacement === "playhead")}
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
            class={radioItem(importPlacement === "new-tracks")}
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
```

- [ ] **Step 3: Delete the `<style>` block**

Remove everything from `<style>` to `</style>`.

- [ ] **Step 4: Verify**

Run: `npm run check && npm run lint && npm test`
Expected: `0 ERRORS 0 WARNINGS` from svelte-check; lint exits 0 with no errors; 166 tests pass.

Browser: a 44px panel bar. Left to right: "File ▾" text trigger, save icon, divider, "Import" with film icon, a chevron trigger, divider, undo and redo icons, then far right "1920×1080 ▾", divider, a blue filled Export button (disabled at 50% because ffmpeg is missing). Click File: dropdown on panel with a line border, items highlight raised on hover, ⌘O and ⌘S right-aligned in muted. Escape closes it. Click the import chevron: "PLACE CLIPS" heading, the checked placement in accent text. Click the canvas trigger: W and H raised fields, four preset toggles with the matching one filled accent. Nothing in the bar is taller than 24px.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Toolbar.svelte
git commit -m "style: toolbar on 24px borderless controls with group dividers"
```

---

### Task 4: Transport and preview

Spec §5.

**Files:**
- Modify: `src/lib/components/Transport.svelte` (markup 48–140 replaced; `<style>` 142–176 deleted; add ui import)
- Modify: `src/lib/components/Preview.svelte` (markup 1412–1445 badges only; `<style>` 1472–1605 rewritten; `.decoder` rule 1607–1620 untouched)

**Interfaces:**
- Consumes: `BTN`, `toggleIconClass` from `src/lib/ui.ts`; `--color-*` tokens.

- [ ] **Step 1: Transport script import**

After the `formatTimestamp` import add:

```ts
  import { BTN, toggleIconClass } from "$lib/ui";
```

- [ ] **Step 2: Replace the transport markup**

Replace from `<div class="transport">` to the end of the file with:

```svelte
<div class="flex h-7 shrink-0 items-center gap-1 border-t border-line bg-panel px-2">
  {#if onHome}
    <button type="button" class={BTN} onclick={onHome} title="Go to start (Home)" aria-label="Go to start">
      <SkipBack size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  {#if onPrevCut}
    <button type="button" class={BTN} onclick={onPrevCut} title="Previous cut or marker ([)" aria-label="Previous cut or marker">
      <ChevronLeft size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  <button
    type="button"
    class={BTN}
    onclick={onTogglePlay}
    title={playing ? "Pause (Space)" : "Play (Space)"}
    aria-label={playing ? "Pause" : "Play"}
  >
    {#if playing}
      <Pause size={ICON} strokeWidth={2} aria-hidden="true" />
    {:else}
      <Play size={ICON} strokeWidth={2} aria-hidden="true" />
    {/if}
  </button>
  <button type="button" class={BTN} onclick={onStop} title="Stop and return to start" aria-label="Stop">
    <Square size={ICON} strokeWidth={2} aria-hidden="true" />
  </button>
  {#if onNextCut}
    <button type="button" class={BTN} onclick={onNextCut} title="Next cut or marker (])" aria-label="Next cut or marker">
      <ChevronRight size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  {#if onEnd}
    <button type="button" class={BTN} onclick={onEnd} title="Go to end (End)" aria-label="Go to end">
      <SkipForward size={ICON} strokeWidth={2} aria-hidden="true" />
    </button>
  {/if}
  <button
    type="button"
    class={toggleIconClass(loop)}
    onclick={onToggleLoop}
    title={loop ? "Loop playback: on (L)" : "Loop playback: off (L)"}
    aria-label="Loop playback"
    aria-pressed={loop}
  >
    <Repeat size={ICON} strokeWidth={2} aria-hidden="true" />
  </button>
  <!-- warn, not accent: preview mute is session-only and never reaches the export. -->
  <button
    type="button"
    class={toggleIconClass(muted, "bg-warn text-ground")}
    onclick={onToggleMute}
    title={muted ? "Unmute preview" : "Mute preview (preview only)"}
    aria-label={muted ? "Unmute" : "Mute"}
    aria-pressed={muted}
  >
    {#if muted}
      <VolumeX size={ICON} strokeWidth={2} aria-hidden="true" />
    {:else}
      <Volume2 size={ICON} strokeWidth={2} aria-hidden="true" />
    {/if}
  </button>
  <span class="ml-2 w-28 text-sm tabular-nums" aria-label="Playhead time">
    {formatTimestamp(playhead)}<span class="text-muted"> / {formatTimestamp(duration)}</span>
  </span>
</div>
```

- [ ] **Step 3: Preview badge markup**

In `Preview.svelte` replace the two badge elements:

```svelte
        <div class="frame-label mono" aria-hidden="true">{canvasW}×{canvasH}</div>
```

with:

```svelte
        <div class="frame-label" aria-hidden="true">{canvasW}×{canvasH}</div>
```

and the whole `<div class="view-hud">…</div>` with:

```svelte
  <div class="view-hud">
    {#if viewZoom !== 1 || viewPanX !== 0 || viewPanY !== 0}
      <span class="hud-value">{Math.round(viewZoom * 100)}%</span>
      <button type="button" class="fit-btn" onclick={resetViewport} title="Fit & center (double-click)">
        Fit
      </button>
    {:else}
      <span class="hud-value hud-resting">fit</span>
    {/if}
  </div>
```

- [ ] **Step 4: Preview CSS**

Replace the rules from `.preview-frame` through `.fit-btn` (everything before the `Off-screen decoders` comment) with:

```css
  .preview-frame {
    flex: 1;
    min-height: 200px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-ground);
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
    /* Checkerboard outside the output frame so the project rect reads clearly. */
    background-color: var(--color-ground);
    background-image:
      linear-gradient(45deg, var(--color-panel) 25%, transparent 25%),
      linear-gradient(-45deg, var(--color-panel) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--color-panel) 75%),
      linear-gradient(-45deg, transparent 75%, var(--color-panel) 75%);
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
    box-sizing: border-box;
  }

  .output-frame {
    position: relative;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    outline: 1px solid var(--color-raised);
    /* The letterbox is content, not chrome: it stays black. */
    background: #000;
    overflow: hidden;
  }

  .frame-label,
  .view-hud {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-ground) 70%, transparent);
    color: var(--color-muted);
    font-size: 10px;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
  }

  .frame-label {
    top: 4px;
    left: 4px;
    pointer-events: none;
    z-index: 1;
  }

  .view-hud {
    right: 6px;
    bottom: 6px;
    z-index: 2;
  }

  .hud-value {
    min-width: 32px;
    text-align: right;
    color: var(--color-text);
  }

  .hud-resting {
    min-width: auto;
    color: var(--color-muted);
  }

  .fit-btn {
    height: 20px;
    padding: 0 4px;
    border-radius: 4px;
    font-size: 10px;
    color: var(--color-text);
    cursor: pointer;
  }

  .fit-btn:hover {
    background: var(--color-raised);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
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
```

Leave the `.decoder` rule and its comment exactly as they are.

- [ ] **Step 5: Verify**

Run: `npm run check && npm run lint && npm test`
Expected: svelte-check clean; lint exits 0 with no errors; 166 pass.

Browser: under the preview a 28px panel strip with seven 24px icon buttons and a `00:00 / 00:00` readout, total in muted. Click Loop: it fills blue. Click mute: it fills amber with the crossed speaker. The preview area is a subtle ground/panel checkerboard with the black output frame outlined in raised, a small "1920×1080" pill top-left and a "fit" pill bottom-right.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/Transport.svelte src/lib/components/Preview.svelte
git commit -m "style: transport strip and preview chrome on family tokens"
```

---

### Task 5: Inspector

Spec §6.

**Files:**
- Modify: `src/lib/components/Inspector.svelte` (markup 47–208 replaced; `<style>` 210–409 deleted; add ui import)

**Interfaces:**
- Consumes: `BORDERED_BTN`, `FIELD`, `HEADING`, `STRIP`, `toggleClass` from `src/lib/ui.ts`.
- Props and `onUpdate` payloads unchanged.

- [ ] **Step 1: Script import and row helper**

After the `types` import add:

```ts
  import { BORDERED_BTN, FIELD, HEADING, STRIP, toggleClass } from "$lib/ui";

  /** label | field | unit — one grid, so every row's field column lines up. Set inline:
   *  Tailwind will not generate an arbitrary value containing a comma. */
  const GRID = "grid-template-columns: auto minmax(0, 1fr) auto";
  const LABEL = "text-right text-[11px] whitespace-nowrap text-muted";
  const UNIT = "w-4 text-[11px] text-muted";
```

- [ ] **Step 2: Replace the markup**

Replace from `<aside class="inspector"` through `</aside>` with:

```svelte
<aside class="flex min-h-0 min-w-0 flex-col border-l border-line bg-panel" aria-label="Inspector">
  <div class="{STRIP} border-b">Inspector</div>

  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 text-xs">
    {#if !clip}
      <p class="text-xs text-muted">Select a clip to edit</p>
    {:else}
      <section class="flex flex-col gap-1.5">
        <h3 class={HEADING}>Source</h3>
        <div class="flex min-w-0 items-center gap-1.5" title={clip.sourcePath}>
          <span
            class="size-2.5 shrink-0 rounded-sm border border-line"
            style:background={clipColorSolid(clip.sourcePath)}
            title="Timeline color for this source file"
            aria-hidden="true"
          ></span>
          <Film size={14} strokeWidth={2} class="shrink-0 opacity-75" aria-hidden="true" />
          <span class="truncate text-text">{truncateMiddle(basename(clip.sourcePath), 40)}</span>
        </div>
        {#if !meta}
          <span class="inline-flex items-center gap-1 text-[11px] text-danger">
            <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
            Missing media — relink to restore
          </span>
        {:else}
          <span class="inline-flex items-center gap-1 text-[11px] text-muted tabular-nums">
            {#if meta.width > 0 && meta.height > 0}
              {meta.width}×{meta.height}
            {:else}
              audio only
            {/if}
            · {formatTimestamp(meta.duration)}
            ·
            {#if meta.hasAudio}
              <Volume2 size={13} strokeWidth={2} aria-hidden="true" />
              audio
            {:else}
              <VolumeX size={13} strokeWidth={2} aria-hidden="true" />
              no audio
            {/if}
          </span>
        {/if}
        <div class="flex flex-wrap gap-1">
          <button type="button" class={BORDERED_BTN} onclick={onRelink} title="Choose a new file for this clip’s source path">
            <Link2 size={14} strokeWidth={2} aria-hidden="true" />
            <span>Relink…</span>
          </button>
          <button type="button" class={BORDERED_BTN} onclick={onReveal} title="Reveal source in Finder">
            <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
            <span>Reveal</span>
          </button>
        </div>
      </section>

      <section class="grid items-center gap-x-2 gap-y-2 border-t border-line pt-2" style={GRID}>
        <label class="contents">
          <span class={LABEL}>Source in</span>
          <input
            class={FIELD}
            type="number"
            step="0.01"
            min="0"
            value={roundTo(clip.sourceIn, 2)}
            onchange={(e) => onUpdate({ sourceIn: num(e, 2) })}
          />
          <span class={UNIT}>s</span>
        </label>
        <label class="contents">
          <span class={LABEL}>Source out</span>
          <input
            class={FIELD}
            type="number"
            step="0.01"
            min="0"
            value={roundTo(clip.sourceOut, 2)}
            onchange={(e) => onUpdate({ sourceOut: num(e, 2) })}
          />
          <span class={UNIT}>s</span>
        </label>
        <label class="contents">
          <span class={LABEL}>Timeline start</span>
          <input
            class={FIELD}
            type="number"
            step="0.01"
            min="0"
            value={roundTo(clip.timelineStart, 2)}
            onchange={(e) => onUpdate({ timelineStart: num(e, 2) })}
          />
          <span class={UNIT}>s</span>
        </label>
        <span class={LABEL}>Duration</span>
        <span
          class="flex h-6 w-full min-w-0 items-center justify-end gap-1 rounded bg-raised px-1 text-xs text-muted tabular-nums"
          title="Clip duration (read-only)"
        >
          {formatTimestamp(clip.sourceOut - clip.sourceIn)}
          <span>({roundTo(clip.sourceOut - clip.sourceIn, 2)}s)</span>
        </span>
        <span class={UNIT}></span>
        <span class={LABEL}>Audio</span>
        <button
          type="button"
          class="{toggleClass(clip.muted === true)} justify-self-start"
          aria-pressed={clip.muted === true}
          title={meta != null && !meta.hasAudio
            ? "Source has no audio (mute still silences if audio appears after relink)"
            : "Silence this clip in preview and export"}
          onclick={() => onUpdate({ muted: clip.muted !== true })}
        >
          {#if clip.muted}
            <VolumeX size={14} strokeWidth={2} aria-hidden="true" />
          {:else}
            <Volume2 size={14} strokeWidth={2} aria-hidden="true" />
          {/if}
          Mute
        </button>
        <span class={UNIT}></span>
      </section>

      <section class="grid items-center gap-x-2 gap-y-2 border-t border-line pt-2" style={GRID}>
        <h3 class="{HEADING} col-span-3">Transform</h3>
        <label class="contents">
          <span class={LABEL}>Scale</span>
          <input
            class={FIELD}
            type="number"
            step="0.05"
            min="0.05"
            max="8"
            value={roundTo(clip.transform.scale, 2)}
            onchange={(e) => onUpdate({ transform: { scale: num(e, 2) } })}
          />
          <span class={UNIT}>×</span>
        </label>
        <label class="contents">
          <span class={LABEL}>X</span>
          <input
            class={FIELD}
            type="number"
            step="1"
            value={roundTo(clip.transform.x, 0)}
            onchange={(e) => onUpdate({ transform: { x: num(e, 0) } })}
          />
          <span class={UNIT}>px</span>
        </label>
        <label class="contents">
          <span class={LABEL}>Y</span>
          <input
            class={FIELD}
            type="number"
            step="1"
            value={roundTo(clip.transform.y, 0)}
            onchange={(e) => onUpdate({ transform: { y: num(e, 0) } })}
          />
          <span class={UNIT}>px</span>
        </label>
        <div class="col-span-3">
          <button type="button" class={BORDERED_BTN} onclick={onResetTransform} title="Reset scale and position to default">
            <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
            <span>Reset transform</span>
          </button>
        </div>
      </section>
    {/if}
  </div>
</aside>
```

The mute handler flips the boolean directly (`clip.muted !== true`) — same `onUpdate({ muted })` call the checkbox made, same values.

- [ ] **Step 3: Delete the `<style>` block**

Remove everything from `<style>` to `</style>`.

- [ ] **Step 4: Verify**

Run: `npm run check && npm run lint && npm test`
Expected: svelte-check clean; lint exits 0 with no errors; 166 pass.

Browser: the right column is panel-coloured with a 28px "Inspector" strip and "Select a clip to edit" in muted. With a clip selected (Tauri dev): "SOURCE" heading, swatch + name, meta line, bordered Relink… / Reveal; a rule; rows with right-aligned labels and raised right-aligned fields; a Mute toggle that fills blue when on; a rule; "TRANSFORM" with Scale / X / Y and the bordered Reset transform.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Inspector.svelte
git commit -m "style: inspector as a panel with label-field-unit rows"
```

---

### Task 6: Timeline header row and tool strip

Spec §7 (bars only). The body is Task 7.

**Files:**
- Modify: `src/lib/components/Timeline.svelte` — markup 826–1041 replaced; script adds ui import; CSS rules for `.timeline`, `.timeline-head`, `.head-left`, `.head-right`, `.title`, `.muted`, `.mono`, `.zoom`, `.zoom :global(.zoom-icon)`, `.zoom input[type="range"]`, `.zoom-fit`, `.head-right :global(button)`, `.duration-field`, `.duration-field input`, `.duration-label`, `.timeline-tools`, `.tool-group`, `.tool-sep`, `.timeline-tools :global(.tool-btn)`, `.timeline-tools :global(.tool-btn.on)`, `.timeline-tools :global(.tool-btn-sq)`, `.tool-sep-inline`, `.io-key`, `.tool-hint`, and the `@media (max-width: 900px)` block are deleted.

**Interfaces:**
- Consumes: `DIVIDER`, `FIELD`, `HEADING`, `TEXT_BTN`, `toggleClass` from `src/lib/ui.ts`; `.slider` from `app.css`; `MIN_PPS`, `MAX_PPS`, `pxPerSecond` already in the component.

- [ ] **Step 1: Script import**

After the `clipColorCssVars` import add:

```ts
  import { DIVIDER, FIELD, HEADING, TEXT_BTN, toggleClass, toggleSquareClass } from "$lib/ui";
```

`Layers` and `ZoomIn` stay imported (still used below).

- [ ] **Step 2: Replace the section opening, header row and tool strip**

Replace from `<section class="timeline" aria-label="Timeline">` through the closing `</div>` of `<div class="timeline-tools" …>` (line 1041) with:

```svelte
<section class="flex h-full min-h-0 min-w-0 flex-col bg-ground" aria-label="Timeline">
  <div class="flex h-7 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-panel px-2 text-[11px] whitespace-nowrap text-muted">
    <span class="{HEADING} inline-flex items-center gap-1">
      <Layers size={14} strokeWidth={2} aria-hidden="true" />
      Timeline
    </span>
    <span>
      {p.tracks.length} track{p.tracks.length === 1 ? "" : "s"}
      · {clipCount} clip{clipCount === 1 ? "" : "s"}
      · {markerCount} marker{markerCount === 1 ? "" : "s"}
      · top = highest priority
    </span>
    <label
      class="ml-2 inline-flex items-center gap-1"
      title="Sequence end (program out). Values shorter than media trim clips past that time."
    >
      <span>Length</span>
      <input
        class="{FIELD} w-16"
        type="number"
        min="0"
        step="0.1"
        bind:value={durationInput}
        onchange={applyDurationInput}
        onkeydown={onDurationKey}
        aria-label="Timeline length in seconds"
      />
      <span>s</span>
      <span class="min-w-11 text-text tabular-nums">{formatTimestamp(seqDuration)}</span>
    </label>
    <div class="ml-auto flex shrink-0 items-center gap-1">
      <label class="inline-flex items-center gap-1">
        <ZoomIn size={14} strokeWidth={2} class="opacity-75" aria-hidden="true" />
        <span>Zoom</span>
        <input
          type="range"
          class="slider w-28"
          style="--fill-from: 0%; --fill-to: {((pxPerSecond - MIN_PPS) / (MAX_PPS - MIN_PPS)) * 100}%"
          min={MIN_PPS}
          max={MAX_PPS}
          step="1"
          value={pxPerSecond}
          oninput={onZoomInput}
          aria-label="Timeline zoom pixels per second"
        />
        <span class="w-14 text-right tabular-nums">{Math.round(pxPerSecond)} px/s</span>
      </label>
      <button
        type="button"
        class={TEXT_BTN}
        onclick={fitZoomToWidth}
        title="Fit sequence to timeline width (100%)"
        aria-label="Fit sequence to timeline width"
      >
        <Maximize2 size={14} strokeWidth={2} aria-hidden="true" />
        <span>Fit</span>
      </button>
      <div class={DIVIDER}></div>
      <button type="button" class={TEXT_BTN} onclick={onAddTrack} title="Add video track" aria-label="Add track">
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        <span>Track</span>
      </button>
    </div>
  </div>

  <!-- Discoverable edit tools (keyboard shortcuts still work). -->
  <div
    class="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2 text-[11px] whitespace-nowrap text-muted"
    role="toolbar"
    aria-label="Timeline tools"
  >
    <div class="flex items-center gap-1" role="group" aria-label="Navigate">
      <button type="button" class={TEXT_BTN} onclick={() => seekPrevCut()} title="Previous cut or marker ([)" aria-label="Previous cut or marker">
        <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        <span>Prev</span>
      </button>
      <button type="button" class={TEXT_BTN} onclick={() => seekNextCut()} title="Next cut or marker (])" aria-label="Next cut or marker">
        <span>Next</span>
        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
    <div class={DIVIDER}></div>
    <div class="flex items-center gap-1" role="group" aria-label="Edit">
      <button
        type="button"
        class={TEXT_BTN}
        onclick={splitSelectedAtPlayhead}
        disabled={!app.selectedClipId}
        title="Split selected clip at playhead (S)"
        aria-label="Split clip at playhead"
      >
        <Scissors size={16} strokeWidth={2} aria-hidden="true" />
        <span>Split</span>
      </button>
      <button
        type="button"
        class={TEXT_BTN}
        onclick={() => deleteSelectedClips()}
        disabled={!hasSelection}
        title="Delete selected clip(s) (Delete)"
        aria-label="Delete selected clips"
      >
        <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
        <span>Delete</span>
      </button>
    </div>
    <div class={DIVIDER}></div>
    <div class="flex items-center gap-1" role="group" aria-label="Display">
      <button
        type="button"
        class={toggleClass(app.showFilmstrips)}
        onclick={onToggleFilmstrips}
        title={app.showFilmstrips
          ? "Hide filmstrips / audio waveforms (ffmpeg)"
          : "Show filmstrips / audio waveforms (ffmpeg)"}
        aria-label="Toggle filmstrips"
        aria-pressed={app.showFilmstrips}
      >
        {#if app.showFilmstrips}
          <Image size={16} strokeWidth={2} aria-hidden="true" />
        {:else}
          <ImageOff size={16} strokeWidth={2} aria-hidden="true" />
        {/if}
        <span>Thumbs</span>
      </button>
      {#each ["s", "m", "l"] as size (size)}
        <button
          type="button"
          class={toggleSquareClass(app.trackRowSize === size)}
          onclick={() => setTrackRowSize(size as TrackRowSize)}
          title={trackRowMetrics(size as TrackRowSize).title}
          aria-label={trackRowMetrics(size as TrackRowSize).title}
          aria-pressed={app.trackRowSize === size}
        >
          {trackRowMetrics(size as TrackRowSize).label}
        </button>
      {/each}
    </div>
    <div class={DIVIDER}></div>
    <div class="flex items-center gap-1" role="group" aria-label="Play range">
      <!-- warn: the play range is preview-only and never reaches the export. -->
      <button
        type="button"
        class={toggleClass(app.playIn != null, "bg-warn text-ground")}
        onclick={() => setPlayInAtPlayhead()}
        title="Set play-in at playhead (I) — preview only"
        aria-label="Set play in"
        aria-pressed={app.playIn != null}
      >
        <span class="font-bold">I</span>
        <span>In</span>
      </button>
      <button
        type="button"
        class={toggleClass(app.playOut != null, "bg-warn text-ground")}
        onclick={() => setPlayOutAtPlayhead()}
        title="Set play-out at playhead (O) — preview only"
        aria-label="Set play out"
        aria-pressed={app.playOut != null}
      >
        <span class="font-bold">O</span>
        <span>Out</span>
      </button>
      <button
        type="button"
        class={TEXT_BTN}
        onclick={() => clearPlayRange()}
        disabled={!rangeActive}
        title="Clear play range (Esc)"
        aria-label="Clear play range"
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
        <span>Clear</span>
      </button>
      {#if rangeActive}
        <span class="tool-hint tabular-nums" title="Preview plays only this range; export is unchanged">
          {formatTimestamp(bounds.start)}–{formatTimestamp(bounds.end)}
        </span>
      {/if}
    </div>
    <div class={DIVIDER}></div>
    <div class="flex items-center gap-1" role="group" aria-label="Markers">
      <button
        type="button"
        class={TEXT_BTN}
        onclick={() => addMarkerAtPlayhead()}
        title="Add marker at playhead (M) — click seek, double-click rename, Alt+click remove"
        aria-label="Add marker at playhead"
      >
        <BookmarkPlus size={16} strokeWidth={2} aria-hidden="true" />
        <span>Marker</span>
      </button>
      <span class="tool-hint" title="Markers are seek bookmarks (not exported). ⌥/Alt-drag duplicates clips.">
        dbl-click rename · ⌥-drag copy
      </span>
    </div>
  </div>
```

- [ ] **Step 3: Delete the bar CSS and keep one rule**

Delete the rules listed in **Files** above. Replace the deleted `@media (max-width: 900px)` block with this single rule (the hint hide is the one bar rule that stays scoped):

```css
  @media (max-width: 900px) {
    .tool-hint {
      display: none;
    }
  }
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm run lint && npm test`
Expected: svelte-check clean; lint exits 0 with no errors; 166 pass. If svelte-check warns about an unused CSS selector, delete that selector.

Browser: the timeline area has two 28px panel strips. Top: "TIMELINE" with counts, a raised Length field, then right-aligned Zoom with a thin slider and blue thumb, Fit, a divider, "+ Track". Second strip: Prev Next | Split Delete | Thumbs S M L | I In O Out Clear | Marker + hint, all 24px tall. Thumbs and M are filled blue. Click In: it fills amber. The body below still has its legacy look (Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Timeline.svelte
git commit -m "style: timeline header and tool strip as family thin strips"
```

---

### Task 7: Timeline body on tokens

Spec §7 (body). Scoped CSS stays; markup changes are limited to the play range, the playhead head, and removing legacy class names.

**Files:**
- Modify: `src/lib/components/Timeline.svelte` — markup for `.play-range` / `.play-io` (lines ~1118–1140 after Task 6), the `.timeline-body` opening, `.label-row`; CSS rules for `.timeline-body`, `.labels`, `.label-row*`, `.solo-badge`, `.lane*`, `.clip-handle*`, `.ruler`, `.tick*`, `.marker*`, `.play-range`, `.play-io*`, `.clip*`, `.edge*`, `.playhead*`, `.duration-handle*`.

**Interfaces:**
- Consumes: `--color-*` tokens; `RULER_H` (28) already in the component.

- [ ] **Step 1: Play range markup**

Replace the play range block:

```svelte
            {#if rangeActive && bounds.end > bounds.start}
              <div
                class="play-range"
                style:left="{bounds.start * pxPerSecond}px"
                style:width="{(bounds.end - bounds.start) * pxPerSecond}px"
                title="Play range {formatTimestamp(bounds.start)} – {formatTimestamp(bounds.end)} (preview only)"
                aria-hidden="true"
              ></div>
              {#if app.playIn != null}
                <div
                  class="play-io in"
                  style:left="{bounds.start * pxPerSecond}px"
                  aria-hidden="true"
                >
                  I
                </div>
              {/if}
              {#if app.playOut != null}
                <div
                  class="play-io out"
                  style:left="{bounds.end * pxPerSecond}px"
                  aria-hidden="true"
                >
                  O
                </div>
              {/if}
            {/if}
```

with:

```svelte
            {#if rangeActive && bounds.end > bounds.start}
              <div
                class="play-range"
                style:left="{bounds.start * pxPerSecond}px"
                style:width="{(bounds.end - bounds.start) * pxPerSecond}px"
                title="Play range {formatTimestamp(bounds.start)} – {formatTimestamp(bounds.end)} (preview only)"
                aria-hidden="true"
              ></div>
              <!-- Asymmetric half-wedges, so they differ from the playhead head in SHAPE: red on
                   amber is the worst pair for the common colour blindnesses. -->
              {#if app.playIn != null}
                <div class="play-io in" style:left="{bounds.start * pxPerSecond}px" aria-hidden="true"></div>
              {/if}
              {#if app.playOut != null}
                <div class="play-io out" style:left="{bounds.end * pxPerSecond - 8}px" aria-hidden="true"></div>
              {/if}
            {/if}
```

- [ ] **Step 2: Playhead head and ruler-height variable**

On the `.markers` overlay div, add the ruler height as a custom property so the CSS stops repeating the literal 28:

```svelte
        <div
          class="markers"
          style:height="{RULER_H + displayTracks.length * TRACK_H}px"
          style:--ruler-h="{RULER_H}px"
          aria-hidden="false"
        >
```

The playhead markup itself is unchanged.

- [ ] **Step 3: Body CSS**

Replace the following rules, in place, with the versions below. Rules not mentioned here (`.scroll`, `.content`, `.timeline-stack`, `.markers*`, `.lanes`, `.clip.has-filmstrip*`, `.clip:hover*`, `.clip.dragging`, `.clip.copying`, `.clip-mute`, `.clip.muted-clip`, `.clip-label`, `.marker.editing`, `.playhead-hit`) stay as they are.

```css
  .timeline-body {
    flex: 1 1 auto;
    display: flex;
    align-items: flex-start;
    min-height: 0;
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--color-ground);
  }

  .labels {
    flex: 0 0 auto;
    width: 52px;
    border-right: 1px solid var(--color-line);
    background: var(--color-panel);
    z-index: 2;
    position: sticky;
    left: 0;
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-muted);
    border-bottom: 1px solid var(--color-line);
    border-left: 2px solid transparent;
    cursor: pointer;
    user-select: none;
  }

  .label-row:hover {
    color: var(--color-text);
  }

  /* Selection is the 2px left bar, reserved at all times so nothing moves. */
  .label-row.selected {
    border-left-color: var(--color-accent);
    color: var(--color-text);
  }

  .label-row.solo {
    color: var(--color-text);
  }

  .label-row .track-name {
    pointer-events: none;
  }

  /* Solo is session-only: warn, as a fixed 20px square like the audio editor's S flag. */
  .solo-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    color: var(--color-ground);
    background: var(--color-warn);
    pointer-events: none;
  }

  /* Gap hatch on tracks that hold clips. Stripes are text at 3%, so they track the palette. */
  .lane.has-gaps {
    background-image: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 6px,
      color-mix(in srgb, var(--color-text) 3%, transparent) 6px,
      color-mix(in srgb, var(--color-text) 3%, transparent) 12px
    );
  }

  .clip-handle {
    position: absolute;
    top: 6px;
    bottom: 6px;
    box-sizing: border-box;
    border-radius: 3px;
    pointer-events: none;
    z-index: 0;
    background: hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.12);
    border: 1px dashed hsla(var(--clip-h), calc(var(--clip-s) * 1%), calc(var(--clip-l) * 1%), 0.4);
    opacity: 0.9;
  }

  .ruler {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--color-panel);
    border-bottom: 1px solid var(--color-line);
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }

  /* Ticks grow up from the bottom; labels sit at the top, 3px right of their tick. */
  .tick {
    position: absolute;
    bottom: 0;
    width: 1px;
    height: 12px;
    background: var(--color-line);
    pointer-events: none;
  }

  .tick-label {
    position: absolute;
    bottom: 11px;
    left: 3px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--color-muted);
    white-space: nowrap;
  }

  .marker {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: max-content;
    min-width: 24px;
    max-width: 96px;
    margin-left: -8px;
    padding: 1px 4px 0 3px;
    border: none;
    background: transparent;
    cursor: pointer;
    z-index: 5;
    box-sizing: border-box;
  }

  .marker::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 7px;
    width: 2px;
    background: var(--color-warn);
    opacity: 0.85;
    pointer-events: none;
  }

  .marker:hover::before {
    opacity: 1;
  }

  .marker-flag {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    width: 0;
    height: 0;
    border-left: 10px solid var(--color-warn);
    border-right: 0 solid transparent;
    border-bottom: 9px solid transparent;
    pointer-events: none;
  }

  .marker-label {
    position: relative;
    z-index: 1;
    max-width: 80px;
    margin-top: 1px;
    margin-left: 1px;
    padding: 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 600;
    line-height: 14px;
    color: var(--color-ground);
    background: var(--color-warn);
    border-radius: 2px;
    pointer-events: none;
  }

  .marker-rename {
    position: relative;
    z-index: 1;
    width: 96px;
    min-width: 64px;
    max-width: 160px;
    margin: 1px 0 0 1px;
    padding: 0 4px;
    height: 16px;
    font-size: 10px;
    line-height: 16px;
    color: var(--color-text);
    background: var(--color-raised);
    border: none;
    border-radius: 4px;
  }

  /* warn: the play range is preview-only. Wash in the ruler, 1px lines, 8px half-wedges. */
  .play-range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--color-warn) 15%, transparent);
    border-left: 1px solid var(--color-warn);
    border-right: 1px solid var(--color-warn);
    pointer-events: none;
    z-index: 1;
  }

  .play-io {
    position: absolute;
    top: 0;
    width: 8px;
    height: 8px;
    background: var(--color-warn);
    pointer-events: none;
    z-index: 2;
  }

  .play-io.in {
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }

  .play-io.out {
    clip-path: polygon(100% 0, 0 0, 100% 100%);
  }

  .lane {
    position: relative;
    border-bottom: 1px solid var(--color-line);
    background-color: var(--color-ground);
  }
```

Delete these rules entirely: `.label-row.solo` background version (replaced above), `.lane.selected`, `.lane.has-gaps.selected`, `.marker-rename:focus`.

Then replace the clip selection, primary, edge, playhead and duration-handle rules:

```css
  /* Selection is the accent OUTLINE; the fill stays calm so hue keeps meaning "which file". */
  .clip.active {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }

  /* The clip the inspector edits, among a multi-selection. */
  .clip.primary {
    box-shadow: 0 0 0 2px var(--color-accent);
  }

  .edge {
    flex: 0 0 auto;
    align-self: stretch;
    cursor: ew-resize;
    position: relative;
    z-index: 2;
    background: transparent;
    touch-action: none;
  }

  .edge:hover,
  .edge:active {
    background: color-mix(in srgb, var(--color-text) 18%, transparent);
  }

  .playhead {
    position: absolute;
    top: 0;
    width: 1px;
    background: var(--color-danger);
    cursor: ew-resize;
    touch-action: none;
    outline: none;
  }

  .playhead.scrubbing {
    cursor: grabbing;
  }

  .playhead:focus-visible .playhead-hit {
    background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  }

  .playhead-hit {
    position: absolute;
    top: var(--ruler-h);
    left: -6px;
    width: 12px;
    height: calc(100% - var(--ruler-h));
    background: transparent;
  }

  /* 12 wide × 6 tall: half-width equals height, so the point is a right angle. */
  .playhead-head {
    position: absolute;
    top: 0;
    left: -6px;
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid var(--color-danger);
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
    pointer-events: none;
  }

  .duration-handle {
    position: absolute;
    top: 0;
    margin-left: -5px;
    cursor: ew-resize;
    touch-action: none;
    outline: none;
  }

  .duration-handle.active .duration-handle-bar,
  .duration-handle:hover .duration-handle-bar {
    background: var(--color-accent-hover);
  }

  .duration-handle.preview-trim .duration-handle-bar,
  .duration-handle.preview-trim .duration-handle-grip {
    background: var(--color-warn);
  }

  .duration-handle-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 2px;
    background: var(--color-accent);
  }

  .duration-handle-grip {
    position: absolute;
    top: 3px;
    left: 0;
    width: 10px;
    height: 16px;
    border-radius: 2px;
    background: var(--color-accent);
    border: 1px solid var(--color-line);
  }

  .duration-handle:focus-visible .duration-handle-grip {
    box-shadow:
      0 0 0 2px var(--color-ground),
      0 0 0 4px var(--color-accent);
  }
```

In the remaining rules, replace every `var(--bg)`, `var(--surface)`, `var(--surface-2)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--accent-hover)`, `var(--danger)`, `var(--warn)` with its `--color-*` equivalent, and convert the `rem` sizes in `.clip-mute` (`margin-left: 0.2rem` → `3px`) and `.clip-label` (`padding: 0 0.35rem` → `0 5px`; `font-size: 0.75rem` → `11px`).

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: clean (delete any selector svelte-check reports unused); 166 pass.

Run `npm run tauri dev`, open a project with clips, markers and a play range:
- Lanes are the same tone as the space below the last track; the label column is panel with the selected track showing a 2px blue left bar and no lane tint.
- Ruler ticks rise from the bottom; labels at the top in tabular digits.
- Playhead is a hairline with a small right-angle red triangle.
- Play range is an amber wash in the ruler with hairline edges and two small amber wedges pointing inward; no I/O letters.
- Markers are amber flags with labels; double-click one: the rename box is a dark raised field.
- Selected clip has a crisp 1px blue outline; its fill did not brighten. Multi-select: the primary clip has a 2px blue ring.
- Split, trim, drag, ⌥-drag copy, marker seek/rename/remove all still work.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Timeline.svelte
git commit -m "style: timeline body on family tokens with warn play range and accent selection"
```

---

### Task 8: Remove the bridge, format, update the family document

Spec §1 (no two mechanisms), §12.

**Files:**
- Modify: `src/app.css` (delete the LEGACY BRIDGE block)
- Modify: `src/routes/+page.svelte` (drop the `legacy` class)
- Modify: `/Users/meigo/Projects/slop/SLOP-TIMELINE-UI.md` (§7 markers note, §8 adoption note)
- Format: every `.svelte`, `.ts`, `.js`, `.css`, `.json` under `src/` and the root configs

- [ ] **Step 1: Delete the bridge**

In `src/app.css` remove everything from the `LEGACY BRIDGE` comment to the end of the file. In `+page.svelte` change the root `class="legacy flex h-screen …"` to `class="flex h-screen …"`.

- [ ] **Step 2: Prove nothing references the old names**

Run:

```bash
grep -rn "var(--bg)\|var(--surface\|var(--border)\|var(--text)\|var(--muted)\|var(--accent\|var(--danger)\|var(--warn)\|var(--ok)\|var(--disabled)" src
grep -rn "class=\"ghost\|class=\"[^\"]*\bghost\b\|legacy\|\.mono\b\|font-mono" src
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" src/lib/components src/routes | grep -v "^\s*//\|\* "
```

Expected: the first two return nothing. The third returns only `Preview.svelte` lines with `#000` (three `ctx.fillStyle` and two CSS `background: #000`), the `drop-shadow(0 0 1px rgba(0, 0, 0, 0.8))` on the playhead head, and the `.clip-label` text-shadow. Anything else is a miss — fix it.

- [ ] **Step 3: Format**

Run: `npm run format`
Expected: files rewritten with sorted class strings. Then `npm run format:check` passes.

- [ ] **Step 4: Full verification**

Run: `npm run check && npm test`
Expected: `0 ERRORS 0 WARNINGS`; `19 passed`, `166 passed`.

Run `npm run tauri dev` with a project open and take a full-window screenshot:

```bash
screencapture -x -T 3 "/private/tmp/claude-501/-Users-meigo-Projects-slop-slop-video-compositor/d5f910f0-c706-401d-a6f7-19075fd91b7d/scratchpad/compositor-after.png"
```

Compare against `/Users/meigo/Projects/slop/slop-audio-editor/docs/screenshot.webp`: same panel tones, same 44/28/24 heights, same divider and toggle idiom, same playhead and in/out furniture. Walk the spec §3–§9 once and tick each item.

- [ ] **Step 5: Update the family document**

In `/Users/meigo/Projects/slop/SLOP-TIMELINE-UI.md`:

In §7, after the "In/out markers" bullet, add:

```markdown
- **Named markers** (compositor only): amber flag with a text label and a 2px stem. Amber is bent
  here on purpose — markers are saved state, but the flags predate this document and the label
  makes them unmistakable next to the 8px in/out wedges. Distinguish by SHAPE, never by adding a
  third colour.
```

In §8, replace the sentence beginning "`slop-video-compositor` predates this" with:

```markdown
`slop-video-compositor` adopted `@theme` on 2026-09-08. Its chrome is utilities; the timeline body
and preview keep scoped `<style>` blocks whose colours are `var(--color-*)` tokens, because their
rules are geometry (clip handles, hatching, playhead hit zones) that utilities express badly.
That split is the one tolerated form of "two mechanisms": utilities for chrome, scoped CSS for
canvas-like furniture, never both for the same element.
```

- [ ] **Step 6: Commit**

```bash
git add -A src .prettierrc.json .prettierignore package.json package-lock.json
git commit -m "style: drop the legacy bridge and format with prettier"
cd /Users/meigo/Projects/slop && git -C /Users/meigo/Projects/slop status --short SLOP-TIMELINE-UI.md
```

The family document lives outside this repo; if `/Users/meigo/Projects/slop` is its own git repository commit there with `docs: compositor adopted the shared tokens`, otherwise leave the edit in place and say so in the final report.

- [ ] **Step 7: Report**

Final message lists: what changed per component, the three verification results (check, test, screenshot), the README screenshot at `docs/screenshot.webp` being stale and needing a retake, and the branch name for merging.
