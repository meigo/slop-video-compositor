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

/**
 * Shift many clips by the same Δt (group move). Tracks stay put.
 * Positions update first, then each selected clip overwrites non-selected neighbors.
 * Relative spacing among the set is preserved, so they do not overwrite each other.
 */
/**
 * Leave originals in place; add a copy of `clipId` at `timelineStart` on `toTrackId`
 * (or the source track). Copy overwrites neighbors like a normal place.
 */
export function duplicateClipTo(
  project: Project,
  clipId: string,
  timelineStart: number,
  toTrackId?: string,
): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const destId =
    toTrackId && project.tracks.some((t) => t.id === toTrackId)
      ? toTrackId
      : project.tracks[found.trackIndex]!.id;
  const start = Math.max(0, Number.isFinite(timelineStart) ? timelineStart : 0);
  const clone: Clip = {
    ...found.clip,
    id: newId(),
    timelineStart: start,
    transform: { ...found.clip.transform },
  };
  return addClip(project, destId, clone);
}

/**
 * Leave originals in place; add copies shifted by `deltaT` on the same tracks.
 * Used for Option/Alt multi-drag duplicate (group keeps relative spacing).
 */
export function duplicateClipsByDelta(
  project: Project,
  clipIds: string[],
  deltaT: number,
): Project {
  const ids = [...new Set(clipIds)].filter((id) => findClip(project, id));
  if (ids.length === 0 || !Number.isFinite(deltaT)) return project;

  let minStart = Infinity;
  for (const id of ids) {
    minStart = Math.min(minStart, findClip(project, id)!.clip.timelineStart);
  }
  const d = Math.max(deltaT, -minStart);

  // Stable place order: lower track first, then timeline — matches group move overwrite.
  const ordered = ids
    .map((id) => {
      const f = findClip(project, id)!;
      return { id, ti: f.trackIndex, trackId: project.tracks[f.trackIndex]!.id, clip: f.clip };
    })
    .sort((a, b) => a.ti - b.ti || a.clip.timelineStart - b.clip.timelineStart);

  let next = project;
  for (const { trackId, clip } of ordered) {
    const clone: Clip = {
      ...clip,
      id: newId(),
      timelineStart: clip.timelineStart + d,
      transform: { ...clip.transform },
    };
    next = addClip(next, trackId, clone);
  }
  return next;
}

export function moveClipsByDelta(
  project: Project,
  clipIds: string[],
  deltaT: number,
): Project {
  const ids = [...new Set(clipIds)].filter((id) => findClip(project, id));
  if (ids.length === 0 || !Number.isFinite(deltaT) || deltaT === 0) return project;

  let minStart = Infinity;
  for (const id of ids) {
    const f = findClip(project, id)!;
    minStart = Math.min(minStart, f.clip.timelineStart);
  }
  const d = Math.max(deltaT, -minStart);
  if (d === 0) return project;

  const idSet = new Set(ids);
  let next: Project = {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => {
        if (!idSet.has(c.id)) return c;
        return { ...c, timelineStart: c.timelineStart + d };
      }),
    })),
  };

  // Stable order: lower track first, then timeline start — each wins vs non-selected only.
  const ordered = ids
    .map((id) => {
      const f = findClip(next, id);
      return f ? { id, ti: f.trackIndex, t: f.clip.timelineStart } : null;
    })
    .filter((x): x is { id: string; ti: number; t: number } => x != null)
    .sort((a, b) => a.ti - b.ti || a.t - b.t);

  for (const { id } of ordered) {
    next = overwriteWithClip(next, id);
  }
  return next;
}

/** Delete many clips; returns project unchanged if none found. */
export function deleteClips(project: Project, clipIds: string[]): Project {
  let next = project;
  let changed = false;
  for (const id of clipIds) {
    const n = deleteClip(next, id);
    if (n !== next) {
      next = n;
      changed = true;
    }
  }
  return changed ? next : project;
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
