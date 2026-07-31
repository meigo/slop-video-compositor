import { basename } from "./pathUtil";
import { DEFAULT_PROJECT_NAME, projectDuration } from "./project";
import type { Project } from "./types";

/** Drop the last extension. A leading dot is kept so dotfiles survive intact. */
function fileStem(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? fileName.slice(0, i) : fileName;
}

/**
 * Label the export after the project: an explicit name wins, then the saved
 * project file, then a generic fallback. `project.name` is only meaningful once
 * something has set it — a fresh project always carries DEFAULT_PROJECT_NAME.
 */
function exportLabel(project: Project, projectPath: string | null): string {
  const name = project.name.trim();
  if (name && name !== DEFAULT_PROJECT_NAME) return name;
  if (projectPath) {
    const stem = fileStem(basename(projectPath)).trim();
    if (stem) return stem;
  }
  return "export";
}

/** Suggested export filename: `<label>_<duration>_<n>clip.mp4`. */
export function defaultExportFileName(project: Project, projectPath: string | null): string {
  const base = exportLabel(project, projectPath).replace(
    /[<>:"/\\|?*\u0000-\u001f]/g,
    "_",
  );
  const dur = projectDuration(project);
  const durTag = dur >= 1 ? `${Math.round(dur)}s` : `${Math.round(dur * 10) / 10}s`;
  let clips = 0;
  for (const t of project.tracks) clips += t.clips.length;
  const stem = `${base.slice(0, 48)}_${durTag}_${clips}clip`.replace(/\s+/g, "_");
  return `${stem}.mp4`;
}
