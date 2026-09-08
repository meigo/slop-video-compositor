/**
 * Inspector panel width, as pure arithmetic — no DOM, so the clamping and the drag maths are
 * testable without a browser. Mirrors the shape of `clampTimelineHeight` in appState, and of
 * slop-audio-editor's `panel-layout.ts`.
 */

/** Below this the label / field / unit rows stop lining up and the fields become unreadable. */
export const MIN_INSPECTOR_WIDTH = 240;

/** Narrower than the old `0.9fr` share, which gave a one-character number a ~400px field. */
export const DEFAULT_INSPECTOR_WIDTH = 320;

/**
 * Clamp to [MIN, half the viewport]. The minimum always wins: on a window too narrow for both
 * halves the panel stays usable rather than collapsing to nothing.
 */
export function clampInspectorWidth(px: number, viewportW: number): number {
  if (!Number.isFinite(px)) {
    if (px === Number.POSITIVE_INFINITY) return Math.max(MIN_INSPECTOR_WIDTH, half(viewportW));
    return DEFAULT_INSPECTOR_WIDTH;
  }
  const max = Math.max(MIN_INSPECTOR_WIDTH, half(viewportW));
  return Math.min(max, Math.max(MIN_INSPECTOR_WIDTH, Math.round(px)));
}

function half(viewportW: number): number {
  return Number.isFinite(viewportW) ? Math.round(viewportW * 0.5) : MIN_INSPECTOR_WIDTH;
}

/**
 * Width for a drag in progress, recomputed from where the press started rather than accumulated
 * per move, so a drag cannot drift away from the pointer. Subtraction because the panel is docked
 * right: dragging the grip LEFT makes it wider.
 */
export function resizedInspectorWidth(
  gripStartW: number,
  gripStartX: number,
  clientX: number,
  viewportW: number,
): number {
  return clampInspectorWidth(gripStartW + (gripStartX - clientX), viewportW);
}
