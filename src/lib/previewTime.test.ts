import { describe, it, expect } from "vitest";
import { createProject, defaultTransform } from "./project";
import {
  clampSourceSeek,
  clipTimelineEnd,
  firstClipInSequence,
  nextClipAfter,
  shouldPrefetchNearCut,
  sourceTimeAt,
} from "./previewTime";
import type { Clip, SourceMeta } from "./types";

const emptyMeta = new Map<string, SourceMeta>();

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    sourcePath: "/a.mp4",
    sourceIn: 2,
    sourceOut: 10,
    timelineStart: 5,
    transform: defaultTransform(),
    ...over,
  };
}

describe("sourceTimeAt / clipTimelineEnd", () => {
  it("maps timeline into source and reports exclusive end", () => {
    const c = clip();
    expect(sourceTimeAt(c, 5)).toBe(2);
    expect(sourceTimeAt(c, 7)).toBe(4);
    expect(clipTimelineEnd(c)).toBe(13);
  });
});

describe("clampSourceSeek", () => {
  it("clamps into [sourceIn, sourceOut - eps]", () => {
    const c = clip({ sourceIn: 0, sourceOut: 1 });
    expect(clampSourceSeek(c, -1, 1 / 30)).toBe(0);
    expect(clampSourceSeek(c, 0.99, 1 / 30)).toBeCloseTo(1 - 1 / 30, 10);
    expect(clampSourceSeek(c, 0.5, 1 / 30)).toBe(0.5);
  });
});

describe("nextClipAfter", () => {
  it("finds the next media clip after a black gap", () => {
    const p = createProject();
    const a = clip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 2 });
    const b = clip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 2 });
    p.tracks[0].clips.push(a, b);
    expect(nextClipAfter(p, a, emptyMeta)?.id).toBe("b");
  });

  it("returns null when nothing follows", () => {
    const p = createProject();
    const a = clip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 2 });
    p.tracks[0].clips.push(a);
    expect(nextClipAfter(p, a, emptyMeta)).toBeNull();
  });

  it("skips audio-only beds when finding the next video clip", () => {
    const p = createProject();
    const a = clip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 2 });
    const bed = clip({
      id: "bed",
      sourcePath: "/bed.m4a",
      timelineStart: 2,
      sourceIn: 0,
      sourceOut: 10,
    });
    const b = clip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 2 });
    p.tracks[0].clips.push(a, b);
    p.tracks[1].clips.push(bed);
    const meta = new Map<string, SourceMeta>([
      ["/bed.m4a", { path: "/bed.m4a", duration: 10, width: 0, height: 0, hasAudio: true }],
    ]);
    expect(nextClipAfter(p, a, meta)?.id).toBe("b");
  });
});

describe("firstClipInSequence", () => {
  it("returns null for an empty project", () => {
    expect(firstClipInSequence(createProject(), emptyMeta)).toBeNull();
  });

  it("returns the clip at time 0", () => {
    const p = createProject();
    const a = clip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 2 });
    p.tracks[0].clips.push(a);
    expect(firstClipInSequence(p, emptyMeta)?.id).toBe("a");
  });

  it("skips a leading black gap", () => {
    const p = createProject();
    const a = clip({ id: "a", timelineStart: 3, sourceIn: 0, sourceOut: 2 });
    p.tracks[0].clips.push(a);
    expect(firstClipInSequence(p, emptyMeta)?.id).toBe("a");
  });

  it("prefers the higher track when both cover the start", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "lo", timelineStart: 0, sourceIn: 0, sourceOut: 4 }));
    p.tracks[1].clips.push(clip({ id: "hi", timelineStart: 0, sourceIn: 0, sourceOut: 4 }));
    expect(firstClipInSequence(p, emptyMeta)?.id).toBe("hi");
  });

  it("returns the earliest clip when clips start at different times", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "late", timelineStart: 5, sourceIn: 0, sourceOut: 2 }));
    p.tracks[0].clips.push(clip({ id: "early", timelineStart: 1, sourceIn: 0, sourceOut: 2 }));
    expect(firstClipInSequence(p, emptyMeta)?.id).toBe("early");
  });

  it("skips a leading audio-only bed", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      clip({
        id: "bed",
        sourcePath: "/bed.m4a",
        timelineStart: 0,
        sourceIn: 0,
        sourceOut: 10,
      }),
    );
    p.tracks[1].clips.push(clip({ id: "vid", timelineStart: 2, sourceIn: 0, sourceOut: 3 }));
    const meta = new Map<string, SourceMeta>([
      ["/bed.m4a", { path: "/bed.m4a", duration: 10, width: 0, height: 0, hasAudio: true }],
    ]);
    expect(firstClipInSequence(p, meta)?.id).toBe("vid");
  });
});

describe("shouldPrefetchNearCut", () => {
  it("is true inside lead window", () => {
    expect(shouldPrefetchNearCut(10, 9.2, 0.85)).toBe(true);
    expect(shouldPrefetchNearCut(10, 5, 0.85)).toBe(false);
  });
});
