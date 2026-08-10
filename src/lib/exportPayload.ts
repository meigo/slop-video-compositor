import { flattenProject } from "./flatten";
import type { Project, SourceMeta } from "./types";

/** Wire format for Tauri `export_project` (snake_case, matches Rust serde). */
export type ExportSegmentWire =
  | {
      kind: "clip";
      source_path: string;
      source_start: number;
      duration: number;
      scale: number;
      x: number;
      y: number;
      src_w: number;
      src_h: number;
      has_audio: boolean;
      /** Optional audio-only underlay (mixed under picture audio). */
      bed_source_path?: string | null;
      bed_source_start?: number | null;
    }
  | { kind: "black"; duration: number };

export type ExportOpts = {
  canvas_width: number;
  canvas_height: number;
  segments: ExportSegmentWire[];
  output_path: string;
};

export function toExportOpts(
  project: Project,
  metaByPath: Map<string, SourceMeta>,
  outputPath: string,
): ExportOpts {
  const segs = flattenProject(project, metaByPath).map((s) => {
    if (s.kind === "black") {
      return { kind: "black" as const, duration: s.t1 - s.t0 };
    }
    return {
      kind: "clip" as const,
      source_path: s.sourcePath,
      source_start: s.sourceStart,
      duration: s.t1 - s.t0,
      scale: s.transform.scale,
      x: s.transform.x,
      y: s.transform.y,
      src_w: s.srcW,
      src_h: s.srcH,
      has_audio: s.hasAudio,
      bed_source_path: s.bedAudio?.sourcePath ?? null,
      bed_source_start: s.bedAudio?.sourceStart ?? null,
    };
  });
  return {
    canvas_width: project.canvas.width,
    canvas_height: project.canvas.height,
    segments: segs,
    output_path: outputPath,
  };
}
