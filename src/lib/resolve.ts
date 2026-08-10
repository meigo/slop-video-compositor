import { clipDuration } from "./project";
import type { Clip, Project, SourceMeta } from "./types";

export type ClipHit = { trackId: string; clip: Clip };

/** Probe reported no video stream (wav/mp3/m4a/…). */
export function isAudioOnlySource(
  sourcePath: string,
  metaByPath: Map<string, SourceMeta>,
): boolean {
  const m = metaByPath.get(sourcePath);
  return !!m && (m.width === 0 || m.height === 0);
}

function coveringOnTrack(
  track: { id: string; clips: Clip[] },
  t: number,
  pred: (c: Clip) => boolean,
): Clip | null {
  let winner: Clip | null = null;
  for (const c of track.clips) {
    if (!pred(c)) continue;
    const end = c.timelineStart + clipDuration(c);
    if (c.timelineStart <= t && t < end) {
      winner = c;
    }
  }
  return winner;
}

/**
 * Hard-cut resolve at timeline time `t` (half-open coverage:
 * timelineStart <= t < timelineStart + duration).
 *
 * - Higher track index wins across tracks.
 * - Same-track edits use overwrite (no intentional overlap). Fallback if data
 *   still overlaps (legacy/hand-edited): last covering clip in `track.clips`.
 *
 * Note: includes audio-only clips. Prefer `videoClipAtTime` for picture and
 * `audioBedAtTime` for underlay music/VO.
 */
export function clipAtTime(project: Project, t: number): ClipHit | null {
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]!;
    const winner = coveringOnTrack(track, t, () => true);
    if (winner) {
      return { trackId: track.id, clip: winner };
    }
  }
  return null;
}

/**
 * Picture winner at `t`: highest track with a **video** clip.
 * Audio-only clips never occlude picture (they underlay as beds).
 */
export function videoClipAtTime(
  project: Project,
  t: number,
  metaByPath: Map<string, SourceMeta>,
): ClipHit | null {
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]!;
    const winner = coveringOnTrack(
      track,
      t,
      (c) => !isAudioOnlySource(c.sourcePath, metaByPath),
    );
    if (winner) {
      return { trackId: track.id, clip: winner };
    }
  }
  return null;
}

/**
 * Topmost unmuted audio-only bed at `t` (music/VO under picture).
 * Independent of which video clip wins — beds play under higher video tracks.
 */
export function audioBedAtTime(
  project: Project,
  t: number,
  metaByPath: Map<string, SourceMeta>,
): ClipHit | null {
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]!;
    const winner = coveringOnTrack(track, t, (c) => {
      if (c.muted === true) return false;
      if (!isAudioOnlySource(c.sourcePath, metaByPath)) return false;
      const meta = metaByPath.get(c.sourcePath);
      return meta?.hasAudio === true;
    });
    if (winner) {
      return { trackId: track.id, clip: winner };
    }
  }
  return null;
}
