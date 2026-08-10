import { clipDuration, projectDuration } from "./project";
import { clipAtTime } from "./resolve";
import type { Project, Segment, SourceMeta } from "./types";

/**
 * Flatten project timeline [0, projectDuration) into non-overlapping segments.
 * Uses hard-cut resolve; merges adjacent clip segments with same clipId and
 * continuous source time; merges adjacent black segments.
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

    const hit = clipAtTime(project, t0);
    if (!hit) {
      raw.push({ kind: "black", t0, t1 });
      continue;
    }

    const { clip, trackId } = hit;
    const meta = metaByPath.get(clip.sourcePath);
    const sourceStart = clip.sourceIn + (t0 - clip.timelineStart);
    raw.push({
      kind: "clip",
      clipId: clip.id,
      trackId,
      sourcePath: clip.sourcePath,
      sourceStart,
      t0,
      t1,
      transform: { ...clip.transform },
      srcW: meta?.width ?? 0,
      srcH: meta?.height ?? 0,
      hasAudio: (meta?.hasAudio ?? false) && clip.muted !== true,
    });
  }

  return mergeAdjacent(raw);
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
      prev.sourceStart + (prev.t1 - prev.t0) === seg.sourceStart
    ) {
      prev.t1 = seg.t1;
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}
