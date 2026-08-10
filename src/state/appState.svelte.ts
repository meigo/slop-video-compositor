import {
  addClip,
  addTrack,
  clampProjectSourcesToMedia,
  deleteClips,
  findClip,
  overwriteWithClip,
} from "$lib/clips";
import { nextCut, prevCut } from "$lib/cuts";
import {
  effectivePlayBounds,
  hasExplicitPlayRange,
  type PlayBounds,
} from "$lib/playRange";
import { defaultExportFileName } from "$lib/exportName";
import { toExportOpts } from "$lib/exportPayload";
import {
  canRedo,
  canUndo,
  historyCommitEdit,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  type History,
} from "$lib/history";
import { newId } from "$lib/id";
import {
  addMarker,
  clipDuration,
  contentDuration,
  createProject,
  defaultTransform,
  evenCanvasDim,
  parseProject,
  PROJECT_FPS,
  projectDuration,
  removeMarker,
  renameMarker,
  serializeProject,
  setProjectDuration,
  snapToFrame,
  trackContentEnd,
  withEffectiveDuration,
} from "$lib/project";
import { clamp } from "$lib/time";
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
  readTextFile,
  revealInFolder,
  saveProjectFileAs,
  saveSettings,
  toSourceMeta,
  writeProjectFile,
  writeTextFile,
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

export type ImportPlacement = "append" | "playhead" | "new-tracks";

export const app = $state({
  history: historyInit(boot) as History<Project>,
  playhead: 0,
  /** Primary selection (Inspector / split target) — last clicked. */
  selectedClipId: null as string | null,
  /** Multi-select set; always contains selectedClipId when non-empty. */
  selectedClipIds: [] as string[],
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
  /**
   * Preview-only: when set, hard-cut resolve uses only this track (solo).
   * Export always uses the full project.
   */
  previewSoloTrackId: null as string | null,
  /** Preview-only: when true, playback wraps to play-in instead of stopping at play-out. */
  loopPlayback: false,
  /**
   * Preview-only play range (session). `null` = unset (full sequence for that end).
   * Not saved with the project; export still uses full program out.
   */
  playIn: null as number | null,
  playOut: null as number | null,
  checkingDeps: true,
  lastProjectDir: null as string | null,
  lastExportDir: null as string | null,
  /** Timeline panel height (px). Default applied in the shell layout. */
  timelineHeightPx: 200,
  /** Where multi-import places clips. */
  importPlacement: "append" as ImportPlacement,
  /** Clipboard for copy/paste (clip bodies without id; may be multi). */
  clipboard: null as Omit<Clip, "id">[] | null,
  /** Paths that failed last probe (open/import). */
  missingSources: [] as string[],
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

export function selectedClipDurationSecs(): number | null {
  const clip = selectedClip();
  if (!clip) return null;
  return clipDuration(clip);
}

/** Project view for preview: solo track clears other tracks' clips. */
export function previewProject(): Project {
  const p = project();
  const solo = app.previewSoloTrackId;
  if (!solo) return p;
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.id === solo ? t : { ...t, clips: [] })),
  };
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : path;
}

import { basename, truncateMiddle } from "$lib/pathUtil";
export { basename, truncateMiddle };

function syncSelection(p: Project) {
  app.selectedClipIds = app.selectedClipIds.filter((id) => findClip(p, id));
  if (app.selectedClipId && !findClip(p, app.selectedClipId)) {
    app.selectedClipId = app.selectedClipIds[app.selectedClipIds.length - 1] ?? null;
  } else if (app.selectedClipId && !app.selectedClipIds.includes(app.selectedClipId)) {
    app.selectedClipIds = [...app.selectedClipIds, app.selectedClipId];
  }
  if (!p.tracks.some((t) => t.id === app.selectedTrackId)) {
    app.selectedTrackId = p.tracks[0]?.id ?? "";
  }
}

/** Replace selection with one clip (or clear). */
export function selectClipOnly(clipId: string | null, trackId?: string) {
  if (!clipId) {
    app.selectedClipId = null;
    app.selectedClipIds = [];
    return;
  }
  app.selectedClipId = clipId;
  app.selectedClipIds = [clipId];
  if (trackId) app.selectedTrackId = trackId;
}

