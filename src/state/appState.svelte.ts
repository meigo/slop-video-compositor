import { addClip, findClip } from "$lib/clips";
import { toExportOpts } from "$lib/exportPayload";
import {
  canRedo,
  canUndo,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  type History,
} from "$lib/history";
import { newId } from "$lib/id";
import {
  createProject,
  defaultTransform,
  projectDuration,
} from "$lib/project";
import {
  checkDeps,
  defaultExportDir,
  exportProject,
  loadSettings,
  openProjectFile,
  pickExportPath,
  pickVideoFile,
  pickVideoFiles,
  probeMedia,
  revealInFolder,
  saveProjectFileAs,
  saveSettings,
  toSourceMeta,
  writeProjectFile,
} from "$lib/tauri";
import type {
  AppSettings,
  Clip,
  ClipTransform,
  DepsStatus,
  Project,
  SourceMeta,
} from "$lib/types";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

function initialProject(): Project {
  return createProject();
}

const boot = initialProject();

export const app = $state({
  history: historyInit(boot) as History<Project>,
  playhead: 0,
  selectedClipId: null as string | null,
  selectedTrackId: boot.tracks[0]?.id ?? "",
  metaByPath: new Map<string, SourceMeta>(),
  projectPath: null as string | null,
  dirty: false,
  deps: null as DepsStatus | null,
  status: "Ready",
  exporting: false,
  playing: false,
  /** When true, preview playback is silent. Default false so clip audio is audible. */
  previewMuted: false,
  checkingDeps: true,
  lastProjectDir: null as string | null,
  lastExportDir: null as string | null,
});

export function project(): Project {
  return app.history.present;
}

export function duration(): number {
  return projectDuration(project());
}

export function selectedClip(): Clip | null {
  const id = app.selectedClipId;
  if (!id) return null;
  return findClip(project(), id)?.clip ?? null;
}

export function selectedMeta(): SourceMeta | null {
  const clip = selectedClip();
  if (!clip) return null;
  return app.metaByPath.get(clip.sourcePath) ?? null;
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : path;
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function syncSelection(p: Project) {
  if (app.selectedClipId && !findClip(p, app.selectedClipId)) {
    app.selectedClipId = null;
  }
  if (!p.tracks.some((t) => t.id === app.selectedTrackId)) {
    app.selectedTrackId = p.tracks[0]?.id ?? "";
  }
}

/** Apply a project mutation: push history and mark dirty. */
export function commitProject(next: Project) {
  app.history = historyPush(app.history, next);
  app.dirty = true;
  syncSelection(next);
}

export function replaceClip(p: Project, clipId: string, clip: Clip): Project {
  return {
    ...p,
    tracks: p.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => (c.id === clipId ? clip : c)),
    })),
  };
}

export function undo() {
  if (!canUndo(app.history)) return;
  app.history = historyUndo(app.history);
  app.dirty = true;
  app.playing = false;
  syncSelection(app.history.present);
  app.status = "Undid";
}

export function redo() {
  if (!canRedo(app.history)) return;
  app.history = historyRedo(app.history);
  app.dirty = true;
  app.playing = false;
  syncSelection(app.history.present);
  app.status = "Redid";
}

function confirmDiscardIfDirty(action: string): boolean {
  if (!app.dirty) return true;
  return window.confirm(`Discard unsaved changes and ${action}?`);
}

export function newProject() {
  if (!confirmDiscardIfDirty("create a new project")) return;
  const p = initialProject();
  app.history = historyInit(p);
  app.playhead = 0;
  app.selectedClipId = null;
  app.selectedTrackId = p.tracks[0]?.id ?? "";
  app.metaByPath = new Map();
  app.projectPath = null;
  app.dirty = false;
  app.playing = false;
  app.status = "New project";
}

export async function openProject() {
  if (!confirmDiscardIfDirty("open another project")) return;
  try {
    const result = await openProjectFile(app.lastProjectDir);
    if (!result) return;
    app.history = historyInit(result.project);
    app.projectPath = result.path;
    app.playhead = 0;
    app.selectedClipId = null;
    app.selectedTrackId = result.project.tracks[0]?.id ?? "";
    app.metaByPath = new Map();
    app.dirty = false;
    app.playing = false;
    app.lastProjectDir = dirname(result.path);
    app.status = `Opened ${basename(result.path)}`;
    await persistSettings();
    await reprobeAllSources();
  } catch (e) {
    app.status = `Open failed: ${errMsg(e)}`;
  }
}

export async function saveProject() {
  try {
    if (app.projectPath) {
      await writeProjectFile(app.projectPath, project());
      app.dirty = false;
      app.status = `Saved ${basename(app.projectPath)}`;
      await persistSettings();
      return;
    }
    await saveProjectAs();
  } catch (e) {
    app.status = `Save failed: ${errMsg(e)}`;
  }
}

