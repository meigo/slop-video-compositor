/**
 * Preview-only play range helpers (session state; not written to the project).
 * Bounds are half-open [start, end) on the sequence timeline.
 */

export type PlayBounds = { start: number; end: number };

/** Snap a play range into a valid [start, end) inside [0, seqDur]. */
export function normalizePlayRange(
  inT: number,
  outT: number,
  seqDur: number,
  minLen = 1 / 30,
): PlayBounds {
  const dur = Number.isFinite(seqDur) && seqDur > 0 ? seqDur : 0;
  if (!(dur > 0)) return { start: 0, end: 0 };

  let a = Number.isFinite(inT) ? inT : 0;
  let b = Number.isFinite(outT) ? outT : dur;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  a = Math.max(0, Math.min(a, dur));
  b = Math.max(0, Math.min(b, dur));
  if (b - a < minLen) {
    // Prefer expanding out; if that hits the end, pull in back.
    b = Math.min(dur, a + minLen);
    if (b - a < minLen) {
      a = Math.max(0, b - minLen);
    }
  }
  return { start: a, end: b };
}

/**
 * Effective playback window for the session.
 * - No I/O set → full sequence [0, seqDur)
 * - Only I → [I, seqDur)
 * - Only O → [0, O)
 * - Both → normalizePlayRange(I, O)
 */
export function effectivePlayBounds(
  playIn: number | null | undefined,
  playOut: number | null | undefined,
  seqDur: number,
): PlayBounds {
  const dur = Number.isFinite(seqDur) && seqDur > 0 ? seqDur : 0;
  if (!(dur > 0)) return { start: 0, end: 0 };

  if (playIn == null && playOut == null) {
    return { start: 0, end: dur };
  }
  const a = playIn == null ? 0 : playIn;
  const b = playOut == null ? dur : playOut;
  return normalizePlayRange(a, b, dur);
}

export function hasExplicitPlayRange(
  playIn: number | null | undefined,
  playOut: number | null | undefined,
): boolean {
  return playIn != null || playOut != null;
}

/**
 * Move one edge of the play range under a drag.
 *
 * Unlike `normalizePlayRange`, this CLAMPS instead of swapping: dragging in past out would
 * otherwise flip which handle sits under the cursor mid-gesture. The edge you are not holding
 * keeps its value, `null` included, so dragging one handle never invents the other.
 */
export function draggedPlayRange(
  edge: "in" | "out",
  t: number,
  playIn: number | null,
  playOut: number | null,
  seqDur: number,
  minLen = 1 / 30,
): { playIn: number | null; playOut: number | null } {
  const dur = Number.isFinite(seqDur) && seqDur > 0 ? seqDur : 0;
  const at = Number.isFinite(t) ? t : 0;

  if (edge === "in") {
    const ceiling = (playOut ?? dur) - minLen;
    return { playIn: Math.max(0, Math.min(at, ceiling)), playOut };
  }
  const floor = (playIn ?? 0) + minLen;
  return { playIn, playOut: Math.min(dur, Math.max(at, floor)) };
}
