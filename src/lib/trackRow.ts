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

/** Cycle order for the single row-height button: compact, default, tall, back to compact. */
const ROW_SIZE_CYCLE: readonly TrackRowSize[] = ["s", "m", "l"];

/** The next size in the cycle. One button that steps through the three beats three buttons that
 *  each set one, both in width and in matching slop-audio-editor's own row-height control. */
export function nextTrackRowSize(size: TrackRowSize): TrackRowSize {
  const i = ROW_SIZE_CYCLE.indexOf(size);
  return ROW_SIZE_CYCLE[(i + 1) % ROW_SIZE_CYCLE.length]!;
}
