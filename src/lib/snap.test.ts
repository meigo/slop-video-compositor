import { describe, it, expect } from "vitest";
import { createProject, defaultTransform } from "./project";
import { collectSnapTimes, snapClipStart, snapTime } from "./snap";

describe("snapTime", () => {
  it("snaps within threshold", () => {
    expect(snapTime(1.05, [0, 1, 2], 0.12)).toBe(1);
    expect(snapTime(1.2, [0, 1, 2], 0.12)).toBe(1.2);
  });
});

describe("snapClipStart", () => {
  it("prefers nearer edge", () => {
    // Clip length 2; start 0.9 → left edge nearer to 1 than right (2.9) to 2
    expect(snapClipStart(0.9, 2, [1, 5], 0.2)).toBe(1);
    // start 3.1, end 5.1 → right snaps to 5 → start 3
    expect(snapClipStart(3.1, 2, [1, 5], 0.2)).toBeCloseTo(3, 5);
  });
});

describe("collectSnapTimes", () => {
  it("includes ends and playhead, excludes self", () => {
    const p = createProject();
    p.duration = 10;
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 3,
      timelineStart: 2,
      transform: defaultTransform(),
    });
    const times = collectSnapTimes(p, { excludeClipId: "a", playhead: 4 });
    expect(times).toContain(0);
    expect(times).toContain(10);
    expect(times).toContain(4);
    expect(times).not.toContain(2);
    expect(times).not.toContain(5);
  });
});
