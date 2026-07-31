# Default Export Filename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the export dialog's suggested filename reflect the project — its name when set, otherwise the saved `.json` file's name — instead of always `Untitled_…`.

**Architecture:** The existing `safeExportName()` in `src/state/appState.svelte.ts` already formats `<label>_<duration>_<n>clip.mp4`; it just always receives `"Untitled"` as the label because nothing sets `project.name`. Move that pure string logic into its own tested module and widen the label to a three-step fallback: explicit project name → project file stem → `"export"`.

**Tech Stack:** TypeScript, Vitest, SvelteKit 2 / Svelte 5 runes, Tauri 2.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-export-filename-design.md`.
- Label precedence is exactly: `project.name` (when set to something other than the default) → project file stem → `"export"`. Name beats filename.
- The **format** of the filename is unchanged: `<label>_<durationTag>_<n>clip.mp4`, label sanitized with `/[<>:"/\\|?*\u0000-\u001f]/g` → `_`, capped at 48 chars, whitespace → `_`; `durationTag` is `${Math.round(dur)}s` when `dur >= 1` and `${Math.round(dur * 10) / 10}s` otherwise.
- Out of scope: a project rename UI, and setting `project.name` from the path on save.
- Follow surrounding style: 2-space indent, double quotes, `./x` relative imports inside `src/lib`, JSDoc `/** */` on exported functions explaining *why*.
- Test command `npm test` (Vitest). Type check `npm run check`.
- Do not reformat adjacent code. Leave `joinPath` in `appState.svelte.ts` where it is — it has one caller and is not part of this concern.

---

### Task 1: `exportName` module

A pure, tested module that owns the suggested-filename logic. Delivers the new behavior in isolation; Task 2 switches the app over to it.

**Files:**
- Modify: `src/lib/project.ts:4-8` (constants block) and `createProject` at line 30
- Create: `src/lib/exportName.ts`
- Create: `src/lib/exportName.test.ts`

**Interfaces:**
- Consumes: `basename(path: string): string` from `./pathUtil`; `projectDuration(p: Project): number` from `./project`; the `Project` type from `./types`.
- Produces:
  - `export const DEFAULT_PROJECT_NAME = "Untitled"` in `src/lib/project.ts`
  - `export function defaultExportFileName(project: Project, projectPath: string | null): string` in `src/lib/exportName.ts` — called by Task 2.

- [ ] **Step 1: Add the default-name constant**

In `src/lib/project.ts`, add to the constants block after `DEFAULT_DURATION` (line 6):

```ts
/** Name a fresh project carries until something sets one. Treated as "unnamed". */
export const DEFAULT_PROJECT_NAME = "Untitled";
```

Then change the `createProject` signature (line 30) from:

```ts
export function createProject(name = "Untitled"): Project {
```

to:

```ts
export function createProject(name = DEFAULT_PROJECT_NAME): Project {
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/exportName.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultExportFileName } from "./exportName";
import { createProject, defaultTransform } from "./project";
import type { Clip, Project } from "./types";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    sourcePath: "/a.mp4",
    sourceIn: 0,
    sourceOut: 2,
    timelineStart: 0,
    transform: defaultTransform(),
    ...over,
  };
}

/** Fresh project: name "Untitled", duration 10, two empty tracks. */
function proj(over: Partial<Project> = {}): Project {
  return { ...createProject(), ...over };
}

describe("defaultExportFileName", () => {
  it("falls back to a generic label when unsaved and unnamed", () => {
    expect(defaultExportFileName(proj(), null)).toBe("export_10s_0clip.mp4");
  });

  it("uses the project file stem when the name is still the default", () => {
    expect(defaultExportFileName(proj(), "/x/beach-edit.json")).toBe(
      "beach-edit_10s_0clip.mp4",
    );
  });

  it("prefers an explicit project name over the filename", () => {
    expect(defaultExportFileName(proj({ name: "Beach Montage" }), "/x/proj.json")).toBe(
      "Beach_Montage_10s_0clip.mp4",
    );
  });

  it("strips only the last extension", () => {
    expect(defaultExportFileName(proj(), "/x/beach.edit.v2.json")).toBe(
      "beach.edit.v2_10s_0clip.mp4",
    );
  });

  it("handles a path with no extension", () => {
    expect(defaultExportFileName(proj(), "/x/proj")).toBe("proj_10s_0clip.mp4");
  });

  it("handles a Windows-style path", () => {
    expect(defaultExportFileName(proj(), "C:\\x\\beach.json")).toBe(
      "beach_10s_0clip.mp4",
    );
  });

  it("sanitizes characters that are illegal in filenames", () => {
    expect(defaultExportFileName(proj({ name: "a/b:c" }), null)).toBe(
      "a_b_c_10s_0clip.mp4",
    );
  });

  it("caps a long label at 48 characters", () => {
    const long = "x".repeat(60);
    expect(defaultExportFileName(proj({ name: long }), null)).toBe(
      `${"x".repeat(48)}_10s_0clip.mp4`,
    );
  });

  it("uses a decimal tag for sub-second durations", () => {
    expect(defaultExportFileName(proj({ duration: 0.4 }), null)).toBe(
      "export_0.4s_0clip.mp4",
    );
  });

  it("counts clips across all tracks", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "a" }));
    p.tracks[1].clips.push(clip({ id: "b" }));
    expect(defaultExportFileName(p, null)).toBe("export_10s_2clip.mp4");
  });
});
```

Note: `createProject()` returns `duration: 10` and two empty tracks (`V1`, `V2`), and
`projectDuration` is `max(contentDuration, stored)` — so a project with two 2-second clips at
`timelineStart: 0` still reports 10s, which is why the last case expects `_10s_2clip`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- exportName`
Expected: FAIL — `Failed to resolve import "./exportName"`, since the module does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `src/lib/exportName.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- exportName`
Expected: PASS — all 10 cases.

- [ ] **Step 6: Run the full suite and type check**

Run: `npm test && npm run check`
Expected: all test files pass; `0 ERRORS 0 WARNINGS`. `createProject`'s behavior is unchanged (same default string via the new constant), so existing `project.test.ts` cases still pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/project.ts src/lib/exportName.ts src/lib/exportName.test.ts
git commit -m "feat: add defaultExportFileName with project-name and file-stem fallback"
```

---

### Task 2: Use it in the export flow

Switch `exportVideo` over and delete the superseded private helper.

**Files:**
- Modify: `src/state/appState.svelte.ts` — import block (the `$lib/project` import at lines 22-38), `safeExportName` at lines 467-476, call site at line 541

**Interfaces:**
- Consumes: `defaultExportFileName(project: Project, projectPath: string | null): string` from `$lib/exportName` (Task 1).
- Produces: nothing for later tasks.

- [ ] **Step 1: Import the new function**

In `src/state/appState.svelte.ts`, add a new import beside the other `$lib` imports, alphabetically before the `$lib/exportPayload` import:

```ts
import { defaultExportFileName } from "$lib/exportName";
```

- [ ] **Step 2: Delete the private helper**

Remove this entire function (lines 467-476), leaving `joinPath` directly above it untouched:

```ts
function safeExportName(project: Project): string {
  const base = (project.name.trim() || "export").replace(
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
```

- [ ] **Step 3: Update the call site**

At line 541 in `exportVideo`, replace:

```ts
  const suggested = dir ? joinPath(dir, safeExportName(p)) : safeExportName(p);
```

with:

```ts
  const name = defaultExportFileName(p, app.projectPath);
  const suggested = dir ? joinPath(dir, name) : name;
```

- [ ] **Step 4: Type check and test**

Run: `npm run check && npm test`
Expected: `0 ERRORS 0 WARNINGS` and all tests pass. If `svelte-check` reports `projectDuration` as an unused import in `appState.svelte.ts`, check whether anything else in the file still calls it — `canExport`, `exportVideo`, `setTimelineDuration`, and `setPlayhead` all do, so the import must stay.

- [ ] **Step 5: Manually verify the suggested name**

Run: `npm run tauri dev`

1. Import a clip (⌘I), then Export without saving the project → the dialog suggests `export_<dur>s_1clip.mp4` (previously `Untitled_…`). Cancel the dialog.
2. Save the project as `beach-edit.json` (⌘S), then Export → the dialog suggests `beach-edit_<dur>s_1clip.mp4`. Cancel.
3. Open a project JSON whose `"name"` field has been hand-edited to `Beach Montage`, then Export → the dialog suggests `Beach_Montage_<dur>s_<n>clip.mp4`, ignoring the file's own name.

- [ ] **Step 6: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: suggest export name from project name or project file"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Label precedence (name → file stem → `export`) | Task 1, step 4 (`exportLabel`) |
| `DEFAULT_PROJECT_NAME` + `createProject` default | Task 1, step 1 |
| New `exportName.ts` module with `fileStem` / `exportLabel` private | Task 1, step 4 |
| Format preserved verbatim from `safeExportName` | Task 1, step 4; Global Constraints |
| `appState` drops `safeExportName`, calls the new function | Task 2, steps 2-3 |
| `joinPath` stays put | Task 2, step 2 (explicit) and Global Constraints |
| Behavior change (`Untitled_…` → `export_…`) | Task 1 test case 1; Task 2 step 5 case 1 |
| Every edge-case table row | Task 1, step 2 — one test each |

**Placeholder scan:** none — every step carries literal code or a command.

**Type consistency:** `defaultExportFileName(project: Project, projectPath: string | null): string` is defined in Task 1 and called in Task 2 as `defaultExportFileName(p, app.projectPath)`, where `p` is `Project` and `app.projectPath` is `string | null` — matches. `DEFAULT_PROJECT_NAME` is exported from `project.ts` in Task 1 and imported by `exportName.ts` in the same task.
