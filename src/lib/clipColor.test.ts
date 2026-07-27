import { describe, it, expect } from "vitest";
import {
  clipColorForPath,
  clipColorCssVars,
  hashString,
  normalizePathKey,
} from "./clipColor";

describe("clipColorForPath", () => {
  it("is stable for the same path", () => {
    expect(clipColorForPath("/Movies/a.mp4")).toEqual(clipColorForPath("/Movies/a.mp4"));
  });

  it("differs for different files (usually)", () => {
    const a = clipColorForPath("/Movies/shot-a.mp4");
    const b = clipColorForPath("/Movies/shot-b.mp4");
    const c = clipColorForPath("/Movies/other/clip.mp4");
    // At least two distinct among three unrelated names
    const keys = new Set([`${a.h},${a.s}`, `${b.h},${b.s}`, `${c.h},${c.s}`]);
    expect(keys.size).toBeGreaterThanOrEqual(2);
  });

  it("treats backslash and slash paths the same", () => {
    expect(clipColorForPath(String.raw`C:\clips\x.mp4`)).toEqual(
      clipColorForPath("C:/clips/x.mp4"),
    );
  });
});

describe("helpers", () => {
  it("hashString is deterministic", () => {
    expect(hashString("foo")).toBe(hashString("foo"));
    expect(hashString("foo")).not.toBe(hashString("bar"));
  });

  it("normalizePathKey unifies separators", () => {
    expect(normalizePathKey(String.raw`a\b\c`)).toBe("a/b/c");
  });

  it("clipColorCssVars emits custom properties", () => {
    const css = clipColorCssVars("/a.mp4");
    expect(css).toMatch(/--clip-h:\d+/);
    expect(css).toMatch(/--clip-s:\d+/);
    expect(css).toMatch(/--clip-l:\d+/);
  });
});