/** Cmd/Ctrl-click: toggle clip in multi-select; becomes primary when added. */
export function toggleClipInSelection(clipId: string, trackId?: string) {
  const has = app.selectedClipIds.includes(clipId);
  if (has) {
    app.selectedClipIds = app.selectedClipIds.filter((id) => id !== clipId);
    app.selectedClipId =
      app.selectedClipId === clipId
        ? (app.selectedClipIds[app.selectedClipIds.length - 1] ?? null)
        : app.selectedClipId;
  } else {
    app.selectedClipIds = [...app.selectedClipIds, clipId];
    app.selectedClipId = clipId;
    if (trackId) app.selectedTrackId = trackId;
  }
}

export function isClipSelected(clipId: string): boolean {
  return app.selectedClipIds.includes(clipId);
}

export function clearClipSelection() {
  app.selectedClipId = null;
  app.selectedClipIds = [];
}

/** Fingerprint of last saved / loaded / new project for accurate dirty tracking. */
let savedFingerprint = serializeProject(initialProject());

function markCleanFromPresent() {
  savedFingerprint = serializeProject(project());
  app.dirty = false;
}

function refreshDirty() {
  app.dirty = serializeProject(project()) !== savedFingerprint;
}

/** Apply a project mutation: push history and mark dirty. */
export function commitProject(next: Project) {
  const normalized = withEffectiveDuration(next);
  app.history = historyPush(app.history, normalized);
  refreshDirty();
  syncSelection(normalized);
}

/**
 * Finish a live drag (timeline/preview/duration): `before` is the pre-drag snapshot;
 * `after` is the final project (present may already equal after from setPresentLive).
 * Returns false if nothing changed (restores `before` without a history entry).
 */
export function commitProjectEdit(before: Project, after: Project): boolean {
  const normalized = withEffectiveDuration(after);
  if (serializeProject(before) === serializeProject(normalized)) {
    app.history = { ...app.history, present: before };
    refreshDirty();
    syncSelection(before);
    return false;
  }
  app.history = historyCommitEdit(app.history, before, normalized);
  refreshDirty();
  syncSelection(normalized);
  return true;
}

/** Live preview during drag — does not push undo (finish with commitProjectEdit). */
export function setPresentLive(next: Project) {
  app.history = { ...app.history, present: next };
  app.dirty = true;
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
  refreshDirty();
  app.playing = false;
  syncSelection(app.history.present);
  app.status = "Undid";
}

export function redo() {
  if (!canRedo(app.history)) return;
  app.history = historyRedo(app.history);
  refreshDirty();
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
  app.selectedClipIds = [];
  app.selectedTrackId = p.tracks[0]?.id ?? "";
  app.metaByPath = new Map();
  app.projectPath = null;
  app.missingSources = [];
  app.previewSoloTrackId = null;
  markCleanFromPresent();
  app.playing = false;
  app.status = "New project";
  stopAutosave();
}

export async function openProject() {
  if (!confirmDiscardIfDirty("open another project")) return;
  try {
    const result = await openProjectFile(app.lastProjectDir);
    if (!result) return;
    const diskFp = serializeProject(result.project);
    app.history = historyInit(result.project);
    app.projectPath = result.path;
    app.playhead = 0;
    app.selectedClipId = null;
    app.selectedClipIds = [];
    app.selectedTrackId = result.project.tracks[0]?.id ?? "";
    app.metaByPath = new Map();
    app.previewSoloTrackId = null;
    savedFingerprint = diskFp;
    app.dirty = false;
    app.playing = false;
    app.lastProjectDir = dirname(result.path);
    app.status = `Opened ${basename(result.path)}`;
    await persistSettings();

    const recovered = await tryRecoverAutosave(result.path, diskFp);
    await reprobeAllSources();
    if (!recovered && app.missingSources.length === 0) {
      app.status = `Opened ${basename(result.path)}`;
    }
    scheduleAutosave();
  } catch (e) {
    app.status = `Open failed: ${errMsg(e)}`;
  }
}

