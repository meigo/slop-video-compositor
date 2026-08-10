/** Pure helpers for timeline filmstrip density and cache keys. */

/**
 * Fallback tile aspect when source dimensions are unknown (landscape 16:9).
 * Tile width is always `round(height × aspect)` so frames fill the track
 * height without letterboxing (fixed 48×H cells were portrait on L tracks).
 */
export const FILMSTRIP_DEFAULT_ASPECT = 16 / 9;
/** @deprecated Prefer filmstripTileWidthPx(height, aspect). Kept for tests. */
export const FILMSTRIP_TILE_WIDTH_PX = 48;
/** Hard cap per clip (ffmpeg cost + decoded memory). */
export const FILMSTRIP_MAX_TILES = 64;
export const FILMSTRIP_MIN_TILES = 6;
/** ~tiles per second of used media (dense overview). */
export const FILMSTRIP_TILES_PER_SEC = 2.5;
export const FILMSTRIP_HEIGHT_PX = 32;

/**
 * Dense tile count from media duration only (not zoom).
 * Short clips stay sparse; long clips approach MAX.
 */
export function filmstripDensityCount(durationSec: number): number {
  if (!(durationSec > 0) || !Number.isFinite(durationSec)) return 1;
  if (durationSec < 0.2) return 1;
  const n = Math.ceil(durationSec * FILMSTRIP_TILES_PER_SEC);
  return Math.max(FILMSTRIP_MIN_TILES, Math.min(FILMSTRIP_MAX_TILES, n));
}

/** Clamp source aspect to a sane range; default 16:9. */
export function filmstripSourceAspect(
  sourceWidth?: number,
  sourceHeight?: number,
): number {
  if (
    sourceWidth != null &&
    sourceHeight != null &&
    sourceWidth > 0 &&
    sourceHeight > 0 &&
    Number.isFinite(sourceWidth) &&
    Number.isFinite(sourceHeight)
  ) {
    const ar = sourceWidth / sourceHeight;
    if (ar > 0.2 && ar < 5) return ar;
  }
  return FILMSTRIP_DEFAULT_ASPECT;
}

/** Round up to even — odd pad/scale sizes break ffmpeg filmstrip generation. */
export function evenDim(v: number): number {
  const n = Math.max(2, Math.round(v));
  return n + (n % 2);
}

/**
 * Native width of one tile so a frame at `aspect` fills `height` (no letterbox).
 * e.g. L track h=64, 16:9 → 114px (even) wide tiles.
 */
export function filmstripTileWidthPx(
  height: number,
  aspect: number = FILMSTRIP_DEFAULT_ASPECT,
): number {
  const h = evenDim(Math.max(8, Math.min(128, Math.round(height))));
  const ar =
    aspect > 0.2 && aspect < 5 && Number.isFinite(aspect)
      ? aspect
      : FILMSTRIP_DEFAULT_ASPECT;
  return evenDim(Math.max(8, Math.round(h * ar)));
}

/** Native pixel width of the generated contact sheet. */
export function filmstripNativeWidth(
  count: number,
  height: number = FILMSTRIP_HEIGHT_PX,
  aspect: number = FILMSTRIP_DEFAULT_ASPECT,
): number {
  const c = Math.max(1, Math.min(FILMSTRIP_MAX_TILES, Math.round(count)));
  return c * filmstripTileWidthPx(height, aspect);
}

/**
 * Stable cache identity for a full-media sheet.
 * Independent of zoom and of clip trim (in/out) — trim only remaps tiles in CSS.
 */
export function filmstripCacheKey(
  sourcePath: string,
  count: number,
  height: number = FILMSTRIP_HEIGHT_PX,
  tileWidth: number = filmstripTileWidthPx(height),
): string {
  const c = Math.max(1, Math.min(FILMSTRIP_MAX_TILES, Math.round(count)));
  const h = Math.max(8, Math.min(128, Math.round(height)));
  const tw = Math.max(8, Math.round(tileWidth));
  // v8-full: one sheet per source+height; trim is display-only.
  return `v8-full|${sourcePath}|${c}|${h}|${tw}`;
}

export function filmstripDuration(sourceIn: number, sourceOut: number): number {
  if (!Number.isFinite(sourceIn) || !Number.isFinite(sourceOut)) return 0;
  return Math.max(0, sourceOut - sourceIn);
}

/**
 * Map visible slots across a trim window onto indices in a full-media sheet.
 * Sheet tiles span [0, mediaDuration); used range is [sourceIn, sourceOut].
 */
export function filmstripIndicesForTrim(
  visible: number,
  totalTiles: number,
  sourceIn: number,
  sourceOut: number,
  mediaDuration: number,
): number[] {
  const n = Math.max(1, Math.round(totalTiles));
  const media =
    Number.isFinite(mediaDuration) && mediaDuration > 1e-6 ? mediaDuration : 1;
  const inT = Math.max(0, Math.min(media, Number.isFinite(sourceIn) ? sourceIn : 0));
  const outT = Math.max(
    inT,
    Math.min(media, Number.isFinite(sourceOut) ? sourceOut : media),
  );
  const v = Math.max(1, Math.min(Math.round(visible), n));

  const timeToIndex = (t: number): number => {
    if (n === 1) return 0;
    const u = Math.max(0, Math.min(1, t / media));
    return Math.min(n - 1, Math.max(0, Math.round(u * (n - 1))));
  };

  if (v === 1) return [timeToIndex((inT + outT) / 2)];

  return Array.from({ length: v }, (_, i) => {
    const t = inT + (i / (v - 1)) * (outT - inT);
    return timeToIndex(t);
  });
}

/** Native aspect ratio of one tile (width / height) from sheet geometry. */
export function filmstripTileAspect(
  sheetWidth: number,
  sheetHeight: number,
  count: number,
): number {
  const n = Math.max(1, Math.round(count));
  const w = Math.max(1, sheetWidth);
  const h = Math.max(1, sheetHeight);
  return w / (n * h);
}

/** On-screen tile width that keeps the tile’s aspect at the clip bar height. */
export function filmstripDisplayTileWidth(
  clipHeightPx: number,
  tileAspect: number,
): number {
  if (!(clipHeightPx > 0) || !(tileAspect > 0)) return 1;
  return clipHeightPx * tileAspect;
}

/**
 * How many full-aspect tiles fit in the clip width.
 * Prefer dropping frames over horizontal crop when space is tight.
 */
export function filmstripVisibleCount(
  clipWidthPx: number,
  tileWidthPx: number,
  maxTiles: number,
): number {
  const max = Math.max(1, Math.round(maxTiles));
  if (!(clipWidthPx > 0) || !(tileWidthPx > 0)) return 1;
  return Math.max(1, Math.min(max, Math.floor(clipWidthPx / tileWidthPx)));
}

/**
 * Evenly sample `visible` indices from `total` generated tiles (0 .. total-1).
 * Used when zoom-out filters frames so each shown tile stays full-aspect.
 */
export function filmstripSampleIndices(visible: number, total: number): number[] {
  const t = Math.max(1, Math.round(total));
  const v = Math.max(1, Math.min(Math.round(visible), t));
  if (v === 1) return [0];
  if (v >= t) return Array.from({ length: t }, (_, i) => i);
  return Array.from({ length: v }, (_, i) =>
    Math.round((i * (t - 1)) / (v - 1)),
  );
}
