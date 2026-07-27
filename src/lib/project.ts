import { newId } from "./id";
import type { Clip, ClipTransform, Project, Track } from "./types";

export const DEFAULT_CANVAS = { width: 1920, height: 1080 };

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
    tracks,
  };
}

export function clipDuration(c: Clip): number {
  return c.sourceOut - c.sourceIn;
}

export function projectDuration(p: Project): number {
  let max = 0;
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      const end = clip.timelineStart + clipDuration(clip);
      if (end > max) max = end;
    }
  }
  return max;
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
  return {
    version: 1,
    name: p.name,
    canvas: { width: canvas.width, height: canvas.height },
    tracks: p.tracks.map((track, i) => parseTrack(track, `project.tracks[${i}]`)),
  };
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}
