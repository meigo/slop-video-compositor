import { describe, it, expect } from "vitest";
import { createProject, defaultTransform, clipDuration, projectDuration } from "./project";
import type { Clip } from "./types";
import {
  findClip,
  moveClip,
  trimClipIn,
  trimClipOut,
  splitClip,
  deleteClip,
  addClip,
  addTrack,
  clampClipSourceToMedia,
  clampProjectSourcesToMedia,
  overwriteWithClip,
} from "./clips";

function sampleClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    sourcePath: "/tmp/a.mp4",
    sourceIn: 0,
    sourceOut: 10,
    timelineStart: 5,
    transform: defaultTransform(),
    ...over,
  };
}

function projectWithClip(clip: Clip = sampleClip(), trackIndex = 0) {
  const p = createProject("Edit");
  p.tracks[trackIndex].clips.push(clip);
  return p;
}

describe("findClip", () => {
  it("returns track/clip indices and clip", () => {
    const p = projectWithClip();
    const found = findClip(p, "c1");
    expect(found).not.toBeNull();
    expect(found!.trackIndex).toBe(0);
    expect(found!.clipIndex).toBe(0);
    expect(found!.clip.id).toBe("c1");
  });

  it("returns null when missing", () => {
    expect(findClip(createProject(), "nope")).toBeNull();
  });
});

describe("overwriteWithClip", () => {
  it("trims a left neighbor that overlaps the winner", () => {
    const p = createProject();
    // A: 0..10 on timeline, B: 5..15 — B wins → A becomes 0..5
    p.tracks[0].clips.push(
      sampleClip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 10 }),
      sampleClip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 10 }),
    );
    const next = overwriteWithClip(p, "b");
    const a = next.tracks[0].clips.find((c) => c.id === "a")!;
    const b = next.tracks[0].clips.find((c) => c.id === "b")!;
    expect(a.sourceOut).toBe(5);
    expect(a.timelineStart + clipDuration(a)).toBe(5);
    expect(b.timelineStart).toBe(5);
    expect(clipDuration(b)).toBe(10);
  });

  it("trims a right neighbor that overlaps the winner", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      sampleClip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 10 }),
      sampleClip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 10 }),
    );
    const next = overwriteWithClip(p, "a");
    const a = next.tracks[0].clips.find((c) => c.id === "a")!;
    const b = next.tracks[0].clips.find((c) => c.id === "b")!;
    expect(a.timelineStart).toBe(0);
    expect(clipDuration(a)).toBe(10);
    expect(b.timelineStart).toBe(10);
    expect(b.sourceIn).toBe(5);
    expect(b.sourceOut).toBe(10);
  });

  it("splits a neighbor that fully covers the winner", () => {
    const p = createProject();
    // Long A 0..20, short B dropped on top 5..10
    p.tracks[0].clips.push(
      sampleClip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 20 }),
      sampleClip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 5 }),
    );
    const next = overwriteWithClip(p, "b");
    const clips = next.tracks[0].clips;
    const b = clips.find((c) => c.id === "b")!;
    const left = clips.find((c) => c.id === "a")!;
    const right = clips.find((c) => c.id !== "a" && c.id !== "b")!;
    expect(clips).toHaveLength(3);
    expect(left.sourceOut).toBe(5);
    expect(left.timelineStart + clipDuration(left)).toBe(5);
    expect(b.timelineStart).toBe(5);
    expect(clipDuration(b)).toBe(5);
    expect(right.timelineStart).toBe(10);
    expect(right.sourceIn).toBe(10);
    expect(right.sourceOut).toBe(20);
  });

  it("deletes a neighbor fully covered by the winner", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      sampleClip({ id: "big", timelineStart: 0, sourceIn: 0, sourceOut: 20 }),
      sampleClip({ id: "small", timelineStart: 5, sourceIn: 0, sourceOut: 3 }),
    );
    const next = overwriteWithClip(p, "big");
    expect(next.tracks[0].clips.map((c) => c.id)).toEqual(["big"]);
  });

  it("does not touch other tracks", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      sampleClip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 10 }),
      sampleClip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 10 }),
    );
    p.tracks[1].clips.push(
      sampleClip({ id: "hi", timelineStart: 0, sourceIn: 0, sourceOut: 20 }),
    );
    const next = overwriteWithClip(p, "b");
    expect(next.tracks[1].clips[0]).toEqual(p.tracks[1].clips[0]);
    expect(next.tracks[0].clips.find((c) => c.id === "a")!.sourceOut).toBe(5);
  });

  it("allows abutting clips (no false overlap)", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      sampleClip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 5 }),
      sampleClip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 5 }),
    );
    const next = overwriteWithClip(p, "b");
    expect(next).toBe(p);
  });
});

