import { newId } from "./id";
import { clamp } from "./time";
import { clipDuration } from "./project";
import type { Clip, Project, Track } from "./types";

export function findClip(
  project: Project,
  clipId: string,
): { trackIndex: number; clipIndex: number; clip: Clip } | null {
  for (let ti = 0; ti < project.tracks.length; ti++) {
    const track = project.tracks[ti];
    for (let ci = 0; ci < track.clips.length; ci++) {
      if (track.clips[ci].id === clipId) {
        return { trackIndex: ti, clipIndex: ci, clip: track.clips[ci] };
      }
    }
  }
  return null;
}

function mapTracks(project: Project, fn: (track: Track, ti: number) => Track): Project {
  return {
    ...project,
    tracks: project.tracks.map(fn),
  };
}

function updateClipAt(
  project: Project,
  trackIndex: number,
  clipIndex: number,
  clip: Clip,
): Project {
  return mapTracks(project, (track, ti) => {
    if (ti !== trackIndex) return track;
    const clips = track.clips.slice();
    clips[clipIndex] = clip;
    return { ...track, clips };
  });
}

/**
 * Same-track overwrite: `winnerId` keeps its full range; other clips on that track
 * are trimmed, split, or removed so ranges never overlap (hard-cut NLE convention).
 * Cross-track clips are unchanged. No-op if winner is missing or has zero duration.
 */
export function overwriteWithClip(project: Project, winnerId: string): Project {
  const found = findClip(project, winnerId);
  if (!found) return project;

  const winner = found.clip;
  const w0 = winner.timelineStart;
  const w1 = w0 + clipDuration(winner);
  if (!(w1 > w0)) return project;

  const track = project.tracks[found.trackIndex]!;
  const nextClips: Clip[] = [];
  let changed = false;

  for (const c of track.clips) {
    if (c.id === winnerId) {
      nextClips.push(winner);
      continue;
    }

    const c0 = c.timelineStart;
    const c1 = c0 + clipDuration(c);
    // Half-open: no overlap if neighbor ends at/before winner start or starts at/after winner end.
    if (!(c0 < w1 && c1 > w0)) {
      nextClips.push(c);
      continue;
    }

    changed = true;

    // Fully covered → remove.
    if (c0 >= w0 && c1 <= w1) {
      continue;
    }

    // Left remnant [c0, w0).
    if (c0 < w0) {
      const leftSourceOut = c.sourceIn + (w0 - c0);
      if (leftSourceOut > c.sourceIn) {
        nextClips.push({ ...c, sourceOut: leftSourceOut });
      }
    }

    // Right remnant [w1, c1).
    if (c1 > w1) {
      const rightSourceIn = c.sourceIn + (w1 - c0);
      if (c.sourceOut > rightSourceIn) {
        if (c0 < w0) {
          // Split: left kept original id; right needs a new id.
          nextClips.push({
            ...c,
            id: newId(),
            sourceIn: rightSourceIn,
            timelineStart: w1,
            transform: { ...c.transform },
          });
        } else {
          // Only right side remains — keep id.
          nextClips.push({
            ...c,
            sourceIn: rightSourceIn,
            timelineStart: w1,
          });
        }
      }
    }
  }

  if (!changed) return project;

  return mapTracks(project, (t, ti) => {
    if (ti !== found.trackIndex) return t;
    return { ...t, clips: nextClips };
  });
}

export function moveClip(
  project: Project,
  clipId: string,
  timelineStart: number,
  toTrackId?: string,
): Project {
  const found = findClip(project, clipId);
  if (!found) return project;

  const moved: Clip = { ...found.clip, timelineStart };

  let next: Project;
  if (toTrackId === undefined || toTrackId === project.tracks[found.trackIndex].id) {
    next = updateClipAt(project, found.trackIndex, found.clipIndex, moved);
  } else {
    const destIndex = project.tracks.findIndex((t) => t.id === toTrackId);
    if (destIndex < 0) return project;

    next = {
      ...project,
      tracks: project.tracks.map((track, ti) => {
        if (ti === found.trackIndex) {
          return {
            ...track,
            clips: track.clips.filter((_, i) => i !== found.clipIndex),
          };
        }
        if (ti === destIndex) {
          return { ...track, clips: [...track.clips, moved] };
        }
        return track;
      }),
    };
  }

  return overwriteWithClip(next, clipId);
}

