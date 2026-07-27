# Slop Video Compositor — design

**Date:** 2026-07-27  
**Status:** Design (approved for planning)  
**Product:** Desktop multi-shot video compositor that assembles clips (typically from slop-video-downloader) into one reference MP4 for slop-animator

## Motivation

**slop-video-downloader** exports short H.264+AAC MP4 clips (default under `~/Movies/Slop Refs`). **slop-animator** loads a single video file as a reference layer (`File` → blob URL → `<video>`), with project FPS, offset, and per-layer speed for retime.

Rotoscoping or multi-shot reference work often needs several clips cut together—one continuous reference rather than juggling many reference layers. This app fills that gap: load multiple local videos onto tracks, trim/cut/reorder, optionally reframe each shot on a fixed canvas, export one animator-friendly MP4.

## Pipeline role

```
YouTube/Vimeo/X  →  slop-video-downloader  →  clip MP4s (~/Movies/Slop Refs)
                                                    ↓
                                          slop-video-compositor
                                          (multi-shot rough cut + frame)
                                                    ↓
                                          one H.264+AAC MP4
                                                    ↓
                                            slop-animator
                                          (video reference layer)
```

No deep IPC with the other apps in v1—file paths are the integration surface.

## Goals

1. Import multiple local video files onto separate timeline tracks.
2. Move clips on the timeline, trim in/out, split at playhead, delete (no ripple).
3. Hard-cut resolve only: at each time, the highest track with a clip wins (or black if none).
4. Per-clip **uniform scale + position** on a user-defined project canvas (default contain-fit center).
5. Save/reopen a lightweight **project file** (JSON + absolute source paths; media not embedded).
6. Export one browser-playable **H.264 + AAC `.mp4`** at canvas size, with audio always muxed.
7. Work well on **macOS first**, without hard-blocking Windows/Linux later.
8. Fail clearly when `ffmpeg` is missing or sources are missing/unreadable.

## Non-goals (v1)

- FPS conversion UI or variable “project fps” tooling (animator already retimes; export uses a fixed output fps for stable concat)
- Transitions, dissolves, PiP, multi-layer blend / opacity stacks
- Rotation, non-uniform scale, keyframed transforms
- Ripple edit, snap, magnetic timeline
- Waveforms / filmstrip thumbnails on clip blocks
- Portable project packages that copy media into a zip/folder
- Audio-only tracks, per-clip mute/solo, linked audio
- Deep integration with slop-animator or the downloader (no auto-import IPC)
- Bundled/sideloaded ffmpeg in the installer (PATH check is enough for v1)
- Cloud, multi-user, collaborative editing

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Overlap behavior | Hard cut only; higher track wins |
| D2 | Form factor | Desktop GUI (Tauri 2 + Svelte + TypeScript), same family as downloader |
| D3 | Project persistence | JSON project + absolute paths to source files |
| D4 | Audio on export | Always muxed (silence for gaps / sources without audio) |
| D5 | Canvas / framing | User-chosen W×H; default contain-fit center; per-clip scale + XY |
| D6 | FPS tooling | Out of scope for user features; fixed export fps (30) for concat stability |
| D7 | Edit ops (v1) | Import, place/move, trim, split, delete — no ripple |
| D8 | Transform (v1) | Uniform scale + position only (no rotation) |
| D9 | Export engine | System `ffmpeg` on PATH; segment encode + concat |
| D10 | Preview engine | HTML5 `<video>` + canvas composite (good enough; export is source of truth) |

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Svelte UI (Tauri webview)                       │
│  Preview · timeline · inspector · transport      │
│  Pure TS: timeline model, resolve, transform math│
└────────────────────┬─────────────────────────────┘
                     │ invoke + events
┌────────────────────▼─────────────────────────────┐
│  Tauri / Rust commands                           │
│  deps · probe · project I/O · export · reveal    │
└────────────────────┬─────────────────────────────┘
                     │ spawn
                     ▼
                  ffmpeg
```

### Responsibilities

| Layer | Owns |
|-------|------|
| **Svelte / TS** | Layout, preview, timeline UX, selection, in-memory undo, transform gizmo, user-facing errors |
| **Rust (Tauri)** | Deps check, media probe, project read/write bridge, export (temp segments, ffmpeg, progress, cleanup), reveal-in-folder, settings |
| **ffmpeg** | Per-segment trim/scale/overlay/encode; concat to final H.264+AAC MP4 |

### Tauri commands (v1 sketch)

- `check_deps() -> { ffmpeg: bool, ffmpeg_path? }`
- `probe_media(path) -> { duration, width, height, has_audio }`
- `export_project(opts) -> { output_path }` with progress events  
  `opts`: `{ project: Project, output_path: string }` (or path to saved project file)
- `reveal_in_folder(path)`
- `load_settings` / `save_settings` (last export dir, last project dir, window size optional)

Project open/save may be frontend File API + Tauri dialogs writing JSON, or Rust helpers—either is fine as long as absolute paths are preserved.

## Data model

### Project file

Suggested name pattern: `*.slopcomp.json` (JSON, not a media container). Media stays on disk.

```ts
type Project = {
  version: 1;
  name: string;
  canvas: { width: number; height: number };
  tracks: Track[];
  // Timeline length is derived: max over clips of (timelineStart + sourceOut - sourceIn)
};

