import { describe, it, expect } from "vitest";
import {
  CLIP_VERTICAL_INSET,
  DEFAULT_TRACK_ROW_SIZE,
  isTrackRowSize,
  trackRowMetrics,
} from "./trackRow";

describe("trackRowMetrics", () => {
  it("filmstrip height is track height minus clip inset", () => {
    for (const size of ["s", "m", "l"] as const) {
      const m = trackRowMetrics(size);
      expect(m.filmstripH).toBe(m.trackH - CLIP_VERTICAL_INSET);
      expect(m.trackH).toBeGreaterThan(m.filmstripH);
    }
  });

  it("defaults to medium", () => {
    expect(DEFAULT_TRACK_ROW_SIZE).toBe("m");
    expect(trackRowMetrics("m").label).toBe("M");
  });
});

describe("isTrackRowSize", () => {
  it("accepts s/m/l only", () => {
    expect(isTrackRowSize("s")).toBe(true);
    expect(isTrackRowSize("x")).toBe(false);
    expect(isTrackRowSize(null)).toBe(false);
  });
});
