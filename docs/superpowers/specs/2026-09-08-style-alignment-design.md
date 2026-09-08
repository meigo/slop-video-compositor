# Style alignment with the slop family — design

Date: 2026-09-08

`slop-video-compositor` adopts the shared visual language in
`/Users/meigo/Projects/slop/SLOP-TIMELINE-UI.md`, with `slop-audio-editor` as the worked reference.
This document records the decisions that are specific to the compositor. Where it is silent, the
family document governs; where the two disagree, this one wins and the reason is stated.

**Appearance only.** No control changes what it does. Every keyboard shortcut, drag gesture,
menu item, preference and file format stays exactly as it is. The pure-logic test suite must pass
unchanged, and a test that breaks is a behaviour regression, not a styling detail.

---

## 1. Mechanism

Tailwind 4 with the family `@theme` tokens, adopted incrementally:

- `tailwindcss` and `@tailwindcss/vite` (v4) as devDependencies; the plugin goes after `sveltekit()`
  in `vite.config.js`.
- `prettier`, `prettier-plugin-svelte`, `prettier-plugin-tailwindcss` with the audio editor's
  `.prettierrc.json` (printWidth 100, `tailwindStylesheet: ./src/app.css`) so class strings sort
  the same way in both apps. `npm run format` / `format:check` scripts.
- ESLint 10 flat config copied from the audio editor (`@eslint/js`, `typescript-eslint`,
  `eslint-plugin-svelte`, `globals`, `eslint-config-prettier`, `eslint-plugin-better-tailwindcss`)
  with `npm run lint`. The reason is one rule: `better-tailwindcss/no-conflicting-classes` as an
  error. Two utilities fighting over one property in a class string is decided by Tailwind's emit
  order, not the markup, and three such conflicts were found in this very plan by hand. Lint
  warnings that pre-exist in the TypeScript are reported, not fixed, in this work.
- `src/app.css` becomes the audio editor's stylesheet: `@import "tailwindcss"`, the `@theme` block
  with **identical hex values**, `:root { color-scheme: dark; accent-color }`, the global
  `:focus-visible` ring, `html/body` height reset, `overscroll-behavior: none`, and the
  `input[type=range].slider` rules (used by the zoom slider). The Inter font override, the 14px root
  size and every global `button` / `input` rule are removed; Tailwind preflight resets controls and
  each one gets explicit classes.
- Chrome components (`+page`, `Toolbar`, `Transport`, `StatusLine`, `Inspector`, `MissingDeps`) are
  rewritten to utility classes with **no `<style>` block**.