describe("moveClip", () => {
  it("updates timelineStart on same track", () => {
    const p = projectWithClip();
    const next = moveClip(p, "c1", 12);
    expect(next.tracks[0].clips[0].timelineStart).toBe(12);
    expect(next).not.toBe(p);
    expect(p.tracks[0].clips[0].timelineStart).toBe(5);
  });

  it("overwrites neighbors when drag creates overlap", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      sampleClip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 10 }),
      sampleClip({ id: "b", timelineStart: 20, sourceIn: 0, sourceOut: 5 }),
    );
    // Drag b onto a (starts at 5)
    const next = moveClip(p, "b", 5);
    const a = next.tracks[0].clips.find((c) => c.id === "a")!;
    const b = next.tracks[0].clips.find((c) => c.id === "b")!;
    expect(b.timelineStart).toBe(5);
    expect(a.timelineStart + clipDuration(a)).toBe(5);
    expect(a.sourceOut).toBe(5);
  });

  it("moves clip to another track and overwrites there", () => {
    const p = projectWithClip(
      sampleClip({ id: "c1", timelineStart: 0, sourceIn: 0, sourceOut: 10 }),
    );
    p.tracks[1].clips.push(
      sampleClip({ id: "other", timelineStart: 0, sourceIn: 0, sourceOut: 8 }),
    );
    const toId = p.tracks[1].id;
    const next = moveClip(p, "c1", 2, toId);
    expect(next.tracks[0].clips).toHaveLength(0);
    expect(next.tracks[1].clips.find((c) => c.id === "c1")!.timelineStart).toBe(2);
    const other = next.tracks[1].clips.find((c) => c.id === "other")!;
    // other 0..8, c1 2..12 → other trimmed to 0..2
    expect(other.sourceOut).toBe(2);
  });

  it("is no-op for missing clip", () => {
    const p = createProject();
    expect(moveClip(p, "missing", 0)).toBe(p);
  });

  it("is no-op when toTrackId is missing", () => {
    const p = projectWithClip();
    const next = moveClip(p, "c1", 9, "no-such-track");
    expect(next).toBe(p);
  });
});

describe("trimClipIn", () => {
  it("left-trims and advances timelineStart (NLE-style)", () => {
    // sourceIn=0, sourceOut=10, timelineStart=5 → visual end = 15
    const p = projectWithClip();
    const next = trimClipIn(p, "c1", 2);
    const c = next.tracks[0].clips[0];
    expect(c.sourceIn).toBe(2);
    expect(c.sourceOut).toBe(10);
    expect(c.timelineStart).toBe(7); // 5 + (2 - 0)
    expect(clipDuration(c)).toBe(8);
    // right edge stable: 7 + 8 = 15
    expect(c.timelineStart + clipDuration(c)).toBe(15);
  });

  it("clamps newSourceIn lower bound to 0", () => {
    const p = projectWithClip(sampleClip({ sourceIn: 2, sourceOut: 8, timelineStart: 0 }));
    const neg = trimClipIn(p, "c1", -5);
    expect(neg.tracks[0].clips[0].sourceIn).toBe(0);
    expect(neg.tracks[0].clips[0].timelineStart).toBe(-2); // 0 + (0 - 2)
  });

  it("is no-op when newSourceIn would not be strictly less than sourceOut", () => {
    const p = projectWithClip(sampleClip({ sourceIn: 2, sourceOut: 8, timelineStart: 0 }));
    expect(trimClipIn(p, "c1", 8)).toBe(p);
    expect(trimClipIn(p, "c1", 10)).toBe(p);
  });

  it("is no-op for missing clip", () => {
    const p = createProject();
    expect(trimClipIn(p, "x", 1)).toBe(p);
  });
});

describe("trimClipOut", () => {
  it("right-trims without moving timelineStart", () => {
    const p = projectWithClip();
    const next = trimClipOut(p, "c1", 6);
    const c = next.tracks[0].clips[0];
    expect(c.sourceOut).toBe(6);
    expect(c.sourceIn).toBe(0);
    expect(c.timelineStart).toBe(5);
    expect(clipDuration(c)).toBe(6);
  });

  it("is no-op when newSourceOut <= sourceIn", () => {
    const p = projectWithClip(sampleClip({ sourceIn: 2, sourceOut: 8 }));
    expect(trimClipOut(p, "c1", 2)).toBe(p);
    expect(trimClipOut(p, "c1", 1)).toBe(p);
  });

  it("is no-op for missing clip", () => {
    const p = createProject();
    expect(trimClipOut(p, "x", 5)).toBe(p);
  });
});

