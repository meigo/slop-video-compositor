import { describe, it, expect } from "vitest";
import { createProject, defaultTransform } from "./project";
import { audioBedAtTime, clipAtTime, videoClipAtTime } from "./resolve";
import type { Clip, SourceMeta } from "./types";

function clip(p: Partial<Clip> & Pick<Clip, "id" | "timelineStart" | "sourceIn" | "sourceOut">): Clip {
  return {
    sourcePath: "/a.mp4",
    transform: defaultTransform(),
    ...p,
  };
}

const videoMeta = new Map<string, SourceMeta>([
  ["/a.mp4", { path: "/a.mp4", duration: 100, width: 1920, height: 1080, hasAudio: true }],
  ["/bed.m4a", { path: "/bed.m4a", duration: 100, width: 0, height: 0, hasAudio: true }],
]);

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

describe("videoClipAtTime / audioBedAtTime", () => {
  it("video under audio bed still wins picture; bed resolves separately", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      clip({ id: "vid", timelineStart: 0, sourceIn: 0, sourceOut: 10, sourcePath: "/a.mp4" }),
    );
    p.tracks[1].clips.push(
      clip({ id: "bed", timelineStart: 0, sourceIn: 0, sourceOut: 10, sourcePath: "/bed.m4a" }),
    );
    expect(videoClipAtTime(p, 3, videoMeta)?.clip.id).toBe("vid");
    expect(audioBedAtTime(p, 3, videoMeta)?.clip.id).toBe("bed");
    // Raw hard-cut still picks the top track (legacy)
    expect(clipAtTime(p, 3)?.clip.id).toBe("bed");
  });

  it("bed under video still plays as bed", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      clip({ id: "bed", timelineStart: 0, sourceIn: 0, sourceOut: 10, sourcePath: "/bed.m4a" }),
    );
    p.tracks[1].clips.push(
      clip({ id: "vid", timelineStart: 0, sourceIn: 0, sourceOut: 10, sourcePath: "/a.mp4" }),
    );
    expect(videoClipAtTime(p, 3, videoMeta)?.clip.id).toBe("vid");
    expect(audioBedAtTime(p, 3, videoMeta)?.clip.id).toBe("bed");
  });

  it("muted bed is ignored", () => {
    const p = createProject();
    p.tracks[0].clips.push(
      clip({
        id: "bed",
        timelineStart: 0,
        sourceIn: 0,
        sourceOut: 10,
        sourcePath: "/bed.m4a",
        muted: true,
      }),
    );
    expect(audioBedAtTime(p, 3, videoMeta)).toBeNull();
  });
});
