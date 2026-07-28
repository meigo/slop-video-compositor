import { describe, it, expect } from "vitest";
import { createProject, defaultTransform } from "./project";
import { cutPoints, nextCut, prevCut } from "./cuts";

describe("cuts", () => {
  it("navigates prev/next cut points", () => {
    const p = createProject();
    p.duration = 20;
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 5,
      timelineStart: 2,
      transform: defaultTransform(),
    });
    expect(cutPoints(p)).toEqual([0, 2, 7, 20]);
    expect(prevCut(p, 5)).toBe(2);
    expect(nextCut(p, 5)).toBe(7);
    expect(prevCut(p, 0)).toBe(0);
    expect(nextCut(p, 20)).toBe(20);
  });
});
