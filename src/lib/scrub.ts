/**
 * Drag-to-change arithmetic for numeric fields, as pure functions so the behaviour is testable
 * without a pointer. Mirrors slop-audio-editor's NumberField scrub.
 */

/** Travel before a press becomes a scrub, so a plain click still puts a caret in the field. */
export const SCRUB_THRESHOLD_PX = 3;

export type ScrubArgs = {
  /** The value when the pointer went down — a scrub is always measured from there. */
  startValue: number;
  /** Horizontal travel since the press. */
  dx: number;
  /** What one pixel of travel is worth. Seconds want 0.01, a scale factor 0.005, pixels 1. */
  step: number;
  /** Shift: a tenth of a step per pixel, the same modifier the timeline nudge uses. */
  fine?: boolean;
  min?: number;
  max?: number;
};

/**
 * The value for a drag in progress. Computed from the press rather than accumulated per move, so
 * returning the pointer to where it started returns the value with it.
 */
export function scrubbedValue({
  startValue,
  dx,
  step,
  fine = false,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
}: ScrubArgs): number {
  if (!Number.isFinite(dx)) return startValue;
  const next = startValue + dx * step * (fine ? 0.1 : 1);
  return Math.max(min, Math.min(max, next));
}
