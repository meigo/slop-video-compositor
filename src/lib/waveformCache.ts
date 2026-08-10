/**
 * Session waveform data-URL cache + in-flight dedupe.
 * One sheet per source media + height (not per trim / zoom).
 */

import { isAudioOnlyMeta, generateWaveform } from "./tauri";
import {
  waveformCacheKey,
  waveformNativeWidth,
} from "./waveform";
import type { Clip, SourceMeta } from "./types";

export type WaveformReady = {
  url: string;
  width: number;
  height: number;
  mediaDuration: number;
};

type Entry =
  | { status: "loading"; promise: Promise<WaveformReady | null> }
  | {
      status: "ready";
      url: string;
      width: number;
      height: number;
      mediaDuration: number;
    }
  | { status: "error"; message: string };

export const WAVEFORM_MEMORY_LRU = 48;

const cache = new Map<string, Entry>();
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
  while (lruKeys.length > WAVEFORM_MEMORY_LRU) {
    const old = lruKeys.shift();
    if (!old) break;
    const e = cache.get(old);
    if (e?.status === "ready" || e?.status === "error") {
      cache.delete(old);
    }
  }
}

export function subscribeWaveforms(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getWaveform(key: string): WaveformReady | null {
  const e = cache.get(key);
  if (e?.status === "ready") {
    touchLru(key);
    return {
      url: e.url,
      width: e.width,
      height: e.height,
      mediaDuration: e.mediaDuration,
    };
  }
  return null;
}

export function getWaveformLastError(): string | null {
  return lastError;
}

export function clearWaveformErrors() {
  for (const [k, v] of cache) {
    if (v.status === "error") {
      cache.delete(k);
      const i = lruKeys.indexOf(k);
      if (i >= 0) lruKeys.splice(i, 1);
    }
  }
  lastError = null;
}

export function clearWaveformMemoryCache() {
  cache.clear();
  lruKeys.length = 0;
  lastError = null;
  notify();
}

/**
 * Ensure a full-media waveform for an audio-only clip.
 * Returns cache key, or null if not applicable.
 */
export function ensureWaveform(
  clip: Clip,
  meta: SourceMeta | undefined,
  stripHeightPx: number,
): string | null {
  if (!meta || !isAudioOnlyMeta(meta)) return null;
  const mediaDur = meta.duration;
  if (!(mediaDur > 0) || !Number.isFinite(mediaDur)) return null;
  if (!(clip.sourceOut > clip.sourceIn)) return null;

  const height = Math.max(16, Math.min(128, Math.round(stripHeightPx || 32)));
  const width = waveformNativeWidth(mediaDur);
  const key = waveformCacheKey(clip.sourcePath, mediaDur, height, width);

  const existing = cache.get(key);
  if (existing?.status === "ready") {
    touchLru(key);
    return key;
  }
  if (existing?.status === "loading") return key;
  if (existing?.status === "error") cache.delete(key);

  const promise = generateWaveform({
    path: clip.sourcePath,
    duration: mediaDur,
    width,
    height,
  })
    .then((res) => {
      if (!res?.data_url) {
        throw new Error("empty waveform data_url");
      }
      const ready: WaveformReady = {
        url: res.data_url,
        width: Math.max(1, Math.round(res.width || width)),
        height: Math.max(1, Math.round(res.height || height)),
        mediaDuration: mediaDur,
      };
      cache.set(key, {
        status: "ready",
        url: ready.url,
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
