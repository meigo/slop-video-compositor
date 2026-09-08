import { describe, it, expect } from "vitest";
import {
  draggedPlayRange,
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

describe("draggedPlayRange", () => {
  it("moves the dragged in point and leaves out alone", () => {
    expect(draggedPlayRange("in", 2, 1, 8, 20)).toEqual({ playIn: 2, playOut: 8 });
  });

  it("moves the dragged out point and leaves in alone", () => {
    expect(draggedPlayRange("out", 9, 1, 8, 20)).toEqual({ playIn: 1, playOut: 9 });
  });

  it("stops the in point short of out rather than swapping the handles", () => {
    // Dragging in past out must not flip which handle is under the cursor.
    const r = draggedPlayRange("in", 12, 1, 8, 20);
    expect(r.playOut).toBe(8);
    expect(r.playIn).toBeCloseTo(8 - 1 / 30, 6);
  });

  it("stops the out point short of in rather than swapping the handles", () => {
    const r = draggedPlayRange("out", 0, 5, 8, 20);
    expect(r.playIn).toBe(5);
    expect(r.playOut).toBeCloseTo(5 + 1 / 30, 6);
  });

  it("clamps the in point at the sequence start", () => {
    expect(draggedPlayRange("in", -4, 1, 8, 20).playIn).toBe(0);
  });

  it("clamps the out point at the sequence end", () => {
    expect(draggedPlayRange("out", 99, 1, 8, 20).playOut).toBe(20);
  });

  it("clamps against the sequence end when the other edge is unset", () => {
    const r = draggedPlayRange("in", 99, 1, null, 20);
    expect(r.playOut).toBeNull();
    expect(r.playIn).toBeCloseTo(20 - 1 / 30, 6);
  });

  it("clamps against the sequence start when in is unset", () => {
    const r = draggedPlayRange("out", -5, null, 8, 20);
    expect(r.playIn).toBeNull();
    expect(r.playOut).toBeCloseTo(1 / 30, 6);
  });
});
