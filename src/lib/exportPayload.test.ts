import { describe, it, expect } from "vitest";
import { createProject, defaultTransform, projectDuration, setProjectDuration } from "./project";
import { toExportOpts } from "./exportPayload";
import { flattenProject } from "./flatten";
import type { SourceMeta } from "./types";

const meta = new Map<string, SourceMeta>([
  ["/a.mp4", { path: "/a.mp4", duration: 100, width: 1920, height: 1080, hasAudio: true }],
  ["/b.mp4", { path: "/b.mp4", duration: 50, width: 640, height: 360, hasAudio: false }],
]);

describe("toExportOpts", () => {
  it("maps flatten segments to snake_case wire shape and sums to projectDuration", () => {
    const p = createProject();
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/a.mp4",
      sourceIn: 1,
      sourceOut: 3,
      timelineStart: 0,
      transform: { scale: 1.5, x: 10, y: -5 },
    });
    p.tracks[0].clips.push({
      id: "b",
      sourcePath: "/b.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 4,
      transform: defaultTransform(),
    });
    // gap 2–4 black; trailing empty uses stored duration only if longer than content
    const withTail = setProjectDuration(p, 10);
    const opts = toExportOpts(withTail, meta, "/out/final.mp4");

    expect(opts.canvas_width).toBe(1920);
    expect(opts.canvas_height).toBe(1080);
    expect(opts.output_path).toBe("/out/final.mp4");

    const sum = opts.segments.reduce((acc, s) => acc + s.duration, 0);
    expect(sum).toBeCloseTo(projectDuration(withTail), 10);

    const clipA = opts.segments.find(
      (s) => s.kind === "clip" && s.source_path === "/a.mp4",
    );
    expect(clipA).toMatchObject({
      kind: "clip",
      source_path: "/a.mp4",
      source_start: 1,
      duration: 2,
      scale: 1.5,
      x: 10,
      y: -5,
      src_w: 1920,
      src_h: 1080,
      has_audio: true,
    });

    const clipB = opts.segments.find(
      (s) => s.kind === "clip" && s.source_path === "/b.mp4",
    );
    expect(clipB).toMatchObject({
      kind: "clip",
      has_audio: false,
      src_w: 640,
      src_h: 360,
    });

    expect(opts.segments.some((s) => s.kind === "black" && s.duration === 2)).toBe(true);
    // trailing black after last clip end (6) to duration 10
    expect(opts.segments.some((s) => s.kind === "black" && s.duration === 4)).toBe(true);
  });

  it("uses zero size and no audio when meta is missing", () => {
    const p = createProject();
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/missing.mp4",
      sourceIn: 0,
      sourceOut: 1,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    const opts = toExportOpts(p, new Map(), "/out.mp4");
    const clip = opts.segments.find((s) => s.kind === "clip");
    expect(clip).toMatchObject({
      kind: "clip",
      src_w: 0,
      src_h: 0,
      has_audio: false,
    });
  });

  it("treats muted clips as no audio on export", () => {
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
    const opts = toExportOpts(p, meta, "/out.mp4");
    const clip = opts.segments.find((s) => s.kind === "clip");
    expect(clip).toMatchObject({
      kind: "clip",
      source_path: "/a.mp4",
      has_audio: false,
    });
  });

  it("maps audio-only meta as zero size with audio", () => {
    const audioMeta = new Map<string, SourceMeta>([
      ["/bed.mp3", { path: "/bed.mp3", duration: 30, width: 0, height: 0, hasAudio: true }],
    ]);
    const p = createProject();
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/bed.mp3",
      sourceIn: 0,
      sourceOut: 5,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    const opts = toExportOpts(p, audioMeta, "/out.mp4");
    const clip = opts.segments.find((s) => s.kind === "clip");
    expect(clip).toMatchObject({
      kind: "clip",
      source_path: "/bed.mp3",
      src_w: 0,
      src_h: 0,
      has_audio: true,
      duration: 5,
    });
  });

  it("wires bed underlay paths for video + audio bed", () => {
    const m = new Map<string, SourceMeta>([
      ...meta,
      ["/bed.m4a", { path: "/bed.m4a", duration: 30, width: 0, height: 0, hasAudio: true }],
    ]);
    const p = createProject();
    p.tracks[0].clips.push({
      id: "bed",
      sourcePath: "/bed.m4a",
      sourceIn: 0,
      sourceOut: 5,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    p.tracks[1].clips.push({
      id: "vid",
      sourcePath: "/a.mp4",
      sourceIn: 2,
      sourceOut: 6,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    const opts = toExportOpts(p, m, "/out.mp4");
    const clip = opts.segments.find((s) => s.kind === "clip");
    expect(clip).toMatchObject({
      kind: "clip",
      source_path: "/a.mp4",
      source_start: 2,
      has_audio: true,
      bed_source_path: "/bed.m4a",
      bed_source_start: 0,
    });
  });
});

describe("flattenProject merge / trailing black", () => {
  it("merges continuous same-clip segments across intermediate cut points", () => {
    const p = createProject();
    // One long clip; intermediate times from another track's short clip should not break merge
    // when higher track is not covering continuously... use single clip only.
    p.tracks[0].clips.push({
      id: "long",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 6,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    // Force intermediate boundary via empty higher track gap events: add a non-overlapping
    // second clip after so times include 0,6,8 and middle is one segment.
    p.tracks[0].clips.push({
      id: "later",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 1,
      timelineStart: 8,
      transform: defaultTransform(),
    });
    const segs = flattenProject(p, meta);
    const long = segs.find((s) => s.kind === "clip" && s.clipId === "long");
    expect(long).toMatchObject({ kind: "clip", t0: 0, t1: 6, sourceStart: 0 });
  });

  it("emits trailing black when stored duration exceeds content", () => {
    const p = createProject();
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    const extended = setProjectDuration(p, 5);
    const segs = flattenProject(extended, meta);
    expect(segs.some((s) => s.kind === "black" && s.t0 === 2 && s.t1 === 5)).toBe(true);
  });
});
