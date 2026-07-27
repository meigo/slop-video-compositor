# Slop Video Compositor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a macOS-first Tauri 2 + Svelte desktop app that loads local video clips onto multi-track timeline, hard-cuts them with per-clip scale/position framing, saves a JSON project with absolute paths, and exports one H.264+AAC MP4 for slop-animator reference use.

**Architecture:** Svelte 5 UI owns the timeline model, preview (`<video>` + canvas), and edit ops. Tauri/Rust checks `ffmpeg`, probes media, and runs a segment-encode + concat export pipeline. Pure TS (resolve, flatten, transform, edit geometry) and pure Rust (filter args, concat lists) are unit-tested without real encodes in CI.

**Tech Stack:** Tauri 2, SvelteKit (adapter-static) or Svelte + Vite (match downloader: SvelteKit), TypeScript, Vitest, Rust + cargo test, system ffmpeg on PATH.

## Global Constraints

- Hard cut only — higher track wins; no transitions/PiP/blend.
- External `ffmpeg` on PATH only — do not bundle binaries.
- Project file: JSON + absolute source paths; media not embedded.
- Export: H.264 + AAC `.mp4`, canvas W×H, audio always muxed, output fps **30**.
- Default canvas: 1920×1080. Default export folder: last used, else `~/Movies/Slop Refs`.
- Per-clip transform: uniform `scale` + `x`/`y` only (default `{ scale: 1, x: 0, y: 0 }` = contain-fit center).
- No user-facing FPS conversion feature.
- macOS first; Finder reveal is the only Mac-specific convenience.
- Spec: `docs/superpowers/specs/2026-07-27-slop-video-compositor-design.md`.
- Preserve existing `docs/` when scaffolding; never delete design/plan docs.
- No live network in unit tests; no required real-ffmpeg in unit tests.

## File structure

```
slop-video-compositor/
  package.json
  vite.config.js
  vitest.config.ts
  svelte.config.js
  tsconfig.json
  src/
    app.css
    app.html
    lib/
      types.ts              # Project, Track, Clip, ClipTransform, SourceMeta, Segment
      time.ts               # formatTimestamp, clamp
      id.ts                 # newId()
      transform.ts          # containFitRect / drawRect math
      resolve.ts            # clipAtTime hard-cut
      flatten.ts            # project → Segment[]
      clips.ts              # move, trim, split, delete pure ops
      project.ts            # createProject, parseProject, serialize, duration
      history.ts            # simple undo stack
      tauri.ts              # invoke wrappers
      components/
        MissingDeps.svelte
        Toolbar.svelte
        Preview.svelte
        Inspector.svelte
        Timeline.svelte
        Transport.svelte
        StatusLine.svelte
    routes/
      +layout.ts            # ssr = false
      +page.svelte          # main shell / state
    state/
      appState.svelte.ts    # runes store: project, selection, playhead, meta cache
  src-tauri/
    Cargo.toml
    tauri.conf.json
    capabilities/default.json
    src/
      main.rs
      lib.rs
      deps.rs
      probe.rs
      settings.rs
      export.rs             # segment encode + concat + arg builders
      geometry.rs           # transform → draw rect (mirror TS; used by export)
  README.md
  docs/superpowers/...      # already exists — keep
```

---

### Task 1: Scaffold Tauri 2 + Svelte app around existing docs

**Files:**
- Create: full Tauri/SvelteKit project at repo root
- Keep: `docs/superpowers/**`
- Create: `README.md` stub (expand in final task)

**Interfaces:**
- Produces: `npm run tauri dev` boots a window; `npm test` may be added in Task 2

- [ ] **Step 1: Scaffold without wiping docs**

```bash
cd /Users/meigo/Projects/slop/slop-video-compositor

npm create tauri-app@latest /tmp/slop-vc-scaffold -- --template svelte-ts --manager npm --yes
# If interactive: name slop-video-compositor, identifier com.slop.video-compositor,
# Svelte + TypeScript, npm.

rsync -a --exclude docs --exclude .git /tmp/slop-vc-scaffold/ ./
```

If the scaffold is plain Svelte (not SvelteKit), that is fine — keep one stack and stick to it for all later paths. Prefer matching **slop-video-downloader** (SvelteKit + adapter-static) when choosing options.

