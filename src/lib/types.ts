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
  tracks: Track[];
};

export type SourceMeta = {
  path: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
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
