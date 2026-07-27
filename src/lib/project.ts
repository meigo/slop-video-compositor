import { newId } from "./id";
import type { Clip, ClipTransform, Project, Track } from "./types";

export const DEFAULT_CANVAS = { width: 1920, height: 1080 };
/** Default empty-sequence length (seconds). */
export const DEFAULT_DURATION = 10;
/** Timeline / export frame rate (matches ffmpeg export `-r 30`). */
export const PROJECT_FPS = 30;

export function frameDuration(fps = PROJECT_FPS): number {
  return 1 / fps;
}

/** Snap seconds to the nearest frame index at `fps`. */
export function snapToFrame(secs: number, fps = PROJECT_FPS): number {
  if (!Number.isFinite(secs) || secs < 0) return 0;
  return Math.round(secs * fps) / fps;
}

/** Snap canvas dim to even integers ≥ 2 (yuv420p / libx264). */
export function evenCanvasDim(n: number): number {
  if (!Number.isFinite(n) || n < 2) return 2;
  return Math.max(2, Math.floor(n / 2) * 2);
}

export function defaultTransform(): ClipTransform {
  return { scale: 1, x: 0, y: 0 };
}

export function createProject(name = "Untitled"): Project {
  const tracks: Track[] = [
    { id: newId(), name: "V1", clips: [] },
    { id: newId(), name: "V2", clips: [] },
  ];
  return {
    version: 1,
    name,
    canvas: { ...DEFAULT_CANVAS },
    duration: DEFAULT_DURATION,
    tracks,
  };
}

export function clipDuration(c: Clip): number {
  return c.sourceOut - c.sourceIn;
}

/**
 * Deep-clone a project for undo/drag snapshots.
 * JSON round-trip works with Svelte 5 `$state` proxies; `structuredClone` can throw on them.
 */
export function cloneProject(p: Project): Project {
  return JSON.parse(JSON.stringify(p)) as Project;
}

/** End time of the last clip (0 if empty). Ignores stored sequence duration. */
export function contentDuration(p: Project): number {
  let max = 0;
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      const end = clip.timelineStart + clipDuration(clip);
      if (end > max) max = end;
    }
  }
  return max;
}

/**
 * Effective timeline / export length: max(user duration, content).
 * After a program-out trim, content ≤ stored duration; extending past content
 * only lengthens the black tail.
 */
export function projectDuration(p: Project): number {
  const stored = Number.isFinite(p.duration) ? Math.max(0, p.duration) : 0;
  return Math.max(contentDuration(p), stored);
}

/**
 * Hard-cut program out at time `t`: delete clips that start at/after `t`,
 * right-trim clips that straddle `t`, leave earlier clips alone.
 * Sets `duration` to `t` (no longer forced ≥ content).
 */
export function trimProjectToTime(p: Project, t: number): Project {
  const end = Number.isFinite(t) ? Math.max(0, t) : 0;
  let changed = p.duration !== end;
  const tracks = p.tracks.map((track) => {
    const clips: Clip[] = [];
    let trackChanged = false;
    for (const clip of track.clips) {
      const c0 = clip.timelineStart;
      const c1 = c0 + clipDuration(clip);
      if (c0 >= end) {
        trackChanged = true;
        continue;
      }
      if (c1 <= end) {
        clips.push(clip);
        continue;
      }
      // Straddles end → trim sourceOut so timeline end === end
      const newSourceOut = clip.sourceIn + (end - c0);
      if (!(newSourceOut > clip.sourceIn)) {
        trackChanged = true;
        continue;
      }
      if (newSourceOut !== clip.sourceOut) {
        trackChanged = true;
        clips.push({ ...clip, sourceOut: newSourceOut });
      } else {
        clips.push(clip);
      }
    }
    if (trackChanged) {
      changed = true;
      return { ...track, clips };
    }
    return track;
  });
  if (!changed) return p;
  return { ...p, tracks, duration: end };
}

/**
 * Set sequence length (seconds).
 * - Longer than content → black tail only (clips unchanged).
 * - Shorter than content → program out: trim/delete clip tails past `secs`.
 */
