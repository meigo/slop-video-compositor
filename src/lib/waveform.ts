/** Pure helpers for timeline audio waveforms (full-media sheet; trim in CSS). */

/** Pixels of native waveform width per second of media. */
export const WAVEFORM_PX_PER_SEC = 32;
export const WAVEFORM_MIN_WIDTH = 128;
export const WAVEFORM_MAX_WIDTH = 2048;
export const WAVEFORM_HEIGHT_PX = 32;

/** Round up to even (matches Rust clamp_width style). */
export function evenDim(v: number): number {
  const n = Math.max(2, Math.round(v));
  return n + (n % 2);
}

/** Native PNG width for a full-media waveform sheet. */
export function waveformNativeWidth(mediaDurationSec: number): number {
  if (!(mediaDurationSec > 0) || !Number.isFinite(mediaDurationSec)) {
    return WAVEFORM_MIN_WIDTH;
  }
  const raw = Math.ceil(mediaDurationSec * WAVEFORM_PX_PER_SEC);
  const clamped = Math.max(WAVEFORM_MIN_WIDTH, Math.min(WAVEFORM_MAX_WIDTH, raw));
  return evenDim(clamped);
}

/**
 * Cache identity — full media only (trim remaps in CSS).
 * Independent of zoom.
 */
export function waveformCacheKey(
  sourcePath: string,
  mediaDuration: number,
  height: number = WAVEFORM_HEIGHT_PX,
  width?: number,
): string {
  const dur = Math.round(Math.max(0, mediaDuration) * 1000) / 1000;
  const h = Math.max(8, Math.min(128, Math.round(height)));
  const w = width ?? waveformNativeWidth(mediaDuration);
  return `v1-wave|${sourcePath}|${dur}|${w}|${h}`;
}

/**
 * Layout: scale full-media waveform so the used range fills the clip bar.
 * Returns CSS width % of the bar and translateX % of the image.
 */
export function waveformTrimLayout(
  sourceIn: number,
  sourceOut: number,
  mediaDuration: number,
): { widthPercent: number; translatePercent: number } {
  const media =
    Number.isFinite(mediaDuration) && mediaDuration > 1e-6 ? mediaDuration : 1;
  const inT = Math.max(0, Math.min(media, Number.isFinite(sourceIn) ? sourceIn : 0));
  const outT = Math.max(
    inT + 1e-6,
    Math.min(media, Number.isFinite(sourceOut) ? sourceOut : media),
  );
  const used = outT - inT;
  // Image width relative to clip bar so [in, out] spans 100% of the bar.
  const widthPercent = (media / used) * 100;
  // Shift so sourceIn lines up with the left edge of the bar.
  const translatePercent = -(inT / media) * 100;
  return { widthPercent, translatePercent };
}