Set in `src-tauri/tauri.conf.json`:
- `productName`: `Slop Video Compositor`
- `identifier`: `com.slop.video-compositor`
- window title: `Slop Video Compositor`
- Enable `tauri-plugin-dialog` and opener like the downloader
- Asset protocol enabled with broad scope if local file preview needs `convertFileSrc`

- [ ] **Step 2: Install and cargo check**

```bash
npm install
cd src-tauri && cargo check
```

Expected: success (first run may download crates).

- [ ] **Step 3: Smoke-run**

```bash
npm run tauri dev
```

Expected: empty scaffold window opens. Quit.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri 2 + Svelte app"
```

---

### Task 2: Types, time helpers, ids + Vitest

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/time.ts`
- Create: `src/lib/id.ts`
- Create: `src/lib/time.test.ts`
- Create: `vitest.config.ts` (if missing)
- Modify: `package.json` — add `vitest`, script `"test": "vitest run"`

**Interfaces:**
- Produces types (exact shapes from spec):

```ts
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
```

- `formatTimestamp(secs: number): string` — `MM:SS` or `H:MM:SS`
- `clamp(n, min, max): number`
- `newId(): string` — `crypto.randomUUID()` when available, else fallback

- [ ] **Step 1: Add Vitest**

```bash
npm install -D vitest
```

`package.json` script: `"test": "vitest run"`.

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 2: Write failing time tests**

```ts
// src/lib/time.test.ts
import { describe, it, expect } from "vitest";
import { formatTimestamp, clamp } from "./time";

describe("formatTimestamp", () => {
  it("formats under an hour as MM:SS", () => {
    expect(formatTimestamp(72)).toBe("01:12");
  });
  it("formats hours", () => {
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });
});

describe("clamp", () => {
  it("clamps to range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npm test
```

- [ ] **Step 4: Implement `types.ts`, `time.ts`, `id.ts`**

```ts
// src/lib/time.ts
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function formatTimestamp(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const s = Math.floor(secs % 60);
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/time.ts src/lib/id.ts src/lib/time.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: add types, time helpers, and vitest"
```

---

### Task 3: Project create / duration / parse / serialize

**Files:**
- Create: `src/lib/project.ts`
- Create: `src/lib/project.test.ts`

**Interfaces:**
- Consumes: `Project`, `Track`, `Clip`, `newId`
- Produces:
  - `DEFAULT_CANVAS = { width: 1920, height: 1080 }`
  - `defaultTransform(): ClipTransform` → `{ scale: 1, x: 0, y: 0 }`
  - `createProject(name?: string): Project` — version 1, two tracks `V1`/`V2` (V2 higher index = wins), empty clips
  - `clipDuration(c: Clip): number`
  - `projectDuration(p: Project): number`
  - `parseProject(json: unknown): Project` — throws on invalid
  - `serializeProject(p: Project): string` — `JSON.stringify` pretty

Track order convention: `tracks[tracks.length - 1]` is top / highest priority (V2 when created as `[V1, V2]`).

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/project.test.ts
import { describe, it, expect } from "vitest";
import {
  createProject,
  projectDuration,
  clipDuration,
  parseProject,
  serializeProject,
  defaultTransform,
} from "./project";
import type { Clip, Project } from "./types";

function sampleClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    sourcePath: "/tmp/a.mp4",
    sourceIn: 1,
    sourceOut: 4,
    timelineStart: 2,
    transform: defaultTransform(),
    ...over,
  };
}

describe("createProject", () => {
  it("starts with two tracks and default canvas", () => {
    const p = createProject("Test");
    expect(p.version).toBe(1);
    expect(p.canvas).toEqual({ width: 1920, height: 1080 });
    expect(p.tracks).toHaveLength(2);
    expect(p.tracks[0].name).toBe("V1");
    expect(p.tracks[1].name).toBe("V2");
  });
});

describe("projectDuration", () => {
  it("is 0 when empty", () => {
    expect(projectDuration(createProject())).toBe(0);
  });
  it("uses max timeline end", () => {
    const p = createProject();
    p.tracks[0].clips.push(sampleClip({ timelineStart: 0, sourceIn: 0, sourceOut: 5 }));
    p.tracks[1].clips.push(sampleClip({ id: "c2", timelineStart: 3, sourceIn: 0, sourceOut: 4 }));
    // c1 ends 5, c2 ends 7
    expect(projectDuration(p)).toBe(7);
  });
});

