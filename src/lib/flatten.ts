import { clipDuration, projectDuration } from "./project";
import { audioBedAtTime, videoClipAtTime } from "./resolve";
import type { Project, Segment, SegmentBedAudio, SourceMeta } from "./types";

/**
 * Flatten project timeline [0, projectDuration) into non-overlapping segments.
 *
 * Picture: highest **video** clip (audio-only never occludes).
 * Audio bed: topmost unmuted audio-only clip, mixed under picture on export.
 * Audio-only alone (no video) → black picture + that source as the clip.
 */
export function flattenProject(
  project: Project,
  metaByPath: Map<string, SourceMeta>,
): Segment[] {
  const T = projectDuration(project);
  if (T <= 0) return [];

  const times = new Set<number>([0, T]);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      times.add(clip.timelineStart);
      times.add(clip.timelineStart + clipDuration(clip));
    }
  }

  const sorted = [...times]
    .filter((t) => t >= 0 && t <= T)
    .sort((a, b) => a - b);

  const raw: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i]!;
    const t1 = sorted[i + 1]!;
    if (!(t1 > t0)) continue;

    const videoHit = videoClipAtTime(project, t0, metaByPath);
    const bedHit = audioBedAtTime(project, t0, metaByPath);

    if (!videoHit && !bedHit) {
      raw.push({ kind: "black", t0, t1 });
      continue;
    }

    // Pure audio bed (no video): encode as audio-only clip (black + audio).
    if (!videoHit && bedHit) {
      const { clip, trackId } = bedHit;
      const meta = metaByPath.get(clip.sourcePath);
      raw.push({
        kind: "clip",
        clipId: clip.id,
        trackId,
        sourcePath: clip.sourcePath,
        sourceStart: clip.sourceIn + (t0 - clip.timelineStart),
        t0,
        t1,
        transform: { ...clip.transform },
        srcW: 0,
        srcH: 0,
        hasAudio: (meta?.hasAudio ?? false) && clip.muted !== true,
      });
      continue;
    }

    const { clip, trackId } = videoHit!;
    const meta = metaByPath.get(clip.sourcePath);
    let bedAudio: SegmentBedAudio | undefined;
    if (bedHit) {
      bedAudio = {
        clipId: bedHit.clip.id,
        sourcePath: bedHit.clip.sourcePath,
        sourceStart: bedHit.clip.sourceIn + (t0 - bedHit.clip.timelineStart),
      };
    }
    raw.push({
      kind: "clip",
      clipId: clip.id,
      trackId,
      sourcePath: clip.sourcePath,
      sourceStart: clip.sourceIn + (t0 - clip.timelineStart),
      t0,
      t1,
      transform: { ...clip.transform },
      srcW: meta?.width ?? 0,
      srcH: meta?.height ?? 0,
      hasAudio: (meta?.hasAudio ?? false) && clip.muted !== true,
      bedAudio,
    });
  }

  return mergeAdjacent(raw);
}

function bedKey(s: Segment): string {
  if (s.kind !== "clip" || !s.bedAudio) return "";
  return `${s.bedAudio.clipId}@${s.bedAudio.sourceStart}`;
}

function mergeAdjacent(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segs) {
    const prev = out[out.length - 1];
    if (!prev || prev.t1 !== seg.t0) {
      out.push({ ...seg });
      continue;
    }
    if (prev.kind === "black" && seg.kind === "black") {
      prev.t1 = seg.t1;
      continue;
    }
    if (
      prev.kind === "clip" &&
      seg.kind === "clip" &&
      prev.clipId === seg.clipId &&
      prev.sourceStart + (prev.t1 - prev.t0) === seg.sourceStart &&
      bedKey(prev) === bedKey(seg) &&
      // continuous bed source time when a bed is present
      (!prev.bedAudio ||
        !seg.bedAudio ||
        prev.bedAudio.sourceStart + (prev.t1 - prev.t0) === seg.bedAudio.sourceStart)
    ) {
      prev.t1 = seg.t1;
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}