type Track = {
  id: string;
  name: string; // "V1", "V2", …
  // Array order: higher index = higher stack = wins on hard-cut resolve
  clips: Clip[];
};

type Clip = {
  id: string;
  sourcePath: string; // absolute
  sourceIn: number;   // seconds, source media time
  sourceOut: number;  // exclusive end; duration = sourceOut - sourceIn
  timelineStart: number; // seconds on project timeline
  transform: ClipTransform;
};

type ClipTransform = {
  // Uniform scale relative to contain-fit size (1 = fit canvas)
  scale: number;
  // Translation in canvas pixels from contain-fit centered position
  x: number;
  y: number;
};
```

### Derived (not stored)

- `clipDuration = sourceOut - sourceIn`
- `timelineEnd = timelineStart + clipDuration`
- `projectDuration = max(timelineEnd)` or `0` if empty

### Hard-cut resolve

At timeline time `t`:

1. Collect clips where `timelineStart ≤ t < timelineEnd`.
2. Pick the clip on the **highest** track (last track in `tracks` array / top of UI).
3. Source time: `sourceTime = sourceIn + (t - timelineStart)`.
4. Composite that frame with the clip’s transform onto a black canvas.

No blend: one clip or black.

### Session-only source meta

On import or project open, probe each path:

```ts
type SourceMeta = {
  path: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
};
```

Missing path: clip remains in project; UI shows missing state; export fails until relink.

### Defaults

| Field | Default |
|-------|---------|
| New project canvas | 1920×1080 |
| New clip transform | `{ scale: 1, x: 0, y: 0 }` (contain-fit center) |
| Import placement | Selected track, at playhead |
| Initial tracks | 2 video tracks; user can add tracks |
| Export folder | Last used, else `~/Movies/Slop Refs` |
| Export fps | 30 (fixed; not a user “fps tool”) |

### Undo

In-memory history for edit ops (place, move, trim, split, delete, transform, add track). Not persisted across sessions.

### Out of model (v1)

- Per-clip opacity, mute, speed
- Markers, labels, clip colors
- Relative paths / media packs
- Playhead / zoom persistence (optional later)

## UI layout & interactions

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Toolbar: New · Open · Save · Import · Export · canvas W×H   │
├──────────────────────────────┬──────────────────────────────┤
│                              │  Inspector (selected clip)   │
│     Preview canvas           │  path, in/out, timeline,     │
│     (project aspect)         │  scale / x / y, Relink       │
│                              │                              │
│     Transport · time labels  │                              │
├──────────────────────────────┴──────────────────────────────┤
│  Timeline (tracks top-to-bottom = high-to-low priority)     │
│  [V2]  ████ clip ████                                       │
│  [V1]     ██████ clip ██████    ████                        │
│  ────── playhead ─────────────────────────────────────────  │
└─────────────────────────────────────────────────────────────┘
```

Functional dark UI, consistent with other slop tools.

### Preview

- Resolves the hard-cut winner at the playhead; draws with transform onto black project surface; fits that surface in the preview pane.
- Play/pause and scrub; keyboard nudges for time (exact step values in implementation plan).
- When a clip is selected: drag on preview to pan (`x`/`y`); scroll or handle for uniform `scale`; reset → `{ scale: 1, x: 0, y: 0 }`.
- Only the winner is shown (no multi-clip overlay).

### Timeline

| Action | Behavior |
|--------|----------|
| **Import** | Multi-select file picker; clips on **selected track** at **playhead** |
| **Select** | Click clip block → inspector + highlight |
| **Move** | Drag horizontally (`timelineStart`); drag vertically to another track |
| **Trim** | Edge drag adjusts `sourceIn` / `sourceOut`; left-trim keeps visual right edge by adjusting `timelineStart` + `sourceIn` together (standard NLE left-trim) |
| **Split** | At playhead inside clip → two clips (shortcut **S**) |
| **Delete** | Remove selection; **no ripple** (gaps remain) |
| **Add track** | New track on top (highest priority) |
| **Zoom** | Horizontal timeline zoom |

Overlap is allowed; resolve is higher-track-wins. No snap in v1.

Clip blocks may be solid color + label (no filmstrip required).

### Inspector

- Read-only: duration, source dimensions, missing warning.
- Editable: source in/out, timeline start, scale, x, y.
- **Relink…** when missing or to repoint path.

### Project / export chrome

- Canvas width × height editable (applies to preview immediately).
- Save / Save As / Open for JSON project.
- Export → choose output path → progress → reveal in Finder on success (macOS).

### Keyboard (v1 minimum)

| Key | Action |
|-----|--------|
| Space | Play / pause |
| S | Split at playhead |
| Delete / Backspace | Delete selection |
| ⌘S / ⌘O / ⌘I | Save / Open / Import |