export async function saveProjectAs() {
  try {
    const path = await saveProjectFileAs(project(), app.projectPath ?? app.lastProjectDir);
    if (!path) return;
    app.projectPath = path;
    app.dirty = false;
    app.lastProjectDir = dirname(path);
    app.status = `Saved ${basename(path)}`;
    await persistSettings();
  } catch (e) {
    app.status = `Save As failed: ${errMsg(e)}`;
  }
}

export async function importVideos() {
  try {
    const paths = await pickVideoFiles(app.lastProjectDir);
    if (paths.length === 0) return;

    let p = project();
    let trackId = app.selectedTrackId;
    if (!p.tracks.some((t) => t.id === trackId)) {
      trackId = p.tracks[0]?.id ?? "";
      app.selectedTrackId = trackId;
    }
    if (!trackId) {
      app.status = "No track to import onto";
      return;
    }

    let added = 0;
    let failed = 0;
    let lastClipId: string | null = null;

    for (const path of paths) {
      try {
        const media = await probeMedia(path);
        const meta = toSourceMeta(path, media);
        app.metaByPath.set(path, meta);
        // reassign Map for reactivity
        app.metaByPath = new Map(app.metaByPath);

        const clip: Clip = {
          id: newId(),
          sourcePath: path,
          sourceIn: 0,
          sourceOut: meta.duration,
          timelineStart: app.playhead,
          transform: defaultTransform(),
        };
        p = addClip(p, trackId, clip);
        lastClipId = clip.id;
        added++;
        app.lastProjectDir = dirname(path);
      } catch (e) {
        failed++;
        app.status = `Probe failed (${basename(path)}): ${errMsg(e)}`;
      }
    }

    if (added > 0) {
      commitProject(p);
      if (lastClipId) app.selectedClipId = lastClipId;
      await persistSettings();
      const failNote = failed > 0 ? `, ${failed} failed` : "";
      app.status = `Imported ${added} clip${added === 1 ? "" : "s"}${failNote}`;
    } else if (failed > 0) {
      app.status = `Import failed (${failed} file${failed === 1 ? "" : "s"})`;
    }
  } catch (e) {
    app.status = `Import failed: ${errMsg(e)}`;
  }
}

