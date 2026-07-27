import { describe, it, expect } from "vitest";
import {
  createProject,
  projectDuration,
  clipDuration,
  parseProject,
  serializeProject,
  defaultTransform,
  cloneProject,
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
  it("starts with two tracks and default canvas", () => {
    const p = createProject("Test");
    expect(p.version).toBe(1);
    expect(p.canvas).toEqual({ width: 1920, height: 1080 });
    expect(p.tracks).toHaveLength(2);
    expect(p.tracks[0].name).toBe("V1");
    expect(p.tracks[1].name).toBe("V2");
  });
});

describe("projectDuration", () => {
  it("is 0 when empty", () => {
    expect(projectDuration(createProject())).toBe(0);
  });
  it("uses max timeline end", () => {
    const p = createProject();
    p.tracks[0].clips.push(sampleClip({ timelineStart: 0, sourceIn: 0, sourceOut: 5 }));
    p.tracks[1].clips.push(sampleClip({ id: "c2", timelineStart: 3, sourceIn: 0, sourceOut: 4 }));
    // c1 ends 5, c2 ends 7
    expect(projectDuration(p)).toBe(7);
  });
});

describe("parse/serialize", () => {
  it("round-trips", () => {
    const p = createProject("R");
    p.tracks[0].clips.push(sampleClip());
    const again = parseProject(JSON.parse(serializeProject(p)));
    expect(again.name).toBe("R");
    expect(again.tracks[0].clips[0].sourcePath).toBe("/tmp/a.mp4");
  });
  it("rejects bad version", () => {
    expect(() => parseProject({ version: 99, name: "x", canvas: { width: 1, height: 1 }, tracks: [] })).toThrow();
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
