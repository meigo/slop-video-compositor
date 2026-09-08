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

/**
 * Slots chosen so they stay distinguishable AFTER compositing, not at full strength:
 * clip fills paint at alpha 0.18–0.28 over the near-black ground, which pulls every
 * colour toward the background and collapses hue differences. Lightness is a second
 * axis for exactly that reason — hue alone does not survive the alpha.
 *
 * Saturation is capped at 65 to sit with the rest of the chrome. Every pair is at least
 * ΔE 11.4 apart composited, and every slot at least ΔE 11.2 from the warn amber, so a
 * clip is never mistaken for the play range or in/out. `clipColorSeparation.test.ts`
 * enforces both floors; re-run its measurements before touching these numbers.
 */
export const PALETTE: ClipColor[] = [
  { h: 15, s: 65, l: 52 }, // brick
  { h: 40, s: 55, l: 72 }, // sand
  { h: 70, s: 65, l: 42 }, // moss
  { h: 120, s: 65, l: 52 }, // green
  { h: 160, s: 65, l: 42 }, // pine
  { h: 200, s: 65, l: 52 }, // blue
  { h: 240, s: 65, l: 52 }, // indigo
  { h: 270, s: 65, l: 72 }, // lilac
  { h: 300, s: 65, l: 52 }, // magenta
  { h: 340, s: 65, l: 52 }, // rose
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

/**
 * Colour every source in a project, guaranteeing two files never share a slot while a
 * free one remains — hashing alone collides for 2 sources 8% of the time and 5 sources
 * 62% of the time. Each source takes its hashed slot, or the next free one.
 *
 * Assignment depends only on the SET of paths, never the order they arrive in, so the
 * colours survive a reload without persisting anything. Past the palette size slots are
 * reused, which is unavoidable.
 *
 * Keys are the original path spellings, so callers can look up by `clip.sourcePath`.
 */
export function clipColorsForPaths(paths: Iterable<string>): Map<string, ClipColor> {
  const spellingsByKey = new Map<string, string[]>();
  for (const path of paths) {
    const key = normalizePathKey(path);
    const spellings = spellingsByKey.get(key);
    if (!spellings) spellingsByKey.set(key, [path]);
    else if (!spellings.includes(path)) spellings.push(path);
  }

  const taken = new Set<number>();
  const colors = new Map<string, ClipColor>();
  for (const key of [...spellingsByKey.keys()].sort()) {
    let idx = hashString(key) % PALETTE.length;
    for (let step = 0; step < PALETTE.length && taken.has(idx); step++) {
      idx = (idx + 1) % PALETTE.length;
    }
    taken.add(idx);
    const color = PALETTE[idx]!;
    for (const spelling of spellingsByKey.get(key)!) colors.set(spelling, color);
  }
  return colors;
}

/** Inline CSS custom properties for a clip block (unitless s/l; multiply by 1% in CSS). */
export function colorToVars({ h, s, l }: ClipColor): string {
  return `--clip-h:${h};--clip-s:${s};--clip-l:${l}`;
}

/** Solid swatch color (inspector chip). */
export function colorToSolid({ h, s, l }: ClipColor): string {
  return `hsl(${h} ${s}% ${l}%)`;
}
