import { describe, it, expect } from "vitest";
import {
  WAVEFORM_MAX_WIDTH,
  WAVEFORM_MIN_WIDTH,
  waveformCacheKey,
  waveformNativeWidth,
  waveformTrimLayout,
} from "./waveform";

describe("waveformNativeWidth", () => {
  it("scales with duration and clamps", () => {
    expect(waveformNativeWidth(0)).toBe(WAVEFORM_MIN_WIDTH);
    expect(waveformNativeWidth(1)).toBe(WAVEFORM_MIN_WIDTH); // 32px → min 128
    expect(waveformNativeWidth(10)).toBe(320);
    expect(waveformNativeWidth(1000)).toBe(WAVEFORM_MAX_WIDTH);
    expect(waveformNativeWidth(5) % 2).toBe(0);
  });
});

describe("waveformCacheKey", () => {
  it("is stable and trim-independent", () => {
    const a = waveformCacheKey("/a.m4a", 12.3456, 32, 400);
    const b = waveformCacheKey("/a.m4a", 12.3456, 32, 400);
    expect(a).toBe(b);
    expect(a.startsWith("v1-wave|")).toBe(true);
  });

  it("changes when path, duration, height, or width change", () => {
    const base = waveformCacheKey("/a.m4a", 10, 32, 400);
    expect(waveformCacheKey("/b.m4a", 10, 32, 400)).not.toBe(base);
    expect(waveformCacheKey("/a.m4a", 11, 32, 400)).not.toBe(base);
    expect(waveformCacheKey("/a.m4a", 10, 40, 400)).not.toBe(base);
    expect(waveformCacheKey("/a.m4a", 10, 32, 500)).not.toBe(base);
  });
});

describe("waveformTrimLayout", () => {
  it("full range fills the bar with no offset", () => {
    const { widthPercent, translatePercent } = waveformTrimLayout(0, 10, 10);
    expect(widthPercent).toBeCloseTo(100);
    expect(translatePercent).toBeCloseTo(0);
  });

  it("maps a mid trim window", () => {
    // media 10s, use 2.5–7.5 → used 5s → image 200% wide, shift -25% of image
    const { widthPercent, translatePercent } = waveformTrimLayout(2.5, 7.5, 10);
    expect(widthPercent).toBeCloseTo(200);
    expect(translatePercent).toBeCloseTo(-25);
  });

  it("maps head trim", () => {
    const { widthPercent, translatePercent } = waveformTrimLayout(5, 10, 10);
    expect(widthPercent).toBeCloseTo(200);
    expect(translatePercent).toBeCloseTo(-50);
  });
});
