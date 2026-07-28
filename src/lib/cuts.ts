import { clipDuration, projectDuration } from "./project";
import type { Project } from "./types";

/** Sorted unique cut points on the timeline (clip edges + 0 + sequence end). */
export function cutPoints(project: Project): number[] {
  const T = projectDuration(project);
  const times = new Set<number>([0, T]);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      times.add(clip.timelineStart);
      times.add(clip.timelineStart + clipDuration(clip));
    }
  }
  for (const m of project.markers ?? []) {
    if (Number.isFinite(m.t) && m.t >= 0 && m.t <= T) times.add(m.t);
  }
  return [...times]
    .filter((t) => t >= 0 && t <= T)
    .sort((a, b) => a - b);
}

/** Previous cut strictly before `t`, or 0. */
export function prevCut(project: Project, t: number): number {
  const pts = cutPoints(project);
  let best = 0;
  for (const p of pts) {
    if (p < t - 1e-9) best = p;
    else break;
  }
  return best;
}

/** Next cut strictly after `t`, or sequence end. */
export function nextCut(project: Project, t: number): number {
  const pts = cutPoints(project);
  const T = projectDuration(project);
  for (const p of pts) {
    if (p > t + 1e-9) return p;
  }
  return T;
}
