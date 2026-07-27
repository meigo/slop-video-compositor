import { clipDuration } from "./project";
import type { Clip, Project } from "./types";

/**
 * Hard-cut resolve at timeline time `t` (half-open coverage:
 * timelineStart <= t < timelineStart + duration).
 *
 * - Higher track index wins across tracks.
 * - Same-track edits use overwrite (no intentional overlap). Fallback if data
 *   still overlaps (legacy/hand-edited): last covering clip in `track.clips`.
 */
export function clipAtTime(
  project: Project,
  t: number,
): { trackId: string; clip: Clip } | null {
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i];
    let winner: Clip | null = null;
    for (const c of track.clips) {
      const end = c.timelineStart + clipDuration(c);
      if (c.timelineStart <= t && t < end) {
        winner = c;
      }
    }
    if (winner) {
      return { trackId: track.id, clip: winner };
    }
  }
  return null;
}