describe("splitClip", () => {
  it("produces two clips covering the same timeline range", () => {
    // source 0..10 on timeline 5..15; split at t=9 → local=4
    const p = projectWithClip();
    const next = splitClip(p, "c1", 9);
    const clips = next.tracks[0].clips;
    expect(clips).toHaveLength(2);

    const left = clips[0];
    const right = clips[1];
    expect(left.id).toBe("c1");
    expect(right.id).not.toBe("c1");
    expect(left.sourcePath).toBe(right.sourcePath);
    expect(left.transform).toEqual(right.transform);

    expect(left.sourceIn).toBe(0);
    expect(left.sourceOut).toBe(4); // sourceIn + local
    expect(left.timelineStart).toBe(5);

    expect(right.sourceIn).toBe(4);
    expect(right.sourceOut).toBe(10);
    expect(right.timelineStart).toBe(9);

    // same coverage
    expect(left.timelineStart + clipDuration(left)).toBe(right.timelineStart);
    expect(right.timelineStart + clipDuration(right)).toBe(15);
    expect(clipDuration(left) + clipDuration(right)).toBe(10);
  });

  it("is no-op when t is at start or end or outside", () => {
    const p = projectWithClip(); // 5..15
    expect(splitClip(p, "c1", 5)).toBe(p);
    expect(splitClip(p, "c1", 15)).toBe(p);
    expect(splitClip(p, "c1", 0)).toBe(p);
    expect(splitClip(p, "c1", 20)).toBe(p);
  });

  it("is no-op for missing clip", () => {
    const p = createProject();
    expect(splitClip(p, "x", 1)).toBe(p);
  });
});

describe("deleteClip", () => {
  it("removes clip and leaves gap (does not close neighbors)", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      sampleClip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 5 }),
      sampleClip({ id: "b", timelineStart: 10, sourceIn: 0, sourceOut: 3 }),
    );
    const next = deleteClip(p, "a");
    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[0].clips[0].id).toBe("b");
    expect(next.tracks[0].clips[0].timelineStart).toBe(10); // gap left
  });

  it("leaves stored sequence duration when deleting the last clip", () => {
    const p = projectWithClip(sampleClip({ timelineStart: 0, sourceIn: 0, sourceOut: 5 }));
    p.duration = 5;
    expect(projectDuration(p)).toBe(5);
    const next = deleteClip(p, "c1");
    expect(next.tracks[0].clips).toHaveLength(0);
    // Stored length is kept; user can shrink via the sequence-length handle
    expect(next.duration).toBe(5);
    expect(projectDuration(next)).toBe(5);
  });

  it("is no-op for missing clip", () => {
    const p = createProject();
    expect(deleteClip(p, "x")).toBe(p);
  });
});

describe("addClip", () => {
  it("appends clip to the given track", () => {
    const p = createProject();
    const trackId = p.tracks[1].id;
    const clip = sampleClip({ id: "new" });
    const next = addClip(p, trackId, clip);
    expect(next.tracks[1].clips).toHaveLength(1);
    expect(next.tracks[1].clips[0].id).toBe("new");
    expect(next.tracks[0].clips).toHaveLength(0);
    expect(p.tracks[1].clips).toHaveLength(0);
  });

  it("is no-op for missing track", () => {
    const p = createProject();
    expect(addClip(p, "missing", sampleClip())).toBe(p);
  });
});

describe("addTrack", () => {
  it("appends a higher track to tracks array", () => {
    const p = createProject();
    expect(p.tracks).toHaveLength(2);
    const next = addTrack(p, "V3");
    expect(next.tracks).toHaveLength(3);
    expect(next.tracks[2].name).toBe("V3");
    expect(next.tracks[2].clips).toEqual([]);
    expect(next.tracks[2].id).toBeTruthy();
    expect(p.tracks).toHaveLength(2);
  });

  it("defaults name when omitted", () => {
    const p = createProject();
    const next = addTrack(p);
    expect(next.tracks[2].name).toMatch(/^V\d+$/);
  });
});

describe("clampClipSourceToMedia", () => {
  it("returns same clip when already in range", () => {
    const clip = sampleClip({ sourceIn: 1, sourceOut: 5 });
    expect(clampClipSourceToMedia(clip, 10)).toBe(clip);
  });

  it("clamps out-of-range ends and negative in", () => {
    const clip = sampleClip({ sourceIn: -1, sourceOut: 20 });
    const next = clampClipSourceToMedia(clip, 10);
    expect(next).toEqual({ ...clip, sourceIn: 0, sourceOut: 10 });
  });

  it("returns null when range is entirely past EOF", () => {
    const clip = sampleClip({ sourceIn: 12, sourceOut: 15 });
    expect(clampClipSourceToMedia(clip, 10)).toBeNull();
  });
});

describe("clampProjectSourcesToMedia", () => {
  it("clamps and reports invalid ids", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      sampleClip({ id: "ok", sourceIn: 0, sourceOut: 12, sourcePath: "/a.mp4" }),
      sampleClip({ id: "bad", sourceIn: 20, sourceOut: 25, sourcePath: "/a.mp4" }),
    );
    const meta = new Map([["/a.mp4", { duration: 10 }]]);
    const result = clampProjectSourcesToMedia(p, meta);
    expect(result.changed).toBe(true);
    expect(result.invalidIds).toEqual(["bad"]);
    expect(result.project.tracks[0].clips[0].sourceOut).toBe(10);
    expect(result.project.tracks[0].clips[1].sourceIn).toBe(20);
  });
});