describe("parse/serialize", () => {
  it("round-trips", () => {
    const p = createProject("R");
    p.tracks[0].clips.push(sampleClip());
    const again = parseProject(JSON.parse(serializeProject(p)));
    expect(again.name).toBe("R");
    expect(again.tracks[0].clips[0].sourcePath).toBe("/tmp/a.mp4");
  });
  it("rejects bad version", () => {
    expect(() => parseProject({ version: 99, name: "x", canvas: { width: 1, height: 1 }, tracks: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- src/lib/project.test.ts
```

- [ ] **Step 3: Implement `project.ts`**

Validate in `parseProject`:
- `version === 1`
- `canvas.width/height` positive numbers
- each clip: `sourceOut > sourceIn`, finite numbers, non-empty `sourcePath`
- tracks array present

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- src/lib/project.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/project.ts src/lib/project.test.ts
git commit -m "feat: project create, duration, parse, serialize"
```

---

### Task 4: Hard-cut resolve + timeline flatten

**Files:**
- Create: `src/lib/resolve.ts`
- Create: `src/lib/flatten.ts`
- Create: `src/lib/resolve.test.ts`
- Create: `src/lib/flatten.test.ts`

**Interfaces:**
- Consumes: `Project`, `Clip`, `SourceMeta` map
- Produces:
  - `clipAtTime(project: Project, t: number): { trackId: string; clip: Clip } | null`
  - `flattenProject(project: Project, metaByPath: Map<string, SourceMeta>): Segment[]`

`clipAtTime`: among clips with `timelineStart <= t < timelineStart + (sourceOut - sourceIn)`, pick the one on the highest-index track. If multiple on same track, pick any stable rule (prefer latest `timelineStart`, or first in array — document: **first matching clip in track.clips order** is wrong for overlaps on same track; use **the clip with greatest timelineStart among matches on that track**, then higher track still wins across tracks). Spec: higher **track** wins; same-track overlap: prefer the clip that starts later (or topmost in list — lock: **last clip in `track.clips` that covers t**).

`flattenProject`:
- Let `T = projectDuration(project)`. If `T <= 0`, return `[]`.
- Collect critical times: `0`, `T`, and every clip `timelineStart` / `timelineEnd`.
- Sort unique times; for each interval `[t_i, t_{i+1})`, resolve winner; emit clip or black segment.
- Merge adjacent identical clip segments when same `clipId` and continuous source time.
- For clip segments, fill `srcW/srcH/hasAudio` from `metaByPath`; if meta missing, still emit segment with `srcW/srcH = 0`, `hasAudio = false` (export will fail earlier on missing files).

- [ ] **Step 1: Write resolve tests**

```ts
// src/lib/resolve.test.ts
import { describe, it, expect } from "vitest";
import { createProject, defaultTransform } from "./project";
import { clipAtTime } from "./resolve";
import type { Clip } from "./types";

function clip(p: Partial<Clip> & Pick<Clip, "id" | "timelineStart" | "sourceIn" | "sourceOut">): Clip {
  return {
    sourcePath: "/a.mp4",
    transform: defaultTransform(),
    ...p,
  };
}

describe("clipAtTime", () => {
  it("returns null on empty", () => {
    expect(clipAtTime(createProject(), 0)).toBeNull();
  });
  it("higher track wins on overlap", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "low", timelineStart: 0, sourceIn: 0, sourceOut: 10 }));
    p.tracks[1].clips.push(clip({ id: "high", timelineStart: 2, sourceIn: 0, sourceOut: 4 }));
    expect(clipAtTime(p, 1)?.clip.id).toBe("low");
    expect(clipAtTime(p, 3)?.clip.id).toBe("high");
    expect(clipAtTime(p, 7)?.clip.id).toBe("low");
  });
  it("gap returns null", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "a", timelineStart: 0, sourceIn: 0, sourceOut: 2 }));
    p.tracks[0].clips.push(clip({ id: "b", timelineStart: 5, sourceIn: 0, sourceOut: 2 }));
    expect(clipAtTime(p, 3)).toBeNull();
  });
});
```

- [ ] **Step 2: Write flatten tests**

```ts
// src/lib/flatten.test.ts
import { describe, it, expect } from "vitest";
import { createProject, defaultTransform } from "./project";
import { flattenProject } from "./flatten";
import type { SourceMeta } from "./types";

const meta = new Map<string, SourceMeta>([
  ["/a.mp4", { path: "/a.mp4", duration: 100, width: 1920, height: 1080, hasAudio: true }],
]);

describe("flattenProject", () => {
  it("emits black for gaps", () => {
    const p = createProject();
    p.tracks[0].clips.push({
      id: "a",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    p.tracks[0].clips.push({
      id: "b",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 5,
      transform: defaultTransform(),
    });
    const segs = flattenProject(p, meta);
    expect(segs.some((s) => s.kind === "black" && s.t0 === 2 && s.t1 === 5)).toBe(true);
  });
  it("higher track wins in middle", () => {
    const p = createProject();
    p.tracks[0].clips.push({
      id: "low",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 10,
      timelineStart: 0,
      transform: defaultTransform(),
    });
    p.tracks[1].clips.push({
      id: "high",
      sourcePath: "/a.mp4",
      sourceIn: 0,
      sourceOut: 2,
      timelineStart: 4,
      transform: defaultTransform(),
    });
    const segs = flattenProject(p, meta).filter((s) => s.kind === "clip");
    const mid = segs.find((s) => s.kind === "clip" && s.t0 === 4);
    expect(mid && mid.kind === "clip" && mid.clipId).toBe("high");
  });
});
```

- [ ] **Step 3: Run — FAIL, implement, PASS**

```bash
npm test -- src/lib/resolve.test.ts src/lib/flatten.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/resolve.ts src/lib/flatten.ts src/lib/resolve.test.ts src/lib/flatten.test.ts
git commit -m "feat: hard-cut resolve and timeline flatten"
```

---

### Task 5: Transform geometry (contain-fit + scale/pan)

**Files:**
- Create: `src/lib/transform.ts`
- Create: `src/lib/transform.test.ts`

**Interfaces:**
- Produces:

```ts
export type DrawRect = { x: number; y: number; w: number; h: number };

/** Draw rect of source on canvas given transform (spec formulas). */
export function drawRect(
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  transform: ClipTransform,
): DrawRect;
```

Formulas from spec:

```
fitScale = min(canvasW / srcW, canvasH / srcH)
drawW = srcW * fitScale * transform.scale
drawH = srcH * fitScale * transform.scale
drawX = (canvasW - srcW * fitScale) / 2 + transform.x
drawY = (canvasH - srcH * fitScale) / 2 + transform.y
```

If `srcW` or `srcH` is 0, return `{ x: 0, y: 0, w: 0, h: 0 }`.

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from "vitest";
import { drawRect } from "./transform";

describe("drawRect", () => {
  it("contain-fits 1920x1080 into same canvas at identity", () => {
    const r = drawRect(1920, 1080, 1920, 1080, { scale: 1, x: 0, y: 0 });
    expect(r).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
  it("letterboxes wide canvas for square source", () => {
    const r = drawRect(100, 100, 200, 100, { scale: 1, x: 0, y: 0 });
    // fitScale = min(2, 1) = 1 → 100x100 centered → x=50
    expect(r.w).toBe(100);
    expect(r.h).toBe(100);
    expect(r.x).toBe(50);
    expect(r.y).toBe(0);
  });
  it("applies scale and pan", () => {
    const r = drawRect(100, 100, 200, 100, { scale: 2, x: 10, y: -5 });
    expect(r.w).toBe(200);
    expect(r.h).toBe(200);
    expect(r.x).toBe(50 + 10); // center base 50 + pan
    expect(r.y).toBe(0 - 5);
  });
});
```

- [ ] **Step 2: Implement + pass + commit**

```bash
git add src/lib/transform.ts src/lib/transform.test.ts
git commit -m "feat: contain-fit transform geometry"
```

---

### Task 6: Clip edit operations (move, trim, split, delete)

**Files:**
- Create: `src/lib/clips.ts`
- Create: `src/lib/clips.test.ts`

**Interfaces:**
- Produces pure functions that return a **new** `Project` (immutable style):

```ts
export function findClip(project: Project, clipId: string): { trackIndex: number; clipIndex: number; clip: Clip } | null;

export function moveClip(
  project: Project,
  clipId: string,
  timelineStart: number,
  toTrackId?: string,
): Project;

/** Left edge trim: newSourceIn, keeps timeline visual right edge stable when possible. */
export function trimClipIn(project: Project, clipId: string, newSourceIn: number): Project;

export function trimClipOut(project: Project, clipId: string, newSourceOut: number): Project;

/** Split clip at absolute timeline time t. No-op if t not strictly inside clip. */
export function splitClip(project: Project, clipId: string, t: number): Project;

export function deleteClip(project: Project, clipId: string): Project;

export function addClip(project: Project, trackId: string, clip: Clip): Project;

export function addTrack(project: Project, name?: string): Project;
```

**Left-trim math** (NLE-style):  
Given clip with `sourceIn`, `sourceOut`, `timelineStart`, set `newSourceIn` clamped to `[0, sourceOut)` (caller may also clamp to media duration later).  
`delta = newSourceIn - sourceIn`  
`timelineStart' = timelineStart + delta`  
`sourceIn' = newSourceIn`  
Require `sourceIn' < sourceOut`.

**Right-trim:** `newSourceOut` with `sourceIn < newSourceOut`; `timelineStart` unchanged.

**Split at timeline `t`:**  
`local = t - timelineStart`  
require `0 < local < duration`  
Left: `sourceOut = sourceIn + local`  
Right: new id, `sourceIn' = sourceIn + local`, `sourceOut` same as old, `timelineStart = t`, same path/transform.

- [ ] **Step 1: Write tests for move, trim left/right, split, delete, addTrack**

Include: split produces two clips covering same range; delete leaves gap (duration may shrink if was last); higher-track addTrack appends to `tracks`.

- [ ] **Step 2: Implement + pass + commit**

```bash
git add src/lib/clips.ts src/lib/clips.test.ts
git commit -m "feat: clip move, trim, split, delete ops"
```

---

### Task 7: In-memory undo history

**Files:**
- Create: `src/lib/history.ts`
- Create: `src/lib/history.test.ts`

**Interfaces:**

```ts
export type History<T> = { past: T[]; present: T; future: T[] };

export function historyInit<T>(present: T): History<T>;
/** Push present onto past, set new present, clear future. Cap past at max (e.g. 50). */
export function historyPush<T>(h: History<T>, next: T, max = 50): History<T>;
export function historyUndo<T>(h: History<T>): History<T>;
export function historyRedo<T>(h: History<T>): History<T>;
export function canUndo<T>(h: History<T>): boolean;
export function canRedo<T>(h: History<T>): boolean;
```

Deep-clone projects when pushing from the store (JSON parse/stringify is fine for v1).

- [ ] **Step 1: Tests** — push/undo/redo/clear future on new push
- [ ] **Step 2: Implement + pass + commit**

```bash
git add src/lib/history.ts src/lib/history.test.ts
git commit -m "feat: undo/redo history helper"
```

---

### Task 8: Rust deps, settings, probe_media

**Files:**
- Create/modify: `src-tauri/src/deps.rs`
- Create: `src-tauri/src/settings.rs`
- Create: `src-tauri/src/probe.rs`
- Modify: `src-tauri/src/lib.rs` — register commands
- Modify: `src-tauri/Cargo.toml` — `serde`, `serde_json`, `dirs`, `tauri-plugin-dialog`, `tauri-plugin-opener` as in downloader
- Modify: capabilities for dialog/opener/fs as needed

**Interfaces:**

```rust
// deps
check_deps() -> DepsStatus { ffmpeg: bool, ffmpeg_path: Option<String> }

// settings
struct AppSettings { last_export_dir: Option<String>, last_project_dir: Option<String> }
load_settings() -> AppSettings
save_settings(settings: AppSettings) -> Result<(), String>
default_export_dir() -> String  // ~/Movies/Slop Refs
reveal_in_folder(path: String) -> Result<(), String>

// probe via ffmpeg -i (parse stderr) or ffprobe if present
probe_media(path: String) -> Result<MediaMeta, String>
// MediaMeta { duration: f64, width: u32, height: u32, has_audio: bool }
```

Probe strategy (no extra crate required):

```bash
ffmpeg -hide_banner -i "/path/to/file" -f null -
```

Parse stderr for `Duration: HH:MM:SS.xx` and `Stream #0:0: Video: ... 1920x1080` and any `Audio:` stream. Unit-test pure parse functions with fixture stderr strings.

- [ ] **Step 1: Implement `parse_ffmpeg_probe_output(stderr: &str) -> Result<MediaMeta, String>` with `#[cfg(test)]` cases**
- [ ] **Step 2: Wire `check_deps`, settings (JSON in app config dir), `probe_media`, `reveal_in_folder`**
- [ ] **Step 3: `cargo test` + `cargo check`**
- [ ] **Step 4: Commit**

```bash
git add src-tauri
git commit -m "feat(tauri): deps, settings, media probe"
```

---

### Task 9: Rust export geometry + segment arg builders (unit tested)

**Files:**
- Create: `src-tauri/src/geometry.rs`
- Create: `src-tauri/src/export.rs` (builders only first; full pipeline Task 10)
- Modify: `src-tauri/src/lib.rs` — `mod geometry; mod export;`

**Interfaces:**

```rust
pub struct DrawRect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

pub fn draw_rect(src_w: u32, src_h: u32, canvas_w: u32, canvas_h: u32, scale: f64, tx: f64, ty: f64) -> DrawRect;
// Same formulas as TS

/// One flattened segment from the frontend (serde).
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExportSegment {
  Clip {
    source_path: String,
    source_start: f64,
    duration: f64, // t1 - t0
    scale: f64,
    x: f64,
    y: f64,
    src_w: u32,
    src_h: u32,
    has_audio: bool,
  },
  Black { duration: f64 },
}

#[derive(Deserialize)]
pub struct ExportOpts {
  pub canvas_width: u32,
  pub canvas_height: u32,
  pub segments: Vec<ExportSegment>,
  pub output_path: String,
}

/// Build ffmpeg argv for one clip segment → out_path (re-encode).
pub fn clip_segment_args(seg: &ExportSegment /* Clip */, canvas_w: u32, canvas_h: u32, out: &str) -> Vec<String>;

/// Black + silence segment args.
pub fn black_segment_args(duration: f64, canvas_w: u32, canvas_h: u32, out: &str) -> Vec<String>;

/// Concat demuxer file body.
pub fn concat_list_body(segment_paths: &[String]) -> String;
```

**Clip segment ffmpeg approach (fixed 30 fps, yuv420p, aac):**

Use filter_complex roughly:

```
[0:v]trim=start=SOURCE_START:duration=DUR,setpts=PTS-STARTPTS,scale=DRAW_W:DRAW_H,setsar=1[v];
color=c=black:s=CANxCAN:d=DUR:r=30[bg];
[bg][v]overlay=X:Y:shortest=1,format=yuv420p[vout]
```

Audio:

```
# if has_audio:
[0:a]atrim=start=...:duration=...,asetpts=PTS-STARTPTS,aresample=48000[a]
# else:
anullsrc=r=48000:cl=stereo,atrim=duration=DUR[a]
```

Encode: `-map [vout] -map [a] -c:v libx264 -pix_fmt yuv420p -r 30 -c:a aac -t DUR out.mp4`

Exact filter strings may be adjusted for ffmpeg version; unit tests lock the **arg builder** strings with snapshots/contains assertions.

Black segment: `color=c=black:s=WxH:d=DUR:r=30` + `anullsrc` + same encode flags.

- [ ] **Step 1: geometry tests matching TS cases**
- [ ] **Step 2: clip_segment_args / black_segment_args / concat_list_body tests**
- [ ] **Step 3: `cargo test` pass + commit**

```bash
git add src-tauri/src/geometry.rs src-tauri/src/export.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): export geometry and ffmpeg arg builders"
```

---

### Task 10: Rust `export_project` command (run ffmpeg)

**Files:**
- Modify: `src-tauri/src/export.rs`
- Modify: `src-tauri/src/lib.rs` — register `export_project`
- Modify: capabilities if needed for writing output path

**Interfaces:**

```rust
#[tauri::command]
pub async fn export_project(app: AppHandle, opts: ExportOpts) -> Result<ExportResult, String>;
// ExportResult { output_path: String }
// Emits: "export-progress" { phase, message, pct: Option<f64> }
```

**Pipeline:**

1. If `segments.is_empty()` → Err("nothing to export").
2. Ensure parent of `output_path` exists.
3. Create temp dir (`std::env::temp_dir()/slop-vc-{uuid}`).
4. For each segment `i`: build args, run `ffmpeg -y ...`, emit progress `i/n`. On failure, cleanup temp, return stderr tail (500 chars).
5. Write concat list file; run concat (`-f concat -safe 0 -i list.txt -c copy out` or re-encode if copy fails).
6. `+faststart`: if using re-encode final, include `-movflags +faststart`; if copy-only, optional second pass not required for v1.
7. Remove temp dir.
8. Return `output_path`.

Frontend will send **already flattened** segments (so Rust does not re-implement resolve). Include `duration` per segment on the wire (`t1 - t0`).

Add a TS helper:

```ts
// src/lib/exportPayload.ts
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
    };
  });
  return {
    canvas_width: project.canvas.width,
    canvas_height: project.canvas.height,
    segments: segs,
    output_path: outputPath,
  };
}
```

Note serde rename: use `#[serde(rename_all = "snake_case")]` on structs and tag `kind` values `"clip" | "black"`.

- [ ] **Step 1: Implement command + progress events**
- [ ] **Step 2: Manual smoke (not CI):** one real mp4 if available — optional; at least `cargo check`
- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/export.rs src-tauri/src/lib.rs src/lib/exportPayload.ts
git commit -m "feat(tauri): export_project segment encode and concat"
```

---

### Task 11: Frontend Tauri wrappers + project file open/save

**Files:**
- Create: `src/lib/tauri.ts`
- Modify: app shell in Task 12 will use these

**Interfaces:**

```ts
export const checkDeps = () => invoke<DepsStatus>("check_deps");
export const probeMedia = (path: string) => invoke<SourceMeta>("probe_media", { path });
// map Rust MediaMeta fields to SourceMeta (path filled on TS side)
export const exportProject = (opts: ExportOpts) => invoke<{ output_path: string }>("export_project", { opts });
export const loadSettings = () => invoke<AppSettings>("load_settings");
export const saveSettings = (s: AppSettings) => invoke("save_settings", { settings: s });
export const defaultExportDir = () => invoke<string>("default_export_dir");
export const revealInFolder = (path: string) => invoke("reveal_in_folder", { path });
```

Project files: use `@tauri-apps/plugin-dialog` open/save; read/write with `@tauri-apps/plugin-fs` **or** custom Rust commands `read_text_file` / `write_text_file`. Prefer **plugin-fs** if scaffold includes it; else add thin Rust:

```rust
read_text_file(path: String) -> Result<String, String>
write_text_file(path: String, contents: String) -> Result<(), String>
```

- [ ] **Step 1: Add plugins to Cargo.toml + package.json as needed**
- [ ] **Step 2: Implement `tauri.ts` + file helpers**
- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts src-tauri
git commit -m "feat: tauri invoke wrappers and project file I/O"
```

---

### Task 12: App state + main shell layout

**Files:**
- Create: `src/state/appState.svelte.ts` (or keep state in `+page.svelte` if simpler — prefer small store)
- Create: `src/lib/components/Toolbar.svelte`
- Create: `src/lib/components/MissingDeps.svelte`
- Create: `src/lib/components/StatusLine.svelte`
- Create: `src/lib/components/Transport.svelte`
- Create: `src/lib/components/Inspector.svelte` (fields wired; transform numbers)
- Modify: `src/routes/+page.svelte` (or `App.svelte`)
- Modify: `src/app.css` — dark functional theme

**State fields:**

```ts
project: Project
history: History<Project>
playhead: number // seconds
selectedClipId: string | null
selectedTrackId: string
metaByPath: Map<string, SourceMeta>
projectPath: string | null
dirty: boolean
deps: DepsStatus | null
status: string
exporting: boolean
playing: boolean
```

**Mutations:** any project change → `historyPush` + set dirty. Undo/redo apply history.

**Toolbar:** New (confirm if dirty), Open, Save, Save As, Import videos, Export, canvas W×H inputs.

**Import flow:**

1. Dialog multi-select video files.
2. For each path: `probeMedia`; on failure skip + status.
3. `addClip` on `selectedTrackId` at `playhead` with `sourceIn: 0`, `sourceOut: duration`, default transform, `sourcePath`.
4. Advance playhead optional: leave at start of last import (v1: keep playhead).

**Missing deps:** banner if `!ffmpeg`.

- [ ] **Step 1: Wire shell without full timeline/preview (placeholders OK)**
- [ ] **Step 2: New/Open/Save/Import probe path works end-to-end**
- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat: app shell, state, project open/save/import"
```

---

### Task 13: Timeline UI

**Files:**
- Create: `src/lib/components/Timeline.svelte`

**Behavior:**
- Horizontal time ruler 0…max(projectDuration, playhead, 10)
- Track rows labeled V1/V2…; top row = highest priority track (render `tracks` reversed for display OR label clearly)
- Clip blocks positioned by `timelineStart` and duration; show file basename
- Click select; drag body → `moveClip`; drag edges → trim in/out
- Drag to another track changes `toTrackId`
- Click ruler / empty → set playhead
- Keyboard: Delete deletes selection; S splits at playhead (document listener when not in input)
- Zoom: scale px-per-second state (slider or ctrl+wheel)

Use pointer events; while dragging, update project live or on pointerup (prefer live with undo snapshot only on pointerdown).

- [ ] **Step 1: Implement Timeline with select/move/trim**
- [ ] **Step 2: Split + delete shortcuts**
- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Timeline.svelte src/
git commit -m "feat: multi-track timeline editing UI"
```

---

### Task 14: Preview playback + transform gizmo

**Files:**
- Create: `src/lib/components/Preview.svelte`
- Modify: `Transport.svelte` — play/pause, time labels
- Modify: app state for `playing` + rAF loop

**Preview algorithm:**

1. Maintain a pool or single `<video>` element; when resolved clip source path changes, set `src` via `convertFileSrc(path)` (Tauri).
2. On playhead change (paused): seek video to `sourceIn + (playhead - timelineStart)`.
3. Draw to canvas each frame: clear black → `drawImage` video into `drawRect(...)` destination on canvas sized to project canvas (CSS-scaled in pane).
4. Playback: rAF advances playhead by wall-clock delta; loop at end or stop; keep video play/seek in sync (seek when source clip changes or drift > 0.3s).
5. Transform: when clip selected, pointer-drag on canvas adjusts `x/y`; wheel adjusts `scale` (min 0.05, max 8). Reset button in inspector.

Asset protocol / CSP: match downloader `protocol-asset` + scope so local files load.

- [ ] **Step 1: Still-frame preview at playhead**
- [ ] **Step 2: Play/pause transport**
- [ ] **Step 3: Pan/scale interaction**
- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Preview.svelte src/
git commit -m "feat: preview playback and per-clip transform"
```

---

### Task 15: Export UI, polish, README

**Files:**
- Modify: Toolbar / page — Export button
- Modify: `README.md`
- Create: `LICENSE` (MIT, if matching sibling projects)

**Export flow:**

1. Validate all clip paths exist (probe or fs exists); else list missing.
2. `toExportOpts` + dialog save path defaulting to `defaultExportDir` / settings.
3. Listen `export-progress`; show status.
4. On success: `revealInFolder`, save last export dir to settings, status with path.

**README contents:**
- What it is (pipeline with downloader + animator)
- Requirements: Node, Rust, ffmpeg on PATH
- `npm install` / `npm run tauri dev` / `npm test` / `cargo test`
- Usage: import clips → edit → save project → export MP4 → open in animator

**Keyboard help** in README matching implemented shortcuts.

- [ ] **Step 1: Wire export + progress + reveal**
- [ ] **Step 2: Write README**
- [ ] **Step 3: Full test suite**

```bash
npm test
cd src-tauri && cargo test
npm run check   # if svelte-check configured
```

- [ ] **Step 4: Manual verification checklist**
  - [ ] Import 2 clips, overlap on two tracks → preview shows higher track
  - [ ] Trim/split/delete
  - [ ] Scale/pan
  - [ ] Save/reopen `.slopcomp.json`
  - [ ] Export MP4 opens in slop-animator as video ref
  - [ ] Quit ffmpeg missing → banner (rename ffmpeg temporarily only if safe)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: export UI, README, polish"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Hard-cut higher track wins | 4, 13, 14 |
| Multi-track import/move/trim/split/delete | 6, 12, 13 |
| Per-clip scale + position | 5, 9, 14 |
| Project JSON absolute paths | 3, 11, 12 |
| Audio always muxed | 9–10 |
| Canvas user W×H, default 1920×1080 | 3, 12 |
| ffmpeg export H.264+AAC, 30 fps | 9–10, 15 |
| No FPS product feature | Global constraints |
| Deps check / missing sources / relink | 8, 12, 15 (relink in Inspector) |
| macOS reveal | 8, 15 |
| Unit tests pure logic | 2–7, 8–9 |

**Relink:** implement in Task 12/15 Inspector — file dialog → update `sourcePath` + re-probe; covered under Inspector editable path.

**Add track:** Task 6 `addTrack` + Timeline/Toolbar button in Task 13.

No intentional TBD placeholders remain.