export async function saveProject() {
  try {
    if (app.projectPath) {
      await writeProjectFile(app.projectPath, project());
      markCleanFromPresent();
      app.status = `Saved ${basename(app.projectPath)}`;
      await persistSettings();
      await clearAutosaveBeside(app.projectPath);
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
    markCleanFromPresent();
    app.lastProjectDir = dirname(path);
    app.status = `Saved ${basename(path)}`;
    await persistSettings();
    await clearAutosaveBeside(path);
    scheduleAutosave();
  } catch (e) {
    app.status = `Save As failed: ${errMsg(e)}`;
  }
}

export async function importVideos(placement: ImportPlacement = app.importPlacement) {
  try {
    const paths = await pickVideoFiles(app.lastProjectDir);
    if (paths.length === 0) return;

    let p = project();
    let trackId = app.selectedTrackId;
    if (!p.tracks.some((t) => t.id === trackId)) {
      trackId = p.tracks[0]?.id ?? "";
      app.selectedTrackId = trackId;
    }
    if (!trackId && placement !== "new-tracks") {
      app.status = "No track to import onto";
      return;
    }

    let added = 0;
    let failed = 0;
    let lastClipId: string | null = null;
    /** Running end for append mode on the active track. */
    let appendAt = trackId ? trackContentEnd(p, trackId) : 0;

    for (const path of paths) {
      try {
        const media = await probeMedia(path);
        const meta = toSourceMeta(path, media);
        app.metaByPath.set(path, meta);
        app.metaByPath = new Map(app.metaByPath);

        let destTrackId = trackId;
        if (placement === "new-tracks") {
          p = addTrack(p);
          destTrackId = p.tracks[p.tracks.length - 1]!.id;
          appendAt = 0;
        }

        let timelineStart = app.playhead;
        if (placement === "append" || placement === "new-tracks") {
          timelineStart = placement === "new-tracks" ? 0 : appendAt;
        }

        const clip: Clip = {
          id: newId(),
          sourcePath: path,
          sourceIn: 0,
          sourceOut: meta.duration,
          timelineStart,
          transform: defaultTransform(),
          muted: false,
        };
        p = addClip(p, destTrackId, clip);
        lastClipId = clip.id;
        if (placement === "append") {
          appendAt = timelineStart + meta.duration;
        }
        if (placement === "new-tracks") {
          app.selectedTrackId = destTrackId;
        }
        added++;
        app.lastProjectDir = dirname(path);
      } catch (e) {
        failed++;
        app.status = `Probe failed (${basename(path)}): ${errMsg(e)}`;
      }
    }

    if (added > 0) {
      commitProject(p);
      if (lastClipId) selectClipOnly(lastClipId);
      await persistSettings();
      const failNote = failed > 0 ? `, ${failed} failed` : "";
      const mode =
        placement === "new-tracks"
          ? " as tracks"
          : placement === "append"
            ? " (appended)"
            : "";
      app.status = `Imported ${added} clip${added === 1 ? "" : "s"}${mode}${failNote}`;
      scheduleAutosave();
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

type ProgressPayload = { phase: string; message: string; pct: number | null };

/** Validate sources, pick path, export via ffmpeg, reveal on success. */
export async function exportVideo() {
  if (app.exporting) return;
  if (app.deps && !app.deps.ffmpeg) {
    app.status = "Export requires ffmpeg";
    return;
  }

  let p = project();
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

  // Keep source ranges inside probed media so ffmpeg trim matches the timeline.
  const clamped = clampProjectSourcesToMedia(p, nextMeta);
  if (clamped.invalidIds.length > 0) {
    app.status = `Export blocked: ${clamped.invalidIds.length} clip(s) lie past media end — trim or relink`;
    return;
  }
  if (clamped.changed) {
    commitProject(clamped.project);
    p = project();
  }

  let dir = app.lastExportDir;
  if (!dir) {
    try {
      dir = await defaultExportDir();
    } catch {
      dir = null;
    }
  }
  const name = defaultExportFileName(p, app.projectPath);
  const suggested = dir ? joinPath(dir, name) : name;

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

/** Set sequence length (seconds). Shorter than content trims/deletes clip tails. */
export function setTimelineDuration(secs: number) {
  const p = project();
  const next = setProjectDuration(p, secs);
  if (next === p) return;
  commitProject(next);
  // Keep playhead inside the sequence
  if (app.playhead > projectDuration(next)) {
    app.playhead = projectDuration(next);
  }
  const d = projectDuration(next);
  app.status =
    secs < contentDuration(p)
      ? `Sequence out ${d.toFixed(2)}s (trimmed)`
      : `Timeline ${d.toFixed(2)}s`;
}

export function setPlayhead(t: number) {
  const max = projectDuration(project());
  app.playhead = Math.min(max, Math.max(0, t));
}

export function toggleLoopPlayback() {
  app.loopPlayback = !app.loopPlayback;
  app.status = app.loopPlayback ? "Loop on" : "Loop off";
}

/** Effective preview playback window (session play range or full sequence). */
export function playBounds(): PlayBounds {
  return effectivePlayBounds(app.playIn, app.playOut, projectDuration(project()));
}

export function setPlayInAtPlayhead() {
  app.playIn = app.playhead;
  // Keep a valid window if both ends exist and crossed.
  if (app.playOut != null && app.playIn > app.playOut) {
    app.playOut = app.playIn;
  }
  const b = playBounds();
  app.status = `Play in ${b.start.toFixed(2)}s`;
}

export function setPlayOutAtPlayhead() {
  app.playOut = app.playhead;
  if (app.playIn != null && app.playOut < app.playIn) {
    app.playIn = app.playOut;
  }
  const b = playBounds();
  app.status = `Play out ${b.end.toFixed(2)}s`;
}

export function clearPlayRange() {
  if (app.playIn == null && app.playOut == null) {
    app.status = "No play range set";
    return;
  }
  app.playIn = null;
  app.playOut = null;
  app.status = "Play range cleared";
}

export function hasPlayRange(): boolean {
  return hasExplicitPlayRange(app.playIn, app.playOut);
}

/**
 * Step the playhead by whole frames at `PROJECT_FPS` (export rate).
 * Pauses playback. Positive = forward, negative = backward.
 */
export function stepPlayheadFrames(frames: number, fps = PROJECT_FPS) {
  if (!Number.isFinite(frames) || frames === 0) return;
  app.playing = false;
  const max = projectDuration(project());
  const curFrame = Math.round(app.playhead * fps);
  const next = (curFrame + frames) / fps;
  app.playhead = Math.min(max, Math.max(0, snapToFrame(next, fps)));
}

/** Step by whole seconds (snapped to frame grid). */
export function stepPlayheadSeconds(secs: number, fps = PROJECT_FPS) {
  if (!Number.isFinite(secs) || secs === 0) return;
  stepPlayheadFrames(Math.round(secs * fps), fps);
}

export function seekPlayheadHome() {
  app.playing = false;
  const { start } = playBounds();
  setPlayhead(start);
  app.status = hasPlayRange()
    ? `Playhead play-in ${start.toFixed(2)}s`
    : "Playhead 0";
}

export function seekPlayheadEnd() {
  app.playing = false;
  const { end } = playBounds();
  setPlayhead(end);
  app.status = hasPlayRange()
    ? `Playhead play-out ${end.toFixed(2)}s`
    : `Playhead ${end.toFixed(2)}s`;
}

export function seekPrevCut() {
  app.playing = false;
  const t = prevCut(project(), app.playhead);
  setPlayhead(t);
  app.status = `Cut ${t.toFixed(2)}s`;
}

export function seekNextCut() {
  app.playing = false;
  const t = nextCut(project(), app.playhead);
  setPlayhead(t);
  app.status = `Cut ${t.toFixed(2)}s`;
}

export function setSelectedClip(id: string | null) {
  selectClipOnly(id);
}

export function setSelectedTrack(id: string) {
  app.selectedTrackId = id;
}

export function deleteSelectedClips() {
  const ids =
    app.selectedClipIds.length > 0
      ? app.selectedClipIds
      : app.selectedClipId
        ? [app.selectedClipId]
        : [];
  if (ids.length === 0) return;
  const next = deleteClips(project(), ids);
  if (next === project()) return;
  commitProject(next);
  clearClipSelection();
  app.status = ids.length === 1 ? "Deleted clip" : `Deleted ${ids.length} clips`;
}

export function toggleSoloTrack(trackId: string) {
  if (app.previewSoloTrackId === trackId) {
    app.previewSoloTrackId = null;
    app.status = "Solo off";
  } else {
    app.previewSoloTrackId = trackId;
    app.selectedTrackId = trackId;
    app.status = "Solo track (preview only)";
  }
}

export function copySelectedClip() {
  const p = project();
  const ids =
    app.selectedClipIds.length > 0
      ? app.selectedClipIds
      : app.selectedClipId
        ? [app.selectedClipId]
        : [];
  const bodies: Omit<Clip, "id">[] = [];
  for (const id of ids) {
    const found = findClip(p, id);
    if (!found) continue;
    const { id: _id, ...rest } = found.clip;
    bodies.push({ ...rest, transform: { ...rest.transform } });
  }
  if (bodies.length === 0) {
    app.status = "Nothing to copy";
    return;
  }
  app.clipboard = bodies;
  app.status = bodies.length === 1 ? "Copied clip" : `Copied ${bodies.length} clips`;
}

export function pasteClipboard() {
  if (!app.clipboard || app.clipboard.length === 0) {
    app.status = "Clipboard empty";
    return;
  }
  let p0 = project();
  const minStart = Math.min(...app.clipboard.map((c) => c.timelineStart));
  const newIds: string[] = [];

  // Paste onto selected track; keep relative timeline offsets within the set.
  let trackId = app.selectedTrackId;
  if (!p0.tracks.some((t) => t.id === trackId)) {
    trackId = p0.tracks[0]?.id ?? "";
  }
  if (!trackId) return;

  for (const body of app.clipboard) {
    const clip: Clip = {
      ...body,
      id: newId(),
      timelineStart: app.playhead + (body.timelineStart - minStart),
      transform: { ...body.transform },
    };
    p0 = addClip(p0, trackId, clip);
    newIds.push(clip.id);
  }

  commitProject(p0);
  app.selectedClipIds = newIds;
  app.selectedClipId = newIds[newIds.length - 1] ?? null;
  app.status = newIds.length === 1 ? "Pasted clip" : `Pasted ${newIds.length} clips`;
}

export function duplicateSelectedClip() {
  copySelectedClip();
  if (app.clipboard?.length) pasteClipboard();
}

export function addMarkerAtPlayhead(label = "") {
  commitProject(addMarker(project(), app.playhead, label));
  app.status = "Marker added";
}

export function deleteMarker(markerId: string) {
  const next = removeMarker(project(), markerId);
  if (next === project()) return;
  commitProject(next);
  app.status = "Marker removed";
}

export function renameMarkerLabel(markerId: string, label: string) {
  const next = renameMarker(project(), markerId, label);
  if (next === project()) return;
  commitProject(next);
  app.status = "Marker renamed";
}

export async function revealSelectedSource() {
  const clip = selectedClip();
  if (!clip) {
    app.status = "No clip selected";
    return;
  }
  try {
    await revealInFolder(clip.sourcePath);
    app.status = `Revealed ${basename(clip.sourcePath)}`;
  } catch (e) {
    app.status = `Reveal failed: ${errMsg(e)}`;
  }
}

export function updateSelectedClipFields(patch: {
  sourceIn?: number;
  sourceOut?: number;
  timelineStart?: number;
  transform?: Partial<ClipTransform>;
  muted?: boolean;
}) {
  const id = app.selectedClipId;
  if (!id) return;
  const found = findClip(project(), id);
  if (!found) return;

  const prev = found.clip;
  let sourceIn = patch.sourceIn ?? prev.sourceIn;
  let sourceOut = patch.sourceOut ?? prev.sourceOut;
  let timelineStart = patch.timelineStart ?? prev.timelineStart;

  if (!Number.isFinite(sourceIn)) sourceIn = prev.sourceIn;
  if (!Number.isFinite(sourceOut)) sourceOut = prev.sourceOut;
  if (!Number.isFinite(timelineStart)) timelineStart = prev.timelineStart;

  sourceIn = Math.max(0, sourceIn);
  timelineStart = Math.max(0, timelineStart);

  // When media duration is known, keep the source range inside the file.
  const meta = app.metaByPath.get(prev.sourcePath);
  if (meta && Number.isFinite(meta.duration) && meta.duration > 0) {
    sourceIn = clamp(sourceIn, 0, meta.duration);
    sourceOut = clamp(sourceOut, 0, meta.duration);
  }
  if (!(sourceOut > sourceIn)) return;

  const next: Clip = {
    ...prev,
    sourceIn,
    sourceOut,
    timelineStart,
    muted: patch.muted !== undefined ? patch.muted : prev.muted,
    transform: patch.transform
      ? { ...prev.transform, ...patch.transform }
      : prev.transform,
  };
  // Timing edits can create same-track overlaps — overwrite neighbors (clip wins).
  commitProject(overwriteWithClip(replaceClip(project(), id, next), id));
  if (patch.muted !== undefined) {
    app.status = patch.muted ? "Clip muted" : "Clip unmuted";
  }
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
  const missing: string[] = [];
  for (const path of paths) {
    try {
      const media = await probeMedia(path);
      next.set(path, toSourceMeta(path, media));
    } catch {
      missing.push(path);
    }
  }
  app.metaByPath = next;
  app.missingSources = missing;
  if (missing.length > 0) {
    app.status = `Opened with ${missing.length} missing source${missing.length === 1 ? "" : "s"} — relink in Inspector`;
  }
}

function autosavePathFor(projectPath: string): string {
  if (projectPath.toLowerCase().endsWith(".json")) {
    return projectPath.slice(0, -5) + ".autosave.json";
  }
  return `${projectPath}.autosave.json`;
}

async function clearAutosaveBeside(projectPath: string) {
  try {
    // Overwrite with empty not possible without delete command — write a tiny stub or skip.
    // Prefer writing nothing: try write empty object cleared flag is overkill. No-op if no path.
    void projectPath;
  } catch {
    // ignore
  }
}

let autosaveTimer: ReturnType<typeof setInterval> | null = null;

function stopAutosave() {
  if (autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
}

function scheduleAutosave() {
  stopAutosave();
  autosaveTimer = setInterval(() => {
    void maybeAutosave();
  }, 45_000);
}

async function maybeAutosave() {
  if (!app.dirty || app.exporting) return;
  const path = app.projectPath;
  if (!path) return;
  try {
    await writeTextFile(autosavePathFor(path), serializeProject(project()));
  } catch {
    // non-fatal
  }
}

/** Offer recovery if `.autosave.json` exists beside the opened project. */
async function tryRecoverAutosave(projectPath: string, diskFingerprint: string): Promise<boolean> {
  const autoPath = autosavePathFor(projectPath);
  try {
    const raw = await readTextFile(autoPath);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return false;
    }
    const restored = parseProject(json);
    const autoFp = serializeProject(restored);
    if (autoFp === diskFingerprint) return false;
    if (!window.confirm("Found an autosave that differs from this project. Restore it?")) {
      return false;
    }
    app.history = historyInit(restored);
    savedFingerprint = diskFingerprint;
    app.dirty = true;
    app.status = "Restored from autosave";
    return true;
  } catch {
    return false;
  }
}

async function persistSettings() {
  try {
    const settings: AppSettings = {
      last_export_dir: app.lastExportDir,
      last_project_dir: app.lastProjectDir,
      timeline_height_px: Math.round(app.timelineHeightPx),
    };
    await saveSettings(settings);
  } catch {
    // non-fatal
  }
}

const TIMELINE_H_MIN = 120;
const TIMELINE_H_DEFAULT = 200;

export function clampTimelineHeight(px: number): number {
  const max = Math.max(TIMELINE_H_MIN, Math.floor(window.innerHeight * 0.6));
  if (!Number.isFinite(px)) return TIMELINE_H_DEFAULT;
  return Math.min(max, Math.max(TIMELINE_H_MIN, Math.round(px)));
}

/** Update timeline panel height and persist (debounced by callers if needed). */
export function setTimelineHeight(px: number, persist = true) {
  app.timelineHeightPx = clampTimelineHeight(px);
  if (persist) void persistSettings();
}

export async function initApp() {
  await refreshDeps();
  try {
    const settings = await loadSettings();
    app.lastExportDir = settings.last_export_dir;
    app.lastProjectDir = settings.last_project_dir;
    if (
      settings.timeline_height_px != null &&
      Number.isFinite(settings.timeline_height_px) &&
      settings.timeline_height_px > 0
    ) {
      app.timelineHeightPx = clampTimelineHeight(settings.timeline_height_px);
    }
  } catch {
    // defaults
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export { canUndo, canRedo };
