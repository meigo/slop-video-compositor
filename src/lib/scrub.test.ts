import { describe, it, expect } from "vitest";
import { SCRUB_THRESHOLD_PX, scrubbedValue } from "./scrub";

describe("scrubbedValue", () => {
  it("moves one step per pixel to the right", () => {
    expect(scrubbedValue({ startValue: 1, dx: 10, step: 0.01 })).toBeCloseTo(1.1, 10);
  });

  it("moves down when dragged left", () => {
    expect(scrubbedValue({ startValue: 1, dx: -25, step: 0.01 })).toBeCloseTo(0.75, 10);
  });

  it("takes a tenth of a step per pixel when fine", () => {
    expect(scrubbedValue({ startValue: 1, dx: 10, step: 0.01, fine: true })).toBeCloseTo(1.01, 10);
  });

  it("clamps to min and max", () => {
    expect(scrubbedValue({ startValue: 1, dx: -1000, step: 0.01, min: 0 })).toBe(0);
    expect(scrubbedValue({ startValue: 1, dx: 1000, step: 0.05, max: 8 })).toBe(8);
  });

  it("is unbounded when no min or max is given", () => {
    expect(scrubbedValue({ startValue: 0, dx: -500, step: 1 })).toBe(-500);
  });

  it("is computed from the press, so repeating a dx repeats the value", () => {
    const a = scrubbedValue({ startValue: 2, dx: 40, step: 0.01 });
    scrubbedValue({ startValue: 2, dx: 90, step: 0.01 });
    expect(scrubbedValue({ startValue: 2, dx: 40, step: 0.01 })).toBe(a);
  });

  it("returns the start value for a non-finite delta rather than NaN", () => {
    expect(scrubbedValue({ startValue: 3, dx: Number.NaN, step: 0.01 })).toBe(3);
  });

  it("exposes a travel threshold, so a press that does not move stays a click", () => {
    expect(SCRUB_THRESHOLD_PX).toBeGreaterThan(0);
  });
});
