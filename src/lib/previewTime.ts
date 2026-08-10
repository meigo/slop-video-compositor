import { clipDuration, projectDuration } from "./project";
import { videoClipAtTime } from "./resolve";
import { clamp } from "./time";
import type { Clip, Project, SourceMeta } from "./types";

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
 * Standby preroll seek: a little before `sourceIn` so playback can roll into the cut
 * past keyframe stalls. Clamped to ≥ 0 and still below sourceOut.
 */
export function clampSourceSeekPreroll(
  clip: Clip,
  prerollSecs: number,
  endEps = 1 / 30,
): number {
  const preroll = Number.isFinite(prerollSecs) ? Math.max(0, prerollSecs) : 0;
  const target = Math.max(0, clip.sourceIn - preroll);
  const maxT = Math.max(target, clip.sourceOut - endEps);
  return clamp(target, 0, maxT);
}

/** True when remaining media time in the active clip is within the prefetch lead. */
export function shouldPrefetchNearCut(
  sourceOut: number,
  videoTime: number,
  leadSecs: number,
): boolean {
  return sourceOut - videoTime <= leadSecs;
}

/**
 * True when we should start muted free-run on the prefetched standby so it is
 * already rolling at the cut (seek-early / play-into-cut).
 */
export function shouldPrerollStandby(
  sourceOut: number,
  videoTime: number,
  prerollSecs: number,
): boolean {
  if (!(prerollSecs > 0)) return false;
  return sourceOut - videoTime <= prerollSecs;
}

/**
 * Next hard-cut **video** clip after `clip`'s exclusive end (skips black gaps
 * and ignores audio-only beds). Pure helper for dual-buffer prefetch / cut swaps.
 */
export function nextClipAfter(
  project: Project,
  clip: Clip,
  metaByPath: Map<string, SourceMeta>,
): Clip | null {
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
    const hit = videoClipAtTime(project, t, metaByPath);
    if (hit && hit.clip.id !== clip.id) return hit.clip;
  }
  return null;
}

/**
 * First hard-cut **video** clip in the sequence (skips a leading black gap and
 * audio-only beds). Pure helper for loop wrap-around prefetch.
 */
export function firstClipInSequence(
  project: Project,
  metaByPath: Map<string, SourceMeta>,
): Clip | null {
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
    const hit = videoClipAtTime(project, t, metaByPath);
    if (hit) return hit.clip;
  }
  return null;
}
