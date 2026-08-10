/**
 * Session filmstrip data-URL cache + in-flight dedupe.
 * One dense sheet per source media + track height (not per trim / zoom).
 * Trim only remaps which tiles are shown in CSS.
 *
 * Important: never notify listeners synchronously from a render path — that
 * mutates Timeline state mid-paint and can drop the whole clip update.
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
  count: number;
  width: number;
  height: number;
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

export const FILMSTRIP_MEMORY_LRU = 48;

const cache = new Map<string, Entry>();
const lruKeys: string[] = [];
const listeners = new Set<() => void>();
let lastError: string | null = null;
let loadingCount = 0;
let notifyScheduled = false;

function scheduleNotify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const l of listeners) l();
  });
}

export function getFilmstripLoadingCount(): number {
  return loadingCount;
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
    if (e?.status === "ready" || e?.status === "error") {
      cache.delete(old);
    }
  }
}

export function subscribeFilmstrips(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Stable cache key, or null if this clip should not have a filmstrip. */
export function filmstripKeyFor(
  clip: Clip,
  meta: SourceMeta | undefined,
  stripHeightPx: number,
): string | null {
  if (!meta || isAudioOnlyMeta(meta)) return null;
  const mediaDur = meta.duration;
  if (!(mediaDur > 0) || !Number.isFinite(mediaDur)) return null;
  if (!(clip.sourceOut > clip.sourceIn)) return null;

  const count = filmstripDensityCount(mediaDur);
  const height = Math.max(16, Math.min(128, Math.round(stripHeightPx || 32)));
  const aspect = filmstripSourceAspect(meta.width, meta.height);
  const tileW = filmstripTileWidthPx(height, aspect);
  return filmstripCacheKey(clip.sourcePath, count, height, tileW);
}

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

/** Peek without starting work (safe in template / render). */
export function peekFilmstrip(
  clip: Clip,
  meta: SourceMeta | undefined,
  stripHeightPx: number,
): FilmstripReady | null {
  const key = filmstripKeyFor(clip, meta, stripHeightPx);
  return key ? getFilmstrip(key) : null;
}

export function getFilmstripLastError(): string | null {
  return lastError;
}

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

export function clearFilmstripMemoryCache() {
  cache.clear();
  lruKeys.length = 0;
  lastError = null;
  loadingCount = 0;
  scheduleNotify();
}

/**
 * Ensure a full-media filmstrip exists (async). Call from $effect, not from render.
 * Returns cache key, or null if not applicable.
 */
export function ensureFilmstrip(
  clip: Clip,
  meta: SourceMeta | undefined,
  stripHeightPx: number,
): string | null {
  const key = filmstripKeyFor(clip, meta, stripHeightPx);
  if (!key || !meta) return null;

  const existing = cache.get(key);
  if (existing?.status === "ready") {
    touchLru(key);
    return key;
  }
  if (existing?.status === "loading") return key;
  if (existing?.status === "error") cache.delete(key);

  const mediaDur = meta.duration;
  const count = filmstripDensityCount(mediaDur);
  const height = Math.max(16, Math.min(128, Math.round(stripHeightPx || 32)));
  const aspect = filmstripSourceAspect(meta.width, meta.height);
  const targetWidth = filmstripNativeWidth(count, height, aspect);

  let resolveReady!: (v: FilmstripReady | null) => void;
  const promise = new Promise<FilmstripReady | null>((resolve) => {
    resolveReady = resolve;
  });
  cache.set(key, { status: "loading", promise });
  loadingCount++;
  scheduleNotify();

  void generateFilmstrip({
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
      const cur = cache.get(key);
      if (cur?.status === "loading" && cur.promise === promise) {
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
      }
      resolveReady(ready);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const cur = cache.get(key);
      if (cur?.status === "loading" && cur.promise === promise) {
        cache.set(key, { status: "error", message });
        lastError = message;
      }
      resolveReady(null);
    })
    .finally(() => {
      loadingCount = Math.max(0, loadingCount - 1);
      scheduleNotify();
    });

  return key;
}