/** True when export is allowed (ffmpeg present, timeline non-empty, not mid-export). */
export function canExport(): boolean {
  if (app.exporting) return false;
  if (app.deps && !app.deps.ffmpeg) return false;
  const p = project();
  if (projectDuration(p) <= 0) return false;
  return p.tracks.some((t) => t.clips.length > 0);
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${file}` : `${dir}${sep}${file}`;
}

function safeExportName(name: string): string {
  const base = name.trim() || "export";
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) + ".mp4";
}

type ProgressPayload = { phase: string; message: string; pct: number | null };

/** Validate sources, pick path, export via ffmpeg, reveal on success. */
export async function exportVideo() {
  if (app.exporting) return;
  if (app.deps && !app.deps.ffmpeg) {
    app.status = "Export requires ffmpeg";
    return;
  }

  const p = project();
  if (projectDuration(p) <= 0 || !p.tracks.some((t) => t.clips.length > 0)) {
    app.status = "Nothing to export — add clips first";
    return;
  }

  const paths = new Set<string>();
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      paths.add(clip.sourcePath);
    }
  }

  // Always re-probe every unique path so deleted/moved files fail here, not in ffmpeg.
  const missing: string[] = [];
  const nextMeta = new Map(app.metaByPath);
  for (const path of paths) {
    try {
      const media = await probeMedia(path);
      nextMeta.set(path, toSourceMeta(path, media));
    } catch {
      missing.push(path);
    }
  }
  if (missing.length > 0) {
    app.metaByPath = nextMeta;
    const list = missing.map(basename).join(", ");
    app.status = `Missing sources (${missing.length}): ${list}`;
    return;
  }
  app.metaByPath = nextMeta;

  let dir = app.lastExportDir;
  if (!dir) {
    try {
      dir = await defaultExportDir();
    } catch {
      dir = null;
    }
  }
  const suggested = dir ? joinPath(dir, safeExportName(p.name)) : safeExportName(p.name);

  let outputPath: string | null;
  try {
    outputPath = await pickExportPath(suggested);
  } catch (e) {
    app.status = `Export dialog failed: ${errMsg(e)}`;
    return;
  }
  if (!outputPath) return;
  if (!outputPath.toLowerCase().endsWith(".mp4")) {
    outputPath = `${outputPath}.mp4`;
  }

  let unlisten: UnlistenFn | null = null;
  app.exporting = true;
  app.status = "Exporting…";
  try {
    unlisten = await listen<ProgressPayload>("export-progress", (event) => {
      const { phase, message, pct } = event.payload;
      if (pct != null && Number.isFinite(pct)) {
        app.status = `Export ${phase}: ${message} (${Math.round(pct * 100)}%)`;
      } else {
        app.status = `Export ${phase}: ${message}`;
      }
    });

    const opts = toExportOpts(p, app.metaByPath, outputPath);
    const result = await exportProject(opts);
    app.lastExportDir = dirname(result.output_path);
    await persistSettings();
    try {
      await revealInFolder(result.output_path);
    } catch {
      // non-fatal
    }
    app.status = `Exported ${basename(result.output_path)}`;
  } catch (e) {
    app.status = `Export failed: ${errMsg(e)}`;
  } finally {
    if (unlisten) {
      try {
        unlisten();
      } catch {
        // ignore
      }
    }
    app.exporting = false;
  }
}

/** Snap to even integers ≥ 2 so yuv420p / libx264 never sees odd canvas sizes. */
function evenCanvasDim(n: number): number {
  if (!Number.isFinite(n) || n < 2) return 2;
  return Math.max(2, Math.floor(n / 2) * 2);
}

export function setCanvasSize(width: number, height: number) {
  if (!(width > 0) || !(height > 0)) return;
  const w = evenCanvasDim(width);
  const h = evenCanvasDim(height);
  const p = project();
  if (p.canvas.width === w && p.canvas.height === h) return;
  commitProject({
    ...p,
    canvas: { width: w, height: h },
  });
  app.status = `Canvas ${w}×${h}`;
}

export function setPlayhead(t: number) {
  app.playhead = Math.max(0, t);
}

export function setSelectedClip(id: string | null) {
  app.selectedClipId = id;
}

export function setSelectedTrack(id: string) {
  app.selectedTrackId = id;
}

export function updateSelectedClipFields(patch: {
  sourceIn?: number;
  sourceOut?: number;
  timelineStart?: number;
  transform?: Partial<ClipTransform>;
}) {
  const id = app.selectedClipId;
  if (!id) return;
  const found = findClip(project(), id);
  if (!found) return;

  const prev = found.clip;
  let sourceIn = patch.sourceIn ?? prev.sourceIn;
  let sourceOut = patch.sourceOut ?? prev.sourceOut;
  // When media duration is known, keep sourceOut within the file.
  const meta = app.metaByPath.get(prev.sourcePath);
  if (meta && Number.isFinite(meta.duration)) {
    sourceOut = Math.min(sourceOut, meta.duration);
  }
  if (!(sourceOut > sourceIn)) return;

  const next: Clip = {
    ...prev,
    sourceIn,
    sourceOut,
    timelineStart: patch.timelineStart ?? prev.timelineStart,
    transform: patch.transform
      ? { ...prev.transform, ...patch.transform }
      : prev.transform,
  };
  commitProject(replaceClip(project(), id, next));
}

export function resetSelectedTransform() {
  updateSelectedClipFields({ transform: defaultTransform() });
  app.status = "Transform reset";
}

export async function relinkSelected() {
  const id = app.selectedClipId;
  if (!id) return;
  const found = findClip(project(), id);
  if (!found) return;

  try {
    const path = await pickVideoFile(dirname(found.clip.sourcePath));
    if (!path) return;
    const media = await probeMedia(path);
    const meta = toSourceMeta(path, media);
    app.metaByPath.set(path, meta);
    app.metaByPath = new Map(app.metaByPath);

    const next: Clip = {
      ...found.clip,
      sourcePath: path,
      // Keep existing in/out if still valid against new duration
      sourceIn: Math.min(found.clip.sourceIn, Math.max(0, meta.duration - 0.001)),
      sourceOut: Math.min(found.clip.sourceOut, meta.duration),
    };
    if (!(next.sourceOut > next.sourceIn)) {
      next.sourceIn = 0;
      next.sourceOut = meta.duration;
    }
    commitProject(replaceClip(project(), id, next));
    app.status = `Relinked ${basename(path)}`;
  } catch (e) {
    app.status = `Relink failed: ${errMsg(e)}`;
  }
}

export async function refreshDeps() {
  app.checkingDeps = true;
  try {
    app.deps = await checkDeps();
    if (app.deps.ffmpeg) {
      app.status = "Ready";
    } else {
      app.status = "ffmpeg not found";
    }
  } catch (e) {
    app.deps = { ffmpeg: false, ffmpeg_path: null };
    app.status = `Deps check failed: ${errMsg(e)}`;
  } finally {
    app.checkingDeps = false;
  }
}

async function reprobeAllSources() {
  const paths = new Set<string>();
  for (const track of project().tracks) {
    for (const clip of track.clips) {
      paths.add(clip.sourcePath);
    }
  }
  const next = new Map(app.metaByPath);
  for (const path of paths) {
    try {
      const media = await probeMedia(path);
      next.set(path, toSourceMeta(path, media));
    } catch {
      // leave missing; inspector shows warning
    }
  }
  app.metaByPath = next;
}

async function persistSettings() {
  try {
    const settings: AppSettings = {
      last_export_dir: app.lastExportDir,
      last_project_dir: app.lastProjectDir,
    };
    await saveSettings(settings);
  } catch {
    // non-fatal
  }
}

export async function initApp() {
  await refreshDeps();
  try {
    const settings = await loadSettings();
    app.lastExportDir = settings.last_export_dir;
    app.lastProjectDir = settings.last_project_dir;
  } catch {
    // defaults
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export { canUndo, canRedo };
