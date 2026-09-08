<script lang="ts">
  import { FIELD } from "$lib/ui";
  import { SCRUB_THRESHOLD_PX, scrubbedValue } from "$lib/scrub";

  const {
    value,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    step = 0.01,
    decimals = 2,
    title = undefined,
    ariaLabel,
    disabled = false,
    onInput = undefined,
    onCommit,
  }: {
    value: number;
    min?: number;
    max?: number;
    /** What one pixel of horizontal drag is worth. Seconds want 0.01, a scale factor 0.005. */
    step?: number;
    /** Displayed precision. X and Y are whole pixels, so they pass 0. */
    decimals?: number;
    title?: string;
    ariaLabel: string;
    disabled?: boolean;
    /** Called on every step of a scrub, for a parent that wants the picture to follow the drag.
     *  The parent opens a gesture on the first call and closes it in `onCommit`, so the whole
     *  scrub stays one undo entry. */
    onInput?: (v: number) => void;
    onCommit: (v: number) => void;
  } = $props();

  const show = (v: number): string => v.toFixed(decimals);

  // A writable `$derived`: typing assigns to it, a scrub assigns to it, and it re-syncs on its own
  // whenever `value` changes from elsewhere — a timeline drag, or an undo.
  let draft = $derived(show(value));
  let input = $state<HTMLInputElement | null>(null);

  const clamp = (v: number): number => Math.max(min, Math.min(max, v));

  function commitDraft() {
    // Committing what is already displayed would be a real edit, not a no-op: the field shows a
    // rounded value, so for anything with finer precision than `decimals` — which every drag
    // produces — Number(draft) differs from `value` by a hair. That would push an undo entry just
    // for tabbing through the inspector.
    if (draft === show(value)) return;
    const v = Number(draft);
    if (Number.isFinite(v)) onCommit(clamp(v));
    else draft = show(value);
  }

  /**
   * Drag horizontally to change the value. A press that never travels is left alone, so it still
   * places a caret for typing: it is the movement that takes over, not a timer.
   */
  let scrub: { startX: number; startValue: number; moved: boolean } | null = null;

  function scrubDown(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    scrub = { startX: e.clientX, startValue: value, moved: false };
    window.addEventListener("pointermove", scrubMove);
    window.addEventListener("pointerup", scrubUp);
    window.addEventListener("pointercancel", scrubUp);
  }

  function scrubMove(e: PointerEvent) {
    if (!scrub) return;
    const dx = e.clientX - scrub.startX;
    if (!scrub.moved) {
      if (Math.abs(dx) < SCRUB_THRESHOLD_PX) return;
      scrub.moved = true;
      input?.blur(); // a scrub is not a text edit; a caret left blinking in it is a lie
    }
    const next = scrubbedValue({
      startValue: scrub.startValue,
      dx,
      step,
      fine: e.shiftKey,
      min,
      max,
    });
    draft = show(next);
    onInput?.(next);
  }

  function scrubUp() {
    window.removeEventListener("pointermove", scrubMove);
    window.removeEventListener("pointerup", scrubUp);
    window.removeEventListener("pointercancel", scrubUp);
    if (scrub?.moved) {
      // A live field cannot go through commitDraft: every step already wrote the document, so the
      // draft matches `value` by now and that no-op guard would swallow the release, leaving the
      // parent's gesture open forever. Close it explicitly instead.
      if (onInput) {
        const v = Number(draft);
        if (Number.isFinite(v)) onCommit(clamp(v));
      } else {
        commitDraft();
      }
    }
    scrub = null;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
    if (e.key === "Escape") {
      draft = show(value);
      (e.currentTarget as HTMLInputElement).blur();
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      // Shift is the COARSE direction here: the base step is already small.
      draft = show(clamp(value + dir * step * (e.shiftKey ? 10 : 1)));
      commitDraft();
    }
    e.stopPropagation(); // keep the global shortcuts out of a text field
  }
</script>

<!-- `type="text"` with a decimal inputmode, not `type="number"`: a number input owns pointer
     gestures for its spinner, which is exactly the gesture the scrub needs. -->
<input
  bind:this={input}
  class="{FIELD} w-full {disabled ? 'text-disabled' : 'cursor-ew-resize'}"
  type="text"
  inputmode="decimal"
  {disabled}
  {title}
  aria-label={ariaLabel}
  bind:value={draft}
  onpointerdown={scrubDown}
  onblur={commitDraft}
  onkeydown={onKeyDown}
/>
