/**
 * Shared class strings for the slop family look — see
 * docs/superpowers/specs/2026-09-08-style-alignment-design.md §1.
 *
 * Plain strings rather than `@apply`: in Tailwind 4 an `@apply` inside a component <style>
 * needs an `@reference` in every file. Every control in a bar is 24px tall (`h-6`); padding
 * alone gave icon buttons and text toggles different heights.
 *
 * eslint.config.js scopes the `better-tailwindcss` plugin to `**\/*.svelte` and `**\/*.html`, so
 * this file gets no automated conflict/duplicate-class checking even though it holds most of the
 * app's class strings. Its strings are hand-audited instead — check any new constant by eye for
 * two utilities setting the same property.
 */

/** Every bar control: 24px tall, centred, 4px radius. */
export const CONTROL_H = "flex h-6 shrink-0 items-center justify-center rounded";

/** Icon-only button, 24×24, transparent until hover. */
export const BTN = `${CONTROL_H} w-6 text-text hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent`;

/** Labelled button (icon + text), same height as BTN. */
export const TEXT_BTN = `${CONTROL_H} gap-1 px-2 text-xs whitespace-nowrap text-text hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent`;

/** 1px rule between toolbar groups. Whitespace alone reads as accidental at this size. */
export const DIVIDER = "mx-1 h-5 w-px shrink-0 bg-line";

/** Menu row without a text colour, so a caller can state its own in one branch. */
const MENU_ITEM_BASE =
  "flex w-full items-center gap-2 px-3 py-1 text-left text-xs whitespace-nowrap hover:bg-raised";
export const MENU_ITEM = `${MENU_ITEM_BASE} text-text`;

/** A `menuitemradio` row: the checked one reads in accent. Built as one string — appending
 *  `text-accent` to MENU_ITEM would put two colour utilities in one class attribute, and the
 *  winner would be Tailwind's emit order rather than the markup. */
export const menuRadioClass = (checked: boolean): string =>
  `${MENU_ITEM_BASE} ` + (checked ? "text-accent" : "text-text");

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
export const toggleSquareClass = (on: boolean, onClass = "bg-accent text-ground"): string =>
  `${CONTROL_H} w-6 text-xs font-bold ` +
  (on ? onClass : "text-muted hover:bg-raised hover:text-text");

/** Icon button whose glyph is recoloured to show state (the dirty Save). One string: adding
 *  `text-accent` after BTN's `text-text` would leave the winner to Tailwind's emit order. */
export const markedBtnClass = (marked: boolean): string =>
  marked ? `${CONTROL_H} w-6 text-accent hover:bg-raised` : BTN;

/** Inspector / bar input. `raised`, never `panel`: a panel-coloured field is invisible on a
 *  panel. Width is the CALLER's — `FIELD` must not set one, or a caller appending `w-16`
 *  puts two width utilities in one string. */
export const FIELD = "h-6 min-w-0 rounded bg-raised px-1 text-right text-xs text-text tabular-nums";

/** Bordered action button for panels (Relink, Reveal, Reset, Recheck). */
export const BORDERED_BTN =
  "inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs whitespace-nowrap text-muted hover:bg-raised hover:text-text disabled:opacity-30";

/** 28px thin strip: header rows, tool strips, status line. Caller adds `border-b` / `border-t`.
 *  Four strips deliberately diverge from this literal instead of importing it (Transport,
 *  StatusLine, and Timeline's two header bars) — see the comment at each call site for why.
 *  Changing this constant will not reach them. */
export const STRIP =
  "flex h-7 shrink-0 items-center gap-1 border-line bg-panel px-2 text-[11px] text-muted";

/** Section heading inside a panel. */
export const HEADING = "text-[11px] tracking-wide text-muted uppercase";