Optional polish: I/O for trim-to-playhead within selected clip (not required if edge handles suffice).

### Non-UI for v1

- Waveforms, thumbnails on blocks
- Multi-select, copy/paste clips
- Fullscreen preview

## Export pipeline (ffmpeg)

### Goal

One **H.264 + AAC MP4**, browser-friendly (same spirit as downloader): project canvas size, hard-cut sequence, per-clip scale/position, audio always present.

### Steps

1. **Validate** — all `sourcePath`s exist; `sourceIn < sourceOut`; canvas W/H > 0; project duration > 0.
2. **Flatten** — walk `[0, projectDuration)` with hard-cut resolve → non-overlapping segments `(clip | black, t0, t1)`. Merge adjacent segments from the same clip with continuous source time when possible.
3. **Encode each segment** to a temp MP4 at canvas size (H.264 + AAC, fixed timebase / fps).
4. **Concat** segments → final output (`concat` demuxer; re-encode final pass only if copy fails).
5. **Cleanup** temps; emit progress; return path; reveal in folder.

Segment files + concat is preferred over one giant filter graph for v1 (easier debug, fewer edge cases). Acceptable for reference-length jobs (seconds–minutes).

### Transform → geometry

Contain-fit, then uniform **scale about the framed center** (pan is center offset):

```
fitScale = min(canvasW / srcW, canvasH / srcH)
drawW = srcW * fitScale * transform.scale
drawH = srcH * fitScale * transform.scale
drawX = (canvasW - drawW) / 2 + transform.x
drawY = (canvasH - drawH) / 2 + transform.y
```

When `scale = 1`, this matches classic contain letterboxing. Scale source to `drawW×drawH`, overlay on black `canvasW×canvasH` at `(drawX, drawY)`; clip outside canvas.

### Black / silent segments

- Gaps and empty resolve → color black video for duration.
- Sources without audio (or black segments) → silence (`anullsrc` or equivalent) so A/V stay aligned.

### Encode defaults (v1)

| Setting | Value |
|---------|--------|
| Video | `libx264`, yuv420p, `+faststart` |
| Audio | AAC, 48 kHz (stereo preferred) |
| Output fps | **30** (fixed; not exposed as a product “fps feature”) |
| Quality | Sane CRF/preset defaults; not required in UI for v1 |

### Preview vs export

| | Preview | Export |
|--|---------|--------|
| Engine | HTML5 video + canvas | ffmpeg |
| Role | Editing feedback | Source of truth |
| Frame accuracy | Good enough for cuts/framing | Accurate enough for reference use |

Bit-identical preview/export is not required.

### Failure modes

| Case | Behavior |
|------|----------|
| Missing source | Abort before encode; list paths |
| ffmpeg missing | Startup deps check + install hints |
| Encode error | Surface stderr tail; no success reveal; clean temps |
| Empty timeline | Disable export / clear error |

## Error handling (broader)

| Situation | UX |
|-----------|-----|
| Open project, source missing | Clip marked missing; that time is black in preview; Relink in inspector |
| Export with missing sources | Dialog listing paths; no encode |
| Import unreadable file | Error; skip that file |
| Save unwritable | Error; keep dirty in-memory project |
| Invalid project JSON | Refuse open with clear message |

No silent data loss: failed save/export never clears the in-memory project.

## Testing strategy

### Pure TS (Vitest)

- Hard-cut resolver (overlaps, gaps, track order)
- Timeline flatten → segment list (merge adjacent, black gaps)
- Transform → draw rect math
- Trim / split / move pure geometry helpers
- Project JSON parse (`version: 1`)

### Rust unit tests

- Concat list formatting
- Transform → ffmpeg arg/filter builder (snapshots)
- Deps / path helpers as needed

### Manual (not CI-gated v1)

- Multi-clip import → trim/split → export → open in slop-animator as video ref
- Missing file → relink → export
- Mixed aspect ratios + punch-in scale

## Target repo layout

```
slop-video-compositor/
  src/                 Svelte UI + pure timeline logic
  src-tauri/           Rust (probe, export, deps, settings)
  docs/superpowers/
    specs/             design docs
    plans/             implementation plans
```

Stack alignment with downloader: Tauri 2, Svelte 5, TypeScript, Vitest, MIT license.

## Success criteria

1. Load multiple downloader (or other) MP4s onto tracks.
2. Move, trim, split, delete; higher track wins on overlap.
3. Per-clip scale + pan on the project canvas.
4. Save and reopen project with absolute paths intact.
5. Export one H.264+AAC MP4 at canvas size with audio.
6. Use that file in **slop-animator** as a video reference (scrub/play usefully).

## Future (explicitly deferred)

- Snap, ripple, multi-select, copy/paste
- Filmstrip / waveform
- Rotation / keyframed transform
- Portable media packages
- Optional audio include toggle or per-clip mute
- Transitions
- User-facing output fps / resolution presets beyond canvas W×H
- Animator/downloader IPC
