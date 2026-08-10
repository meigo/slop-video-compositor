import { describe, it, expect } from "vitest";
import {
  effectivePlayBounds,
  hasExplicitPlayRange,
  normalizePlayRange,
} from "./playRange";

describe("normalizePlayRange", () => {
  it("orders and clamps into the sequence", () => {
    expect(normalizePlayRange(8, 2, 10)).toEqual({ start: 2, end: 8 });
    expect(normalizePlayRange(-1, 20, 10)).toEqual({ start: 0, end: 10 });
  });

  it("enforces a minimum length", () => {
    const r = normalizePlayRange(5, 5, 10, 0.1);
    expect(r.end - r.start).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });
});

describe("effectivePlayBounds", () => {
  it("defaults to the full sequence", () => {
    expect(effectivePlayBounds(null, null, 12)).toEqual({ start: 0, end: 12 });
  });

  it("uses only in or only out when one side is set", () => {
    expect(effectivePlayBounds(3, null, 12)).toEqual({ start: 3, end: 12 });
    expect(effectivePlayBounds(null, 7, 12)).toEqual({ start: 0, end: 7 });
  });

  it("normalizes when both are set", () => {
    expect(effectivePlayBounds(9, 4, 12)).toEqual({ start: 4, end: 9 });
  });
});

describe("hasExplicitPlayRange", () => {
  it("is true when either end is set", () => {
    expect(hasExplicitPlayRange(null, null)).toBe(false);
    expect(hasExplicitPlayRange(1, null)).toBe(true);
    expect(hasExplicitPlayRange(null, 2)).toBe(true);
  });
});
