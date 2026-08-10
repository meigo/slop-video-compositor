/**
 * Session filmstrip data-URL cache + in-flight dedupe.
 * One dense sheet per source media + track height (not per trim / zoom).
 * Trim only remaps which tiles are shown in CSS.
 */

import { isAudioOnlyMeta } from "./tauri";
import {
  filmstripCacheKey,
  filmstripDensityCount,
  filmstripNativeWidth,
  filmstripSourceAspect,
  filmstripTileWidthPx,
} from "./filmstrip";
import { generateFilmstrip } from "./tauri";
import type { Clip, SourceMeta } from "./types";

export type FilmstripReady = {
  url: string;
  /** Actual tiles in the sheet (layout must use this, not the request count). */
  count: number;
  /** Native JPEG width — locks CSS aspect so zoom cannot anamorphically stretch. */
  width: number;
  /** Native JPEG height. */
  height: number;
  /** Media duration the sheet spans (for trim → tile mapping). */
  mediaDuration: number;
};

type Entry =
  | { status: "loading"; promise: Promise<FilmstripReady | null> }
  | {
      status: "ready";
      url: string;
      count: number;
      width: number;
      height: number;
      mediaDuration: number;
    }
  | { status: "error"; message: string };

/** Max ready strips kept in memory (data URLs). Disk cache is separate. */
export const FILMSTRIP_MEMORY_LRU = 48;

const cache = new Map<string, Entry>();
/** Insertion/access order for LRU (oldest at front). */
const lruKeys: string[] = [];
const listeners = new Set<() => void>();
let lastError: string | null = null;

function notify() {
  for (const l of listeners) l();
}

function touchLru(key: string) {
  const i = lruKeys.indexOf(key);
  if (i >= 0) lruKeys.splice(i, 1);
  lruKeys.push(key);
}

function evictLruIfNeeded() {
  while (lruKeys.length > FILMSTRIP_MEMORY_LRU) {
    const old = lruKeys.shift();
    if (!old) break;
    const e = cache.get(old);
    if (e?.status === "ready") {
      cache.delete(old);
    }
    if (e?.status === "error") cache.delete(old);
  }
}

/** Subscribe to cache updates (Timeline re-renders filmstrips). */
export function subscribeFilmstrips(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getFilmstripUrl(key: string): string | null {
  return getFilmstrip(key)?.url ?? null;
}

/** Ready strip + native geometry (for equal-cell CSS layout without stretch). */
export function getFilmstrip(key: string): FilmstripReady | null {
  const e = cache.get(key);
  if (e?.status === "ready") {
    touchLru(key);
    return {
      url: e.url,
      count: e.count,
      width: e.width,
      height: e.height,
      mediaDuration: e.mediaDuration,
    };
  }
  return null;
}

export function getFilmstripLastError(): string | null {
  return lastError;
}

/** Drop error entries so the next ensure can retry. */
export function clearFilmstripErrors() {
  for (const [k, v] of cache) {
    if (v.status === "error") {
      cache.delete(k);
      const i = lruKeys.indexOf(k);
      if (i >= 0) lruKeys.splice(i, 1);
    }
  }
  lastError = null;
}

/** Drop all in-memory strips. */
export function clearFilmstripMemoryCache() {
  cache.clear();
  lruKeys.length = 0;
  lastError = null;
  notify();
}

/**
 * Ensure a full-media filmstrip exists for this source (trim-independent).
 * Returns cache key, or null if not applicable.
 */
export function ensureFilmstrip(
  clip: Clip,
  meta: SourceMeta | undefined,
  stripHeightPx: number,
): string | null {
  if (!meta || isAudioOnlyMeta(meta)) return null;
  const mediaDur = meta.duration;
  if (!(mediaDur > 0) || !Number.isFinite(mediaDur)) return null;
  // Still require a positive used range so empty/broken clips skip work.
  if (!(clip.sourceOut > clip.sourceIn)) return null;

  const count = filmstripDensityCount(mediaDur);
  const height = Math.max(16, Math.min(128, Math.round(stripHeightPx || 32)));
  const aspect = filmstripSourceAspect(meta.width, meta.height);
  const tileW = filmstripTileWidthPx(height, aspect);
  const targetWidth = filmstripNativeWidth(count, height, aspect);

  const key = filmstripCacheKey(clip.sourcePath, count, height, tileW);
  const existing = cache.get(key);
  if (existing?.status === "ready") {
    touchLru(key);
    return key;
  }
  if (existing?.status === "loading") return key;
  if (existing?.status === "error") cache.delete(key);

  const promise = generateFilmstrip({
    path: clip.sourcePath,
    source_start: 0,
    duration: mediaDur,
    count,
    height,
    target_width: targetWidth,
  })
    .then((res) => {
      if (!res?.data_url) {
        throw new Error("empty filmstrip data_url");
      }
      const ready: FilmstripReady = {
        url: res.data_url,
        count: Math.max(1, Math.round(res.count || count)),
        width: Math.max(1, Math.round(res.width || targetWidth)),
        height: Math.max(1, Math.round(res.height || height)),
        mediaDuration: mediaDur,
      };
      cache.set(key, {
        status: "ready",
        url: ready.url,
        count: ready.count,
        width: ready.width,
        height: ready.height,
        mediaDuration: ready.mediaDuration,
      });
      touchLru(key);
      evictLruIfNeeded();
      lastError = null;
      notify();
      return ready;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      cache.set(key, { status: "error", message });
      lastError = message;
      notify();
      return null;
    });

  cache.set(key, { status: "loading", promise });
  return key;
}
