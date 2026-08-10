/** Global timeline track row height presets (session UI preference). */

export type TrackRowSize = "s" | "m" | "l";

export type TrackRowMetrics = {
  /** Lane + label row height (px). */
  trackH: number;
  /** Clip bar content height for filmstrips (trackH − vertical inset). */
  filmstripH: number;
  label: string;
  title: string;
};

/** Clip top/bottom inset inside the lane (matches Timeline CSS). */
export const CLIP_VERTICAL_INSET = 8;

export const TRACK_ROW_PRESETS: Record<TrackRowSize, TrackRowMetrics> = {
  s: {
    trackH: 32,
    filmstripH: 24,
    label: "S",
    title: "Compact tracks",
  },
  m: {
    trackH: 48,
    filmstripH: 40,
    label: "M",
    title: "Default tracks",
  },
  l: {
    trackH: 72,
    filmstripH: 64,
    label: "L",
    title: "Tall tracks (better filmstrips)",
  },
};

export const DEFAULT_TRACK_ROW_SIZE: TrackRowSize = "m";

export function trackRowMetrics(size: TrackRowSize): TrackRowMetrics {
  return TRACK_ROW_PRESETS[size] ?? TRACK_ROW_PRESETS[DEFAULT_TRACK_ROW_SIZE];
}

export function isTrackRowSize(v: unknown): v is TrackRowSize {
  return v === "s" || v === "m" || v === "l";
}
