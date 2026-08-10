import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ExportOpts } from "./exportPayload";
import { parseProject, serializeProject } from "./project";
import type {
  AppSettings,
  DepsStatus,
  ExportResult,
  MediaMeta,
  Project,
  SourceMeta,
} from "./types";

export type { AppSettings, DepsStatus, ExportResult, MediaMeta };

export const checkDeps = () => invoke<DepsStatus>("check_deps");

export const probeMedia = (path: string) =>
  invoke<MediaMeta>("probe_media", { path });

/** Map Rust MediaMeta → SourceMeta by attaching the source path. */
export function toSourceMeta(path: string, meta: MediaMeta): SourceMeta {
  return {
    path,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    hasAudio: meta.has_audio,
  };
}

/** Probe reported no video stream (audio-only import / relink). */
export function isAudioOnlyMeta(
  meta: Pick<SourceMeta, "width" | "height"> | null | undefined,
): boolean {
  return !!meta && (meta.width === 0 || meta.height === 0);
}

export const exportProject = (opts: ExportOpts) =>
  invoke<ExportResult>("export_project", { opts });

export const loadSettings = () => invoke<AppSettings>("load_settings");

export const saveSettings = (settings: AppSettings) =>
  invoke<void>("save_settings", { settings });

export const defaultExportDir = () => invoke<string>("default_export_dir");

export const revealInFolder = (path: string) =>
  invoke<void>("reveal_in_folder", { path });

export const readTextFile = (path: string) =>
  invoke<string>("read_text_file", { path });

export const writeTextFile = (path: string, contents: string) =>
  invoke<void>("write_text_file", { path, contents });

const PROJECT_FILTERS = [{ name: "Slop project", extensions: ["json"] }];

/** Open a project JSON via file dialog. Returns null if cancelled. */
export async function openProjectFile(
  defaultPath?: string | null,
): Promise<{ path: string; project: Project } | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: PROJECT_FILTERS,
    defaultPath: defaultPath ?? undefined,
    title: "Open project",
  });
  if (selected === null || Array.isArray(selected)) return null;
  const path = selected;
  const raw = await readTextFile(path);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid project JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const project = parseProject(json);
  return { path, project };
}

/** Write project JSON to an existing path. */
export async function writeProjectFile(path: string, project: Project): Promise<void> {
  await writeTextFile(path, serializeProject(project));
}

/**
 * Save-as dialog then write project JSON.
 * Returns the chosen path, or null if cancelled.
 */
export async function saveProjectFileAs(
  project: Project,
  defaultPath?: string | null,
): Promise<string | null> {
  const path = await save({
    filters: PROJECT_FILTERS,
    defaultPath: defaultPath ?? undefined,
    title: "Save project",
  });
  if (path === null) return null;
  await writeProjectFile(path, project);
  return path;
}

const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "m4v", "avi"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif"];

const MEDIA_FILTERS = [
  {
    name: "Media",
    extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS],
  },
  {
    name: "Video",
    extensions: VIDEO_EXTENSIONS,
  },
  {
    name: "Audio",
    extensions: AUDIO_EXTENSIONS,
  },
];

/** Multi-select video/audio files for import. Returns [] if cancelled. */
export async function pickVideoFiles(
  defaultPath?: string | null,
): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: MEDIA_FILTERS,
    defaultPath: defaultPath ?? undefined,
    title: "Import media",
  });
  if (selected === null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** Single video/audio file for relink. Returns null if cancelled. */
export async function pickVideoFile(
  defaultPath?: string | null,
): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: MEDIA_FILTERS,
    defaultPath: defaultPath ?? undefined,
    title: "Relink media",
  });
  if (selected === null || Array.isArray(selected)) return null;
  return selected;
}

/** Save dialog for export MP4 path. Returns null if cancelled. */
export async function pickExportPath(
  defaultPath?: string | null,
): Promise<string | null> {
  return save({
    filters: [{ name: "MP4 video", extensions: ["mp4"] }],
    defaultPath: defaultPath ?? undefined,
    title: "Export video",
  });
}
