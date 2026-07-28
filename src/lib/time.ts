export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Round for UI number fields (avoids float noise like 6.4953889992537315).
 * Default 2 decimals for timeline seconds / scale.
 */
export function roundTo(n: number, places = 2): number {
  if (!Number.isFinite(n)) return 0;
  if (places <= 0) return Math.round(n);
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function formatTimestamp(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const s = Math.floor(secs % 60);
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}
