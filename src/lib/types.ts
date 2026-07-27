export type ClipTransform = { scale: number; x: number; y: number };

export type Clip = {
  id: string;
  sourcePath: string;
  sourceIn: number;
  sourceOut: number;
  timelineStart: number;
  transform: ClipTransform;
};

export type Track = { id: string; name: string; clips: Clip[] };

export type Project = {
  version: 1;
  name: string;
  canvas: { width: number; height: number };
  /**
   * Sequence length in seconds (user-editable).
   * Effective length is max(duration, last clip end) so clips are never cropped by the handle.
   */
  duration: number;
  tracks: Track[];
};

export type SourceMeta = {
  path: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

/** Wire shape from Rust `check_deps` (snake_case). */
export type DepsStatus = {
  ffmpeg: boolean;
  ffmpeg_path: string | null;
};

/** Wire shape from Rust `load_settings` / `save_settings`. */
export type AppSettings = {
  last_export_dir: string | null;
  last_project_dir: string | null;
};

/** Wire shape from Rust `probe_media` (no path; caller attaches it). */
export type MediaMeta = {
  duration: number;
  width: number;
  height: number;
  has_audio: boolean;
};

/** Wire shape from Rust `export_project`. */
export type ExportResult = {
  output_path: string;
};

/** Flattened export/preview segment */
export type Segment =
  | {
      kind: "clip";
      clipId: string;
      trackId: string;
      sourcePath: string;
      /** Source media time at segment start */
      sourceStart: number;
      /** Timeline [t0, t1) */
      t0: number;
      t1: number;
      transform: ClipTransform;
      srcW: number;
      srcH: number;
      hasAudio: boolean;
    }
  | { kind: "black"; t0: number; t1: number };
