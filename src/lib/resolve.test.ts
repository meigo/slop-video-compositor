import { describe, it, expect } from "vitest";
import { createProject, defaultTransform } from "./project";
import { clipAtTime } from "./resolve";
import type { Clip } from "./types";

function clip(p: Partial<Clip> & Pick<Clip, "id" | "timelineStart" | "sourceIn" | "sourceOut">): Clip {
  return {
    sourcePath: "/a.mp4",
    transform: defaultTransform(),
    ...p,
  };
}

describe("clipAtTime", () => {
  it("returns null on empty", () => {
    expect(clipAtTime(createProject(), 0)).toBeNull();
  });
  it("higher track wins on overlap", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "low", timelineStart: 0, sourceIn: 0, sourceOut: 10 }));
    p.tracks[1].clips.push(clip({ id: "high", timelineStart: 2, sourceIn: 0, sourceOut: 4 }));
    expect(clipAtTime(p, 1)?.clip.id).toBe("low");
    expect(clipAtTime(p, 3)?.clip.id).toBe("high");
    expect(clipAtTime(p, 7)?.clip.id).toBe("low");
  });
  it("gap returns null", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 2 }));
    p.tracks[0].clips.push(clip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 2 }));
    expect(clipAtTime(p, 3)).toBeNull();
  });
});
