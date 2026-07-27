import { describe, it, expect } from "vitest";
import {
  createProject,
  projectDuration,
  contentDuration,
  setProjectDuration,
  clipDuration,
  parseProject,
  serializeProject,
  defaultTransform,
  cloneProject,
  DEFAULT_DURATION,
  PROJECT_FPS,
  snapToFrame,
  evenCanvasDim,
} from "./project";
import type { Clip, Project } from "./types";

function sampleClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    sourcePath: "/tmp/a.mp4",
    sourceIn: 1,
    sourceOut: 4,
    timelineStart: 2,
    transform: defaultTransform(),
    ...over,
  };
}

describe("createProject", () => {
  it("starts with two tracks, default canvas, and default duration", () => {
    const p = createProject("Test");
    expect(p.version).toBe(1);
    expect(p.canvas).toEqual({ width: 1920, height: 1080 });
    expect(p.duration).toBe(DEFAULT_DURATION);
    expect(p.tracks).toHaveLength(2);
    expect(p.tracks[0].name).toBe("V1");
    expect(p.tracks[1].name).toBe("V2");
  });
});

describe("projectDuration", () => {
  it("uses stored duration when empty", () => {
    expect(contentDuration(createProject())).toBe(0);
    expect(projectDuration(createProject())).toBe(DEFAULT_DURATION);
  });
  it("uses max of content and stored duration", () => {
    const p = createProject();
    p.duration = 3;
    p.tracks[0].clips.push(sampleClip({ timelineStart: 0, sourceIn: 0, sourceOut: 5 }));
    p.tracks[1].clips.push(sampleClip({ id: "c2", timelineStart: 3, sourceIn: 0, sourceOut: 4 }));
    // content ends 7, stored 3 → 7
    expect(contentDuration(p)).toBe(7);
    expect(projectDuration(p)).toBe(7);
  });
  it("can extend past content with setProjectDuration", () => {
    const p = createProject();
    p.tracks[0].clips.push(sampleClip({ timelineStart: 0, sourceIn: 0, sourceOut: 5 }));
    const next = setProjectDuration(p, 20);
    expect(contentDuration(next)).toBe(5);
    expect(projectDuration(next)).toBe(20);
    // Cannot shrink below content
    expect(projectDuration(setProjectDuration(next, 2))).toBe(5);
  });
});

describe("parse/serialize", () => {
  it("round-trips", () => {
    const p = createProject("R");
    p.tracks[0].clips.push(sampleClip());
    const again = parseProject(JSON.parse(serializeProject(p)));
    expect(again.name).toBe("R");
    expect(again.duration).toBe(projectDuration(p));
    expect(again.tracks[0].clips[0].sourcePath).toBe("/tmp/a.mp4");
  });

  it("serialize writes effective duration when content exceeds stored", () => {
    const p = createProject("R");
    p.duration = 2;
    p.tracks[0].clips.push(
      sampleClip({ timelineStart: 0, sourceIn: 0, sourceOut: 20 }),
    );
    const raw = JSON.parse(serializeProject(p));
    expect(raw.duration).toBe(20);
    expect(p.duration).toBe(2); // in-memory stored field unchanged by serialize
  });
  it("defaults missing duration to content length", () => {
    const again = parseProject({
      version: 1,
      name: "old",
      canvas: { width: 100, height: 100 },
      tracks: [
        {
          id: "t1",
          name: "V1",
          clips: [
            {
              id: "c1",
              sourcePath: "/a.mp4",
              sourceIn: 0,
              sourceOut: 4,
              timelineStart: 1,
              transform: { scale: 1, x: 0, y: 0 },
            },
          ],
        },
      ],
    });
    expect(again.duration).toBe(5);
  });
  it("rejects bad version", () => {
    expect(() => parseProject({ version: 99, name: "x", canvas: { width: 1, height: 1 }, tracks: [] })).toThrow();
  });

  it("normalizes odd canvas dimensions to even ≥ 2", () => {
    const again = parseProject({
      version: 1,
      name: "odd",
      canvas: { width: 1921, height: 1081 },
      duration: 1,
      tracks: [],
    });
    expect(again.canvas).toEqual({ width: 1920, height: 1080 });
  });
});

describe("evenCanvasDim", () => {
  it("forces even integers ≥ 2", () => {
    expect(evenCanvasDim(0)).toBe(2);
    expect(evenCanvasDim(1)).toBe(2);
    expect(evenCanvasDim(3)).toBe(2);
    expect(evenCanvasDim(1920)).toBe(1920);
    expect(evenCanvasDim(1921)).toBe(1920);
  });
});

describe("cloneProject", () => {
  it("deep-clones so nested edits do not alias", () => {
    const p = createProject("C");
    p.tracks[0].clips.push(sampleClip());
    const copy = cloneProject(p);
    expect(copy).toEqual(p);
    expect(copy).not.toBe(p);
    expect(copy.tracks).not.toBe(p.tracks);
    expect(copy.tracks[0].clips[0]).not.toBe(p.tracks[0].clips[0]);
    copy.tracks[0].clips[0].timelineStart = 99;
    expect(p.tracks[0].clips[0].timelineStart).toBe(2);
  });
});

describe("snapToFrame", () => {
  it("snaps to project fps grid", () => {
    expect(PROJECT_FPS).toBe(30);
    expect(snapToFrame(0)).toBe(0);
    expect(snapToFrame(1 / 30)).toBeCloseTo(1 / 30, 10);
    expect(snapToFrame(1 / 30 + 0.001)).toBeCloseTo(1 / 30, 10);
    expect(snapToFrame(1)).toBe(1);
  });
});
