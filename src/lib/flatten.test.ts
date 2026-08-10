import { describe, it, expect } from "vitest";
import { createProject, defaultTransform } from "./project";
import { flattenProject } from "./flatten";
import type { SourceMeta } from "./types";

const meta = new Map<string, SourceMeta>([
  ["/a.mp4", { path: "/a.mp4", duration: 100, width: 1920, height: 1080, hasAudio: true }],
]);

describe("flattenProject", () => {
  it("emits black for gaps", () => {
    const p = createProject();
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    p.tracks[0].clips.push({
      id: "b",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 5,
      transform: defaultTransform(),
    });
    const segs = flattenProject(p, meta);
    expect(segs.some((s) => s.kind === "black" && s.t0 === 2 && s.t1 === 5)).toBe(true);
  });
  it("sets hasAudio false when clip is muted even if source has audio", () => {
    const p = createProject();
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 0,
      transform: defaultTransform(),
      muted: true,
    });
    const segs = flattenProject(p, meta);
    const clip = segs.find((s) => s.kind === "clip");
    expect(clip).toMatchObject({ kind: "clip", hasAudio: false });
  });

  it("higher track wins in middle", () => {
    const p = createProject();
    p.tracks[0].clips.push({
      id: "low",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 10,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    p.tracks[1].clips.push({
      id: "high",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 4,
      transform: defaultTransform(),
    });
    const segs = flattenProject(p, meta).filter((s) => s.kind === "clip");
    const mid = segs.find((s) => s.kind === "clip" && s.t0 === 4);
    expect(mid && mid.kind === "clip" && mid.clipId).toBe("high");
  });
});
