import { clipDuration, projectDuration } from "./project";
import type { Project } from "./types";

/** Default snap threshold in seconds (UI may scale with zoom). */
export const DEFAULT_SNAP_THRESHOLD = 0.12;

/**
 * Collect snap targets: sequence 0/end, all clip edges (except excludeClipId),
 * optional playhead.
 */
export function collectSnapTimes(
  project: Project,
  opts?: { excludeClipId?: string | null; playhead?: number | null },
): number[] {
  const times = new Set<number>([0, projectDuration(project)]);
  if (opts?.playhead != null && Number.isFinite(opts.playhead)) {
    times.add(Math.max(0, opts.playhead));
  }
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (opts?.excludeClipId && clip.id === opts.excludeClipId) continue;
      times.add(clip.timelineStart);
      times.add(clip.timelineStart + clipDuration(clip));
    }
  }
  for (const m of project.markers ?? []) {
    if (Number.isFinite(m.t) && m.t >= 0) times.add(m.t);
  }
  return [...times].sort((a, b) => a - b);
}

/** Nearest target within threshold, or null if none. */
export function nearestSnap(
  t: number,
  targets: number[],
  threshold = DEFAULT_SNAP_THRESHOLD,
): { t: number; dist: number } | null {
  if (!Number.isFinite(t) || targets.length === 0) return null;
  let bestT: number | null = null;
  let bestDist = threshold;
  for (const x of targets) {
    const d = Math.abs(x - t);
    if (d <= bestDist + 1e-12) {
      bestDist = d;
      bestT = x;
    }
  }
  return bestT == null ? null : { t: bestT, dist: bestDist };
}

/** Snap a time to the nearest target within threshold; otherwise return `t`. */
export function snapTime(
  t: number,
  targets: number[],
  threshold = DEFAULT_SNAP_THRESHOLD,
): number {
  return nearestSnap(t, targets, threshold)?.t ?? t;
}

/**
 * Snap a clip's timeline start so either its left edge or right edge
 * lands on a target (whichever is closer within threshold).
 */
export function snapClipStart(
  start: number,
  duration: number,
  targets: number[],
  threshold = DEFAULT_SNAP_THRESHOLD,
): number {
  if (!(duration > 0)) return snapTime(start, targets, threshold);
  const left = nearestSnap(start, targets, threshold);
  const right = nearestSnap(start + duration, targets, threshold);
  if (left && right) {
    if (left.dist <= right.dist) return Math.max(0, left.t);
    return Math.max(0, right.t - duration);
  }
  if (left) return Math.max(0, left.t);
  if (right) return Math.max(0, right.t - duration);
  return Math.max(0, start);
}
