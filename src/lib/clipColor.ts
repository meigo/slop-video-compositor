/**
 * Stable timeline colors keyed by source file path.
 * Same path → same color; different files → different palette slots.
 */

export type ClipColor = {
  /** Hue degrees 0–360 */
  h: number;
  /** Saturation 0–100 */
  s: number;
  /** Lightness 0–100 */
  l: number;
};

/** Distinct hues tuned for dark UI (readable labels on semi-transparent fills). */
const PALETTE: ClipColor[] = [
  { h: 217, s: 78, l: 62 }, // blue
  { h: 160, s: 52, l: 48 }, // teal
  { h: 32, s: 80, l: 56 }, // orange
  { h: 280, s: 55, l: 62 }, // purple
  { h: 340, s: 62, l: 60 }, // rose
  { h: 85, s: 48, l: 48 }, // olive
  { h: 195, s: 65, l: 52 }, // cyan
  { h: 15, s: 70, l: 58 }, // coral
  { h: 250, s: 58, l: 66 }, // indigo
  { h: 120, s: 40, l: 48 }, // green
  { h: 45, s: 75, l: 54 }, // gold
  { h: 310, s: 50, l: 60 }, // magenta
];

/** djb2 — stable across sessions for the same string. */
export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/** Normalize path so Windows/macOS separators hash the same for the same file. */
export function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/");
}

export function clipColorForPath(path: string): ClipColor {
  const key = normalizePathKey(path);
  const idx = hashString(key) % PALETTE.length;
  return PALETTE[idx]!;
}

/** Inline CSS custom properties for a clip block (unitless s/l; multiply by 1% in CSS). */
export function clipColorCssVars(path: string): string {
  const { h, s, l } = clipColorForPath(path);
  return `--clip-h:${h};--clip-s:${s};--clip-l:${l}`;
}

/** Solid swatch color (inspector chip). */
export function clipColorSolid(path: string): string {
  const { h, s, l } = clipColorForPath(path);
  return `hsl(${h} ${s}% ${l}%)`;
}
