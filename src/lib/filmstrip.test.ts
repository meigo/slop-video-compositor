import { describe, it, expect } from "vitest";
import {
  FILMSTRIP_DEFAULT_ASPECT,
  FILMSTRIP_MAX_TILES,
  FILMSTRIP_MIN_TILES,
  filmstripCacheKey,
  filmstripDensityCount,
  filmstripDisplayTileWidth,
  filmstripDuration,
  filmstripIndicesForTrim,
  filmstripNativeWidth,
  filmstripSampleIndices,
  filmstripSourceAspect,
  filmstripTileAspect,
  filmstripTileWidthPx,
  filmstripVisibleCount,
} from "./filmstrip";

describe("filmstripDensityCount", () => {
  it("scales with duration and clamps", () => {
    expect(filmstripDensityCount(0)).toBe(1);
    expect(filmstripDensityCount(0.1)).toBe(1);
    expect(filmstripDensityCount(2)).toBe(FILMSTRIP_MIN_TILES);
    expect(filmstripDensityCount(10)).toBe(25); // 10 * 2.5
    expect(filmstripDensityCount(100)).toBe(FILMSTRIP_MAX_TILES);
  });
});

describe("filmstripTileWidthPx", () => {
  it("matches source aspect at track height (fills L without letterbox)", () => {
    expect(filmstripTileWidthPx(64, 16 / 9) % 2).toBe(0);
    expect(filmstripTileWidthPx(40, 16 / 9) % 2).toBe(0);
    expect(filmstripTileWidthPx(64, 16 / 9)).toBeGreaterThanOrEqual(112);
    expect(filmstripTileWidthPx(24, 1)).toBe(24);
  });
});

describe("filmstripSourceAspect", () => {
  it("uses source dimensions or 16:9 default", () => {
    expect(filmstripSourceAspect(1920, 1080)).toBeCloseTo(16 / 9);
    expect(filmstripSourceAspect(1080, 1920)).toBeCloseTo(9 / 16);
    expect(filmstripSourceAspect(0, 0)).toBe(FILMSTRIP_DEFAULT_ASPECT);
    expect(filmstripSourceAspect()).toBe(FILMSTRIP_DEFAULT_ASPECT);
  });
});

describe("filmstripNativeWidth", () => {
  it("is count times aspect-sized tile width", () => {
    const h = 64;
    const ar = 16 / 9;
    expect(filmstripNativeWidth(10, h, ar)).toBe(10 * filmstripTileWidthPx(h, ar));
  });
});

describe("filmstripCacheKey", () => {
  it("is stable and independent of trim / zoom", () => {
    const a = filmstripCacheKey("/a.mp4", 8, 32, 57);
    const b = filmstripCacheKey("/a.mp4", 8, 32, 57);
    expect(a).toBe(b);
    expect(a.startsWith("v8-full|")).toBe(true);
  });

  it("changes when path, count, height, or tile width change", () => {
    const base = filmstripCacheKey("/a.mp4", 4, 32, 57);
    expect(filmstripCacheKey("/b.mp4", 4, 32, 57)).not.toBe(base);
    expect(filmstripCacheKey("/a.mp4", 5, 32, 57)).not.toBe(base);
    expect(filmstripCacheKey("/a.mp4", 4, 40, 57)).not.toBe(base);
    expect(filmstripCacheKey("/a.mp4", 4, 32, 72)).not.toBe(base);
  });
});

describe("filmstripDuration", () => {
  it("returns positive used length", () => {
    expect(filmstripDuration(2, 5)).toBe(3);
    expect(filmstripDuration(5, 2)).toBe(0);
  });
});

describe("filmstripTileAspect / display width", () => {
  it("derives tile aspect from sheet geometry", () => {
    expect(filmstripTileAspect(480, 32, 10)).toBeCloseTo(1.5);
    expect(filmstripDisplayTileWidth(40, 1.5)).toBeCloseTo(60);
  });
});

describe("filmstripVisibleCount", () => {
  it("drops frames rather than fitting partial tiles", () => {
    expect(filmstripVisibleCount(200, 60, 20)).toBe(3);
    expect(filmstripVisibleCount(50, 60, 20)).toBe(1);
    expect(filmstripVisibleCount(600, 60, 5)).toBe(5);
  });
});

describe("filmstripSampleIndices", () => {
  it("returns all indices when visible >= total", () => {
    expect(filmstripSampleIndices(8, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("evenly samples when filtering", () => {
    expect(filmstripSampleIndices(1, 10)).toEqual([0]);
    expect(filmstripSampleIndices(3, 10)).toEqual([0, 5, 9]);
    expect(filmstripSampleIndices(2, 10)).toEqual([0, 9]);
  });
});

describe("filmstripIndicesForTrim", () => {
  it("maps full range like even sample across the sheet", () => {
    expect(filmstripIndicesForTrim(3, 10, 0, 10, 10)).toEqual([0, 5, 9]);
  });

  it("samples only within the trim window", () => {
    // media 10s, tiles 0..9; trim 2.5–7.5 → times map near indices 2..7
    const idx = filmstripIndicesForTrim(3, 10, 2.5, 7.5, 10);
    expect(idx).toHaveLength(3);
    expect(idx[0]).toBeGreaterThanOrEqual(2);
    expect(idx[0]).toBeLessThanOrEqual(3);
    expect(idx[2]).toBeGreaterThanOrEqual(6);
    expect(idx[2]).toBeLessThanOrEqual(8);
    expect(idx[0]).toBeLessThan(idx[2]!);
  });

  it("maps full range endpoints to first/last tile", () => {
    // 11 tiles → indices 0..10
    expect(filmstripIndicesForTrim(2, 11, 0, 10, 10)).toEqual([0, 10]);
  });
});