/** Left edge trim: newSourceIn, keeps timeline visual right edge stable when possible. */
export function trimClipIn(project: Project, clipId: string, newSourceIn: number): Project {
  const found = findClip(project, clipId);
  if (!found) return project;

  const { clip } = found;
  // Clamp to [0, sourceOut) so sourceIn' < sourceOut always holds when duration was positive.
  const maxIn = clip.sourceOut; // exclusive upper bound handled below
  let sourceIn = clamp(newSourceIn, 0, maxIn);
  if (!(sourceIn < clip.sourceOut)) {
    // Keep a positive duration if clamp hit the exclusive end (e.g. newSourceIn >= sourceOut)
    // Brief: clamp to [0, sourceOut) — use next-smaller representable via requiring strict <.
    // If still invalid, no-op.
    return project;
  }

  const delta = sourceIn - clip.sourceIn;
  const updated: Clip = {
    ...clip,
    sourceIn,
    timelineStart: clip.timelineStart + delta,
  };
  return overwriteWithClip(
    updateClipAt(project, found.trackIndex, found.clipIndex, updated),
    clipId,
  );
}

export function trimClipOut(project: Project, clipId: string, newSourceOut: number): Project {
  const found = findClip(project, clipId);
  if (!found) return project;

  const { clip } = found;
  if (!(clip.sourceIn < newSourceOut)) return project;

  const updated: Clip = {
    ...clip,
    sourceOut: newSourceOut,
  };
  return overwriteWithClip(
    updateClipAt(project, found.trackIndex, found.clipIndex, updated),
    clipId,
  );
}

/** Split clip at absolute timeline time t. No-op if t not strictly inside clip. */
export function splitClip(project: Project, clipId: string, t: number): Project {
  const found = findClip(project, clipId);
  if (!found) return project;

  const { clip, trackIndex, clipIndex } = found;
  const duration = clipDuration(clip);
  const local = t - clip.timelineStart;
  if (!(local > 0 && local < duration)) return project;

  const left: Clip = {
    ...clip,
    sourceOut: clip.sourceIn + local,
  };
  const right: Clip = {
    ...clip,
    id: newId(),
    sourceIn: clip.sourceIn + local,
    timelineStart: t,
    transform: { ...clip.transform },
  };

  return mapTracks(project, (track, ti) => {
    if (ti !== trackIndex) return track;
    const clips = track.clips.slice();
    clips.splice(clipIndex, 1, left, right);
    return { ...track, clips };
  });
}

export function deleteClip(project: Project, clipId: string): Project {
  const found = findClip(project, clipId);
  if (!found) return project;

  return mapTracks(project, (track, ti) => {
    if (ti !== found.trackIndex) return track;
    return {
      ...track,
      clips: track.clips.filter((_, i) => i !== found.clipIndex),
    };
  });
}

export function addClip(project: Project, trackId: string, clip: Clip): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === trackId);
  if (trackIndex < 0) return project;

  const next = mapTracks(project, (track, ti) => {
    if (ti !== trackIndex) return track;
    return { ...track, clips: [...track.clips, clip] };
  });
  return overwriteWithClip(next, clip.id);
}

/**
 * Clamp clip source range into [0, mediaDuration].
 * Returns null if no positive duration remains inside the media.
 */
export function clampClipSourceToMedia(clip: Clip, mediaDuration: number): Clip | null {
  if (!Number.isFinite(mediaDuration) || !(mediaDuration > 0)) return null;
  const sourceIn = clamp(clip.sourceIn, 0, mediaDuration);
  const sourceOut = clamp(clip.sourceOut, 0, mediaDuration);
  if (!(sourceOut > sourceIn)) return null;
  if (sourceIn === clip.sourceIn && sourceOut === clip.sourceOut) return clip;
  return { ...clip, sourceIn, sourceOut };
}

export type ClampProjectSourcesResult = {
  project: Project;
  /** Clip ids that could not keep a positive range inside media. */
  invalidIds: string[];
  changed: boolean;
};

/** Clamp every clip’s sourceIn/sourceOut to its media duration when meta is present. */
export function clampProjectSourcesToMedia(
  project: Project,
  metaByPath: Map<string, { duration: number }>,
): ClampProjectSourcesResult {
  const invalidIds: string[] = [];
  let changed = false;
  const tracks = project.tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      const meta = metaByPath.get(clip.sourcePath);
      if (!meta || !Number.isFinite(meta.duration)) return clip;
      const next = clampClipSourceToMedia(clip, meta.duration);
      if (!next) {
        invalidIds.push(clip.id);
        return clip;
      }
      if (next !== clip) {
        trackChanged = true;
        changed = true;
        return next;
      }
      return clip;
    });
    return trackChanged ? { ...track, clips } : track;
  });
  return {
    project: changed ? { ...project, tracks } : project,
    invalidIds,
    changed,
  };
}

export function addTrack(project: Project, name?: string): Project {
  const trackName = name ?? `V${project.tracks.length + 1}`;
  const track: Track = {
    id: newId(),
    name: trackName,
    clips: [],
  };
  return {
    ...project,
    tracks: [...project.tracks, track],
  };
}
