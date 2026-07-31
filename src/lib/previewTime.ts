import { clipDuration, projectDuration } from "./project";
import { clipAtTime } from "./resolve";
import { clamp } from "./time";
import type { Clip, Project } from "./types";

/** Map timeline time → source media time for a clip. */
export function sourceTimeAt(clip: Clip, timelineT: number): number {
  return clip.sourceIn + (timelineT - clip.timelineStart);
}

/** Exclusive timeline end of a clip. */
export function clipTimelineEnd(clip: Clip): number {
  return clip.timelineStart + clipDuration(clip);
}

/**
 * Clamp a source-time seek into the clip's trimmed range.
 * `endEps` keeps seeks slightly before `sourceOut` so decoders do not stick on EOF.
 */
export function clampSourceSeek(clip: Clip, sourceT: number, endEps = 1 / 30): number {
  const maxT = Math.max(clip.sourceIn, clip.sourceOut - endEps);
  return clamp(sourceT, clip.sourceIn, maxT);
}

/**
 * Next hard-cut media clip after `clip`'s exclusive end (skips black gaps).
 * Uses timeline cut points (clip starts ≥ end) rather than a fixed micro-step walk.
 * Pure helper for dual-buffer prefetch / cut swaps.
 */
export function nextClipAfter(project: Project, clip: Clip): Clip | null {
  const end = clipTimelineEnd(clip);
  const total = projectDuration(project);
  if (!(end < total)) return null;

  // Abutting clips resolve at `end`; later clips at their timelineStart.
  const candidates = new Set<number>([end]);
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (c.timelineStart >= end && c.timelineStart < total) {
        candidates.add(c.timelineStart);
      }
    }
  }

  const sorted = [...candidates].sort((a, b) => a - b);
  for (const t of sorted) {
    const hit = clipAtTime(project, t);
    if (hit && hit.clip.id !== clip.id) return hit.clip;
  }
  return null;
}

/**
 * First hard-cut clip in the sequence (skips a leading black gap).
 * Pure helper for loop wrap-around prefetch; null when the timeline has no media.
 */
export function firstClipInSequence(project: Project): Clip | null {
  const total = projectDuration(project);
  const candidates = new Set<number>([0]);
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (c.timelineStart >= 0 && c.timelineStart < total) {
        candidates.add(c.timelineStart);
      }
    }
  }

  const sorted = [...candidates].sort((a, b) => a - b);
  for (const t of sorted) {
    const hit = clipAtTime(project, t);
    if (hit) return hit.clip;
  }
  return null;
}

/** True when remaining media time in the active clip is within the prefetch lead. */
export function shouldPrefetchNearCut(
  sourceOut: number,
  videoTime: number,
  leadSecs: number,
): boolean {
  return sourceOut - videoTime <= leadSecs;
}
