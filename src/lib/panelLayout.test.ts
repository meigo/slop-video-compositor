import { describe, it, expect } from "vitest";
import {
  DEFAULT_INSPECTOR_WIDTH,
  MIN_INSPECTOR_WIDTH,
  clampInspectorWidth,
  resizedInspectorWidth,
} from "./panelLayout";

describe("clampInspectorWidth", () => {
  it("keeps a sensible width untouched", () => {
    expect(clampInspectorWidth(320, 1440)).toBe(320);
  });

  it("floors at the minimum", () => {
    expect(clampInspectorWidth(10, 1440)).toBe(MIN_INSPECTOR_WIDTH);
    expect(clampInspectorWidth(-500, 1440)).toBe(MIN_INSPECTOR_WIDTH);
  });

  it("caps at half the viewport", () => {
    expect(clampInspectorWidth(2000, 1440)).toBe(720);
  });

  it("lets the minimum win on a viewport too narrow for it", () => {
    // Half of 300 is 150, below the minimum — the panel stays usable rather than collapsing.
    expect(clampInspectorWidth(400, 300)).toBe(MIN_INSPECTOR_WIDTH);
    expect(clampInspectorWidth(10, 300)).toBe(MIN_INSPECTOR_WIDTH);
  });

  it("rounds to whole pixels and rejects rubbish", () => {
    expect(clampInspectorWidth(320.4, 1440)).toBe(320);
    expect(clampInspectorWidth(Number.NaN, 1440)).toBe(DEFAULT_INSPECTOR_WIDTH);
    expect(clampInspectorWidth(Number.POSITIVE_INFINITY, 1440)).toBe(720);
  });
});

describe("resizedInspectorWidth", () => {
  it("grows as the pointer moves left, because the panel is docked right", () => {
    expect(resizedInspectorWidth(320, 1000, 940, 1440)).toBe(380);
  });

  it("shrinks as the pointer moves right", () => {
    expect(resizedInspectorWidth(320, 1000, 1040, 1440)).toBe(280);
  });

  it("is computed from the press, not accumulated, so it is drift-free", () => {
    const a = resizedInspectorWidth(320, 1000, 900, 1440);
    const b = resizedInspectorWidth(320, 1000, 950, 1440);
    const c = resizedInspectorWidth(320, 1000, 900, 1440);
    expect(a).toBe(420);
    expect(b).toBe(370);
    expect(c).toBe(a);
  });

  it("clamps at both ends of a drag", () => {
    expect(resizedInspectorWidth(320, 1000, 3000, 1440)).toBe(MIN_INSPECTOR_WIDTH);
    expect(resizedInspectorWidth(320, 1000, -3000, 1440)).toBe(720);
  });
});
