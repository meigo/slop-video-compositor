import { describe, it, expect } from "vitest";
import { drawRect } from "./transform";

describe("drawRect", () => {
  it("contain-fits 1920x1080 into same canvas at identity", () => {
    const r = drawRect(1920, 1080, 1920, 1080, { scale: 1, x: 0, y: 0 });
    expect(r).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
  it("letterboxes wide canvas for square source", () => {
    const r = drawRect(100, 100, 200, 100, { scale: 1, x: 0, y: 0 });
    // fitScale = min(2, 1) = 1 → 100x100 centered → x=50
    expect(r.w).toBe(100);
    expect(r.h).toBe(100);
    expect(r.x).toBe(50);
    expect(r.y).toBe(0);
  });
  it("applies scale and pan", () => {
    const r = drawRect(100, 100, 200, 100, { scale: 2, x: 10, y: -5 });
    expect(r.w).toBe(200);
    expect(r.h).toBe(200);
    expect(r.x).toBe(50 + 10); // center base 50 + pan
    expect(r.y).toBe(0 - 5);
  });
});
