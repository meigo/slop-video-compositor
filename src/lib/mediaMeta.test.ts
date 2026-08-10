import { describe, it, expect } from "vitest";
import { isAudioOnlyMeta, toSourceMeta } from "./tauri";

describe("isAudioOnlyMeta", () => {
  it("is true when width or height is zero", () => {
    expect(isAudioOnlyMeta({ width: 0, height: 0 })).toBe(true);
    expect(isAudioOnlyMeta({ width: 0, height: 1080 })).toBe(true);
    expect(isAudioOnlyMeta({ width: 1920, height: 0 })).toBe(true);
  });

  it("is false for video dimensions or missing meta", () => {
    expect(isAudioOnlyMeta({ width: 1920, height: 1080 })).toBe(false);
    expect(isAudioOnlyMeta(null)).toBe(false);
    expect(isAudioOnlyMeta(undefined)).toBe(false);
  });
});

describe("toSourceMeta", () => {
  it("maps snake_case probe fields including zero size audio", () => {
    expect(
      toSourceMeta("/a.wav", {
        duration: 12.5,
        width: 0,
        height: 0,
        has_audio: true,
      }),
    ).toEqual({
      path: "/a.wav",
      duration: 12.5,
      width: 0,
      height: 0,
      hasAudio: true,
    });
  });
});
