# Default export filename — design

Date: 2026-07-31
Status: approved

## Problem

The export dialog's suggested filename is built by `safeExportName()` in
`src/state/appState.svelte.ts`, which already labels the file with `project.name`:

```
<project.name>_<duration>_<n>clip.mp4
```

But `project.name` is **always `"Untitled"`** in practice. `createProject()` sets it, and nothing
ever changes it — there is no rename UI, and `saveProjectAs` does not derive it from the path the
user picks. Only a hand-edited project JSON can carry a real name. So saving a project as
`beach-edit.json` still suggests `Untitled_12s_3clip.mp4`.

## Solution

Widen where the export label comes from. Precedence:

1. `project.name`, when set to something other than the default
2. the project file's stem — `/x/beach-edit.json` → `beach-edit`
3. `"export"`

Name-before-filename means a project that genuinely carries a name (hand-authored JSON, or a
rename control added later) is not overridden by whatever the file happens to be called.

Out of scope: a rename UI, and setting `project.name` from the path on save. Both remain open
options that this precedence order already accommodates.

## Detecting "no name"

`src/lib/project.ts` gains:

```ts
export const DEFAULT_PROJECT_NAME = "Untitled";
```

and `createProject` takes it as its default parameter (`createProject(name = DEFAULT_PROJECT_NAME)`).
The check becomes `name && name !== DEFAULT_PROJECT_NAME` rather than a magic string.

## New module

`safeExportName` is pure string logic with several edge cases and no tests, currently buried in
`appState.svelte.ts` — at 1042 lines, over twice the size of the next-largest module. Move it to
its own tested module, matching the codebase's existing small-lib pattern (`cuts.ts`, `snap.ts`,
`previewTime.ts`, `pathUtil.ts`).

`src/lib/exportName.ts`:

```ts
/** Default export filename: `<label>_<duration>_<n>clip.mp4`. */
export function defaultExportFileName(project: Project, projectPath: string | null): string
```

Two private helpers in the same file — `fileStem(fileName)` (strip the last extension) and
`exportLabel(project, projectPath)` (the precedence above). `fileStem` stays private rather than
joining `basename` in `pathUtil.ts`: it has one caller.

The body of `defaultExportFileName` is the current `safeExportName` unchanged — illegal-character
sanitizing (`/[<>:"/\\|?*\u0000-\u001f]/g` → `_`), the duration tag (`12s` for ≥ 1s, `0.4s`
below), the clip count across all tracks, the 48-character cap on the label, and whitespace →
underscore. Only the label source changes.

`appState.svelte.ts` deletes its private `safeExportName` and calls
`defaultExportFileName(p, app.projectPath)` in `exportVideo`. `joinPath` stays where it is — it
has one caller and is not part of this concern.

## Behavior change

An unsaved, never-named project currently suggests `Untitled_10s_2clip.mp4`; it becomes
`export_10s_2clip.mp4`, because `Untitled` now reads as "no name". Saved projects are the case
that improves.

## Edge cases

| Input | Result |
| --- | --- |
| Unsaved, name `Untitled` | `export_10s_0clip.mp4` |
| Name `Untitled`, path `/x/beach-edit.json` | `beach-edit_10s_0clip.mp4` |
| Name `Beach Montage`, path `/x/proj.json` | `Beach_Montage_10s_0clip.mp4` (name wins; space → `_`) |
| Path `/x/beach.edit.v2.json` | `beach.edit.v2_…` (only the last extension is stripped) |
| Path `/x/proj` (no extension) | `proj_…` |
| Path `C:\x\beach.json` | `beach_…` (`basename` already handles `\`) |
| Name `a/b:c` | `a_b_c_…` |
| Name longer than 48 chars | capped at 48 before the suffix |
| Duration 0.4s | `_0.4s_` |

`fileStem` strips the last extension only when the dot is not the first character, so a dotfile
keeps its name. A path that is *nothing but* an extension (`/x/.json`) is not handled specially —
the save dialog cannot produce one, and guarding it would be dead code.

## Testing

`src/lib/exportName.test.ts` covers every row of the table above, plus a clip-count case
(clips across two tracks → `_2clip`). No test changes elsewhere: `safeExportName` had none.

## Files touched

- `src/lib/project.ts` — `DEFAULT_PROJECT_NAME`, used as `createProject`'s default
- `src/lib/exportName.ts` — new
- `src/lib/exportName.test.ts` — new
- `src/state/appState.svelte.ts` — drop `safeExportName`, call `defaultExportFileName`