- `Timeline.svelte`, `Preview.svelte`, `ClipFilmstrip.svelte` and `ClipWaveform.svelte` keep their
  scoped `<style>` blocks for geometry-heavy rules, but every colour in them becomes a
  `var(--color-*)` token or a `color-mix()` of tokens, and every rem becomes px. Their *bars* (the
  timeline header row and tool strip) are utilities like the rest of the chrome.
  This is the transitional state the family document tolerates ("can move to `@theme` whenever
  someone is in there anyway"); the split is: utilities for chrome, scoped CSS for canvas-like
  furniture. Do not add a third mechanism.

Shared class strings live in **`src/lib/ui.ts`** and are imported wherever a bar has controls (the
audio editor keeps them private to its toolbar; the compositor has controls in four bars):

```ts
export const CONTROL_H = "flex h-6 items-center justify-center rounded";
export const BTN = `${CONTROL_H} w-6 text-text hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent`;
export const TEXT_BTN = `${CONTROL_H} gap-1 px-2 text-xs text-text hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent`;
export const DIVIDER = "mx-1 h-5 w-px shrink-0 bg-line";
export const MENU_ITEM = "flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-text hover:bg-raised";
export const MENU_PANEL = "absolute top-full z-30 mt-1 min-w-44 rounded border border-line bg-panel py-1 shadow-lg";
export const toggleClass = (on: boolean, onClass = "bg-accent text-ground") =>
  `${CONTROL_H} px-2 text-xs ` + (on ? `${onClass} font-medium` : "text-muted hover:bg-raised hover:text-text");
export const toggleIconClass = (on: boolean, onClass = "bg-accent text-ground") =>
  `${CONTROL_H} w-6 ` + (on ? onClass : "text-text hover:bg-raised");
export const FIELD = "h-6 w-full min-w-0 rounded bg-raised px-1 text-right text-xs text-text tabular-nums";
export const BORDERED_BTN = "rounded border border-line px-2 py-1 text-xs text-muted hover:bg-raised hover:text-text disabled:opacity-30";
export const STRIP = "flex h-7 shrink-0 items-center gap-1 border-line bg-panel px-2 text-[11px]";
export const HEADING = "text-[11px] tracking-wide text-muted uppercase";
```

On-state classes are always literals passed in, never interpolated from a variable name.

## 2. Tokens and semantics

Values are the family's, unchanged. Role mapping from the old `:root` names:

| old | new |
| --- | --- |
| `--bg` | `ground` |
| `--surface` | `panel` |
| `--surface-2` | `raised` |
| `--border` | `line` |
| `--text`, `--muted`, `--accent`, `--accent-hover`, `--danger`, `--warn`, `--ok`, `--disabled` | same role, family value |

Semantic assignment in the compositor:

- **accent** — saved document state and selection: selected clip outline, selected track bar,
  Thumbs / S / M / L toggles, Loop, canvas presets, program-out handle, Mute clip, Export button,
  dirty Save glyph, active menu radio.
- **warn** — session-only state that never reaches the export: In / Out toggles, play-range lines,
  wedges and wash, transport mute, solo, program-out preview-trim, and (by decision, see §7) the
  named markers.
- **danger** — playhead, missing-media text, ffmpeg banner, errors in the status line.
- **ok** — the ffmpeg-present tick in the banner only.
- Per-file clip hues (`clipColor.ts`) stay; the family document lists this as the compositor's
  blessed exception.

## 3. Shell (`+page.svelte`)

Root: `flex h-screen flex-col overflow-hidden bg-ground text-text`. No padding, no gaps, no rounded
cards. Order top to bottom:

1. `MissingDeps` banner (in flow, only when ffmpeg is missing)
2. `Toolbar` — `h-11 border-b border-line bg-panel`
3. Main row — CSS grid `minmax(0,1.65fr) minmax(240px,.9fr)`, no gap; left column is
   `Preview` then `Transport`; right column is `Inspector` with `border-l border-line bg-panel`.
   The `@media (max-width: 800px)` single-column fallback stays.
4. Splitter — `h-2 shrink-0 bg-panel border-y border-line` button, grip `h-0.5 w-9 rounded bg-line`,
   hover/active grip `bg-accent`, `cursor: row-resize`. Same drag behaviour and height clamp.
5. Timeline panel — inline height from state, unchanged.
6. `StatusLine` — `h-7 border-t border-line bg-panel px-3 text-[11px]`.

`.shell.resizing` (cursor + `select-none`) stays as a conditional class.

## 4. Toolbar

`STRIP`-style bar at `h-11` with `gap-3` between groups, `gap-1` inside, `DIVIDER` between groups.
Icons 16px. Order:

```
File ▾   Save  |  Import  ▾  |  Undo  Redo          [ml-auto]  1920×1080 ▾  |  Export
```

- **File ▾** — `ToolbarMenu`-style trigger (`h-6 rounded px-2 text-xs`, open state
  `bg-raised text-text`, `▾` in `text-[9px] opacity-70`). Items: New, Open… ⌘O, separator, Save ⌘S,
  Save As…. No dirty dot on the trigger — Save is visible beside it.
- **Save** — `BTN` with the `Save` icon; `text-accent` when `dirty` (recolour, never a new
  element). Title still says "unsaved changes".
- **Import** — `TEXT_BTN` with the `Film` icon; the placement menu is a separate `BTN` chevron
  trigger opening a `MENU_PANEL` with "Place clips" (`HEADING`), three `menuitemradio` items where
  the active one is `text-accent`, separator, Import now….
- **Undo / Redo** — `BTN`, disabled via `opacity-30`.
- **Canvas** — right-aligned trigger showing `{w}×{h}` in `tabular-nums` (no mono). Panel: "Canvas"
  heading, W and H `FIELD` inputs (`w-16`, `type=number`, spinners hidden), presets as
  `toggleClass` buttons filled accent when they match.
- **Export** — `${CONTROL_H} gap-1 bg-accent px-2 text-xs text-ground hover:bg-accent-hover
  disabled:opacity-50`. The one filled button in the bar. Exporting state keeps the spinning icon.

Menus keep the click-outside-on-wrapper and Escape behaviour they have today. The `.spin`
keyframe moves into `app.css` as a plain global rule (it was already effectively global).

## 5. Transport and preview

**Transport** — `STRIP` with `border-t`: Home, Prev, Play/Pause, Stop, Next, End as `BTN`; Loop as
`toggleIconClass(loop)` (accent); Mute as `toggleIconClass(muted, "bg-warn text-ground")` with the
`VolumeX` icon when on. Readout: `ml-2 w-28 text-sm tabular-nums` — current time in `text-text`,
` / total` in `text-muted`.

**Preview** (scoped CSS stays):

- frame: `flex-1 min-h-[200px] bg-ground`, no border, no radius.
- viewport checkerboard: `var(--color-ground)` base with `var(--color-panel)` squares, 16px tile.
- output frame: `outline: 1px solid var(--color-raised)`, `background: #000` (the letterbox is
  content, not chrome), no glow shadow.
- size badge and zoom HUD: `rounded bg-ground/70 px-1 text-[10px] text-muted tabular-nums`; the
  Fit button inside the HUD is `h-5 rounded px-1 text-[10px] text-text hover:bg-raised`.
- canvas 2D `#000` fills are untouched.

## 6. Inspector

`flex flex-col overflow-y-auto` on the panel background.

- Title strip: `STRIP` with `border-b`, text "Inspector" in `text-muted`. Height matches the
  ruler and status line (28).
- Body `p-2`, sections separated by `border-t border-line pt-2`, each headed by an `h3.HEADING`
  ("Source", "Transform").
- Source row: 10px swatch (`rounded-sm border border-line`), film/audio icon, filename in
  `text-xs text-text truncate` (no mono), meta line in `text-[11px] text-muted`. Missing media
  message in `text-danger`. Relink… and Reveal as `BORDERED_BTN`.
- Fields: one per row in a grid `auto minmax(0,1fr) auto` (set inline, Tailwind cannot take the
  comma), label `text-[11px] text-muted text-right`, input `FIELD` (native `type=number`, same
  step/min/max, spinners hidden globally), unit `text-[11px] text-muted`. Rows: Source in (s),
  Source out (s), Timeline start (s), Duration (read-only: same box, `text-muted`, timestamp then
  seconds), Scale, X (px), Y (px).
- Mute clip: `toggleClass(muted)` labelled "Mute" with the volume icon, `aria-pressed`. Same
  handler as the checkbox today.
- Reset transform: `BORDERED_BTN`, left-aligned.
- Empty state: `text-xs text-muted`.

## 7. Timeline

Scoped CSS stays for the body; the two bars are utilities.

**Header row** — `STRIP` with `border-b`: "Timeline" in `HEADING`, counts in `text-muted`,
Length label + `FIELD w-16` + "s" + formatted timestamp in `tabular-nums text-text`; right side:
Zoom label, `<input type=range class="slider w-28">` with `--fill-to`, `px/s` readout in
`w-14 tabular-nums text-muted`, Fit as `TEXT_BTN`, `DIVIDER`, "+ Track" as `TEXT_BTN`. Add-track
stays here rather than in the label column because the column is 52px and the family document
wants the control labelled.

**Tool strip** — `STRIP` with `border-b`, groups separated by `DIVIDER`:
Prev, Next (`TEXT_BTN`) | Split, Delete (`TEXT_BTN`, disabled when nothing selected) | Thumbs
(`toggleClass`, accent), S / M / L (`toggleClass` squares `w-6 px-0`, accent) | In, Out
(`toggleClass(set, "bg-warn text-ground")`), Clear (`TEXT_BTN`), range readout
`text-muted tabular-nums` | Marker (`TEXT_BTN`), hint `text-muted`. The hints keep their
`max-width: 900px` media hide.

**Body** (`.timeline-body`): no border, no radius, `overflow-x hidden / overflow-y auto`.

- Label column: 52px, `bg-panel`, `border-r line`. Rows: `text-[11px] text-muted` centred,
  `border-b line`, `border-l-2 border-transparent`; selected → `border-l-accent text-text`; hover
  `text-text`. Solo badge: `h-5 w-5 rounded bg-warn text-ground text-[10px] font-bold` "S".
- Ruler: `RULER_H = 28` stays, `bg-panel border-b line`, ticks `w-px bg-line` anchored bottom
  (minor 6px, major 12px), labels `top-0.5 left+3 text-[10px] text-muted tabular-nums`.
- Play range: wash `bg-warn/15` over the ruler height only; 1px `bg-warn` lines full ruler height;
  in wedge `size-2 bg-warn clip-path: polygon(0 0,100% 0,0 100%)` at `in`, out wedge
  `polygon(100% 0,0 0,100% 100%)` at `out − 8`. The "I"/"O" letter tags are removed.
- Named markers: keep the amber flag + label + 2px stem. Rename input becomes
  `rounded bg-raised px-1 text-[10px] text-text` with the global focus ring. Distinct from in/out
  by shape (flag with text vs 8px wedge). Chosen over a neutral flag because the amber flags are
  established; the family rule "warn = session-only" is bent here on purpose.
- Lanes: `bg-ground`, `border-b line`. **No selected-lane tint** — the label bar carries selection.
  Gap hatch stays: stripes of `color-mix(in srgb, var(--color-text) 3%, transparent)` at the
  same 6/12px rhythm.
- Clips: per-file hue fill, 1px hue border, 3px hue left bar, 4px radius, 4px vertical inset —
  unchanged. Selection (`.active`): `outline: 1px solid var(--color-accent); outline-offset: -1px`
  and the fill stays at its resting alpha. Primary (`.primary`): add
  `box-shadow: 0 0 0 2px var(--color-accent)`. Dragging/copying/muted states unchanged. Clip label
  keeps its text shadow (it sits over filmstrips).
- Trim handles (unused-source rails): unchanged hue-based dashes.
- Playhead: `width: 1px` line in `danger`; head is the family triangle (`border-x: 6px transparent;
  border-top: 6px danger`, centred with `margin-left: -6px`), `drop-shadow(0 0 1px rgba(0,0,0,.8))`.
  Hit zone stays 12px wide. `RULER_H` literal 28 in CSS becomes `var(--ruler-h)` set once inline.
- Program-out handle: bar `bg-accent`, grip `bg-accent border border-line`; hover
  `accent-hover`; preview-trim → `warn`. Focus ring via the global rule.

## 8. Missing-deps banner

`flex items-center gap-2 border-b border-line bg-danger/25 px-3 py-1 text-xs`: warning icon in
`text-danger`, "ffmpeg not found" in `text-text`, install hint in `text-muted` with the command in
`rounded bg-ground px-1 tabular-nums`, ffmpeg tick in `text-ok` / cross in `text-danger`, Recheck
as `BORDERED_BTN` pushed right.

## 9. Status line

Bottom strip, `text-[11px] text-muted`, one brightness: project name in `text-text`, dirty "•" in
`text-accent` (it is document state), separators `·` in `opacity-45`, error state `text-danger`
(same regex as today), hint icon in `text-accent`. Same content, same `role=status`.

## 10. Typography

Tailwind's default sans stack. Sizes: `text-[10px]` readouts and ruler labels, `text-[11px]`
labels and strips, `text-xs` buttons, menus and body, `text-sm` for the transport time readout
only. No `font-mono` anywhere; digits use `tabular-nums` in fixed-width boxes.

## 11. Out of scope

- Any behaviour, shortcut, gesture, persistence or export change.
- Moving the transport into the toolbar; merging the timeline's two bars.
- Converting `Timeline.svelte` / `Preview.svelte` body CSS to utilities.
- A resizable or collapsible inspector.

## 12. Verification

- `npm run check` reports 0 errors and 0 warnings; `npm test` passes unchanged.
- `grep -rn "var(--bg)\|var(--surface\|var(--border)" src` returns nothing; `grep -rn "#[0-9a-f]\{3,6\}" src/lib/components src/routes` returns only the preview's `#000` letterbox fills and comments.
- `npm run dev` in a browser: toolbar, transport, inspector empty state, timeline strips and
  status line match §3–§9; `npm run tauri dev` with a project open: clips, playhead, play range,
  markers and filmstrips match §7. Screenshots of both, side by side with
  `slop-audio-editor/docs/screenshot.webp`.
- Family document updated: §8 note that the compositor adopted `@theme` on 2026-09-08 with the
  timeline body on scoped CSS, and §7 note on the compositor's amber markers.