export function setProjectDuration(p: Project, secs: number): Project {
  const duration = Number.isFinite(secs) ? Math.max(0, secs) : 0;
  const content = contentDuration(p);
  if (duration >= content) {
    if (p.duration === duration) return p;
    return { ...p, duration };
  }
  return trimProjectToTime(p, duration);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function parseClip(raw: unknown, path: string): Clip {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`${path}: expected object`);
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || c.id.length === 0) {
    throw new Error(`${path}.id: expected non-empty string`);
  }
  if (typeof c.sourcePath !== "string" || c.sourcePath.length === 0) {
    throw new Error(`${path}.sourcePath: expected non-empty string`);
  }
  if (!isFiniteNumber(c.sourceIn)) {
    throw new Error(`${path}.sourceIn: expected finite number`);
  }
  if (!isFiniteNumber(c.sourceOut)) {
    throw new Error(`${path}.sourceOut: expected finite number`);
  }
  if (!(c.sourceOut > c.sourceIn)) {
    throw new Error(`${path}: sourceOut must be greater than sourceIn`);
  }
  if (!isFiniteNumber(c.timelineStart)) {
    throw new Error(`${path}.timelineStart: expected finite number`);
  }
  if (c.transform === null || typeof c.transform !== "object") {
    throw new Error(`${path}.transform: expected object`);
  }
  const t = c.transform as Record<string, unknown>;
  if (!isFiniteNumber(t.scale) || !isFiniteNumber(t.x) || !isFiniteNumber(t.y)) {
    throw new Error(`${path}.transform: scale, x, y must be finite numbers`);
  }
  return {
    id: c.id,
    sourcePath: c.sourcePath,
    sourceIn: c.sourceIn,
    sourceOut: c.sourceOut,
    timelineStart: c.timelineStart,
    transform: { scale: t.scale, x: t.x, y: t.y },
  };
}

function parseTrack(raw: unknown, path: string): Track {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`${path}: expected object`);
  }
  const tr = raw as Record<string, unknown>;
  if (typeof tr.id !== "string" || tr.id.length === 0) {
    throw new Error(`${path}.id: expected non-empty string`);
  }
  if (typeof tr.name !== "string") {
    throw new Error(`${path}.name: expected string`);
  }
  if (!Array.isArray(tr.clips)) {
    throw new Error(`${path}.clips: expected array`);
  }
  return {
    id: tr.id,
    name: tr.name,
    clips: tr.clips.map((clip, i) => parseClip(clip, `${path}.clips[${i}]`)),
  };
}

export function parseProject(json: unknown): Project {
  if (json === null || typeof json !== "object") {
    throw new Error("project: expected object");
  }
  const p = json as Record<string, unknown>;
  if (p.version !== 1) {
    throw new Error("project.version: must be 1");
  }
  if (typeof p.name !== "string") {
    throw new Error("project.name: expected string");
  }
  if (p.canvas === null || typeof p.canvas !== "object") {
    throw new Error("project.canvas: expected object");
  }
  const canvas = p.canvas as Record<string, unknown>;
  if (!isFiniteNumber(canvas.width) || canvas.width <= 0) {
    throw new Error("project.canvas.width: expected positive number");
  }
  if (!isFiniteNumber(canvas.height) || canvas.height <= 0) {
    throw new Error("project.canvas.height: expected positive number");
  }
  if (!Array.isArray(p.tracks)) {
    throw new Error("project.tracks: expected array");
  }
  const tracks = p.tracks.map((track, i) => parseTrack(track, `project.tracks[${i}]`));
  const width = evenCanvasDim(canvas.width);
  const height = evenCanvasDim(canvas.height);
  const content = contentDuration({
    version: 1,
    name: p.name,
    canvas: { width, height },
    duration: 0,
    tracks,
  });
  // Back-compat: missing duration → fit content (0 if empty)
  let duration = content;
  if (isFiniteNumber(p.duration) && p.duration >= 0) {
    duration = Math.max(content, p.duration);
  }
  return {
    version: 1,
    name: p.name,
    canvas: { width, height },
    duration,
    tracks,
  };
}

/**
 * Serialize project JSON for disk / handoff.
 * Writes effective duration (`max(stored, content)`) so external readers
 * do not under-report length when clips extend past the stored field.
 */
export function serializeProject(p: Project): string {
  const duration = projectDuration(p);
  return JSON.stringify({ ...p, duration }, null, 2);
}

/** Normalize stored duration up to content so in-memory and on-disk agree. */
export function withEffectiveDuration(p: Project): Project {
  const duration = projectDuration(p);
  if (p.duration === duration) return p;
  return { ...p, duration };
}
