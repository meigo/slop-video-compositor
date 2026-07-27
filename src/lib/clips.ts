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

export function moveClip(
  project: Project,
  clipId: string,
  timelineStart: number,
  toTrackId?: string,
): Project {
  const found = findClip(project, clipId);
  if (!found) return project;

  const moved: Clip = { ...found.clip, timelineStart };

  if (toTrackId === undefined || toTrackId === project.tracks[found.trackIndex].id) {
    return updateClipAt(project, found.trackIndex, found.clipIndex, moved);
  }

  const destIndex = project.tracks.findIndex((t) => t.id === toTrackId);
  if (destIndex < 0) return project;

  return {
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
  return updateClipAt(project, found.trackIndex, found.clipIndex, updated);
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
  return updateClipAt(project, found.trackIndex, found.clipIndex, updated);
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

  return mapTracks(project, (track, ti) => {
    if (ti !== trackIndex) return track;
    return { ...track, clips: [...track.clips, clip] };
  });
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
