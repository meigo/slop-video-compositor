import { describe, it, expect } from "vitest";
import { PALETTE, clipColorsForPaths, type ClipColor } from "./clipColor";

/**
 * Clip fills render as hsla(...) over the dark ground, so two palette slots that look
 * distinct at full strength can composite to the same colour. These helpers measure the
 * palette the way the eye actually meets it: composited, then compared in CIELAB.
 *
 * Test-only colour science — production never needs Lab.
 */

/** --color-ground from app.css. */
const GROUND: [number, number, number] = [0x10, 0x10, 0x13];

/** The weakest fill a clip uses: `.clip.has-filmstrip` at 0.18. */
const FILL_ALPHA = 0.18;

/**
 * Below this, two colours read as the same. 10 is the usual "noticeable at a glance"
 * threshold; the palette must clear it so hue keeps meaning "which source file".
 */
const MIN_DELTA_E = 10;

/**
 * ΔE alone is not enough. Two greens separated only by lightness measured ΔE 11.2 — over the
 * floor — and still read as one colour with a shadow on it, because ΔE under-weights hue
 * similarity. Every slot must therefore also be a genuinely different hue.
 */
const MIN_HUE_DEGREES = 28;

/** --color-warn #F7D266 as HSL: the play range, the in/out wedges and their toggles. */
const WARN: ClipColor = { h: 45, s: 90, l: 68 };

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function hslToRgb({ h, s, l }: ClipColor): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function over(rgb: [number, number, number], alpha: number): [number, number, number] {
  return rgb.map((v, i) => v * alpha + GROUND[i]! * (1 - alpha)) as [number, number, number];
}

function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function deltaE(a: ClipColor, b: ClipColor): number {
  const la = toLab(over(hslToRgb(a), FILL_ALPHA));
  const lb = toLab(over(hslToRgb(b), FILL_ALPHA));
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

describe("palette separation", () => {
  it("keeps every pair of slots distinguishable once composited over the ground", () => {
    const tooClose: string[] = [];
    for (let i = 0; i < PALETTE.length; i++) {
      for (let j = i + 1; j < PALETTE.length; j++) {
        const d = deltaE(PALETTE[i]!, PALETTE[j]!);
        if (d < MIN_DELTA_E) {
          tooClose.push(
            `slot ${i} (h${PALETTE[i]!.h}) / slot ${j} (h${PALETTE[j]!.h}): ΔE ${d.toFixed(1)}`,
          );
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("keeps every pair of slots a different hue, not merely a different shade", () => {
    const tooSimilar: string[] = [];
    for (let i = 0; i < PALETTE.length; i++) {
      for (let j = i + 1; j < PALETTE.length; j++) {
        const gap = hueGap(PALETTE[i]!.h, PALETTE[j]!.h);
        if (gap < MIN_HUE_DEGREES) {
          tooSimilar.push(`h${PALETTE[i]!.h} / h${PALETTE[j]!.h}: ${gap}° apart`);
        }
      }
    }
    expect(tooSimilar).toEqual([]);
  });

  it("does not collide with the warn amber used for the play range and in/out", () => {
    // A clip must never be mistaken for session state, which is never saved or exported.
    for (const slot of PALETTE) {
      expect(deltaE(slot, WARN)).toBeGreaterThanOrEqual(MIN_DELTA_E);
      expect(hueGap(slot.h, WARN.h)).toBeGreaterThanOrEqual(MIN_HUE_DEGREES);
    }
  });
});

describe("clipColorsForPaths", () => {
  it("gives every source its own slot while slots remain", () => {
    const paths = Array.from({ length: PALETTE.length }, (_, i) => `/Movies/take-${i}.mp4`);
    const colors = clipColorsForPaths(paths);
    const seen = new Set(paths.map((p) => JSON.stringify(colors.get(p))));
    expect(seen.size).toBe(PALETTE.length);
  });

  it("assigns the same colours regardless of the order the paths arrive in", () => {
    const paths = ["/a/one.mp4", "/b/two.mov", "/c/three.mp4", "/d/four.mkv"];
    const forward = clipColorsForPaths(paths);
    const backward = clipColorsForPaths([...paths].reverse());
    for (const p of paths) {
      expect(backward.get(p)).toEqual(forward.get(p));
    }
  });

  it("ignores duplicate paths rather than consuming a second slot", () => {
    const colors = clipColorsForPaths(["/a.mp4", "/a.mp4", "/b.mp4"]);
    expect(colors.size).toBe(2);
    expect(colors.get("/a.mp4")).not.toEqual(colors.get("/b.mp4"));
  });

  it("treats backslash and slash spellings of one file as the same source", () => {
    const colors = clipColorsForPaths([String.raw`C:\clips\x.mp4`, "C:/clips/x.mp4"]);
    expect(colors.get(String.raw`C:\clips\x.mp4`)).toEqual(colors.get("C:/clips/x.mp4"));
  });

  it("keeps going past the palette size instead of failing", () => {
    const paths = Array.from({ length: PALETTE.length + 3 }, (_, i) => `/m/${i}.mp4`);
    const colors = clipColorsForPaths(paths);
    expect(colors.size).toBe(paths.length);
    for (const p of paths) expect(colors.get(p)).toBeDefined();
  });
});
