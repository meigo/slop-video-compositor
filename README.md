# Slop Video Compositor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-meigo%2Fslop--video--compositor-181717?logo=github)](https://github.com/meigo/slop-video-compositor)

Desktop multi-shot **hard-cut** video compositor: load local clips onto tracks, trim/cut/reorder, reframe on a fixed canvas, export one animator-friendly **H.264 + AAC MP4**.

Sits between **[slop-video-downloader](https://github.com/meigo/slop-video-downloader)** and **[slop-animator](https://github.com/meigo/slop-animator)**: gather clips → compose here → open the MP4 as a video reference in the animator.

**Stack:** Tauri 2 + SvelteKit + TypeScript, with **ffmpeg** on your `PATH` (not bundled).

| | |
|--|--|
| **License** | MIT |
| **Platform** | macOS-first (Tauri desktop) |
| **Export** | H.264 + AAC MP4 @ **30 fps**, project canvas size |
| **Edit grid** | Timeline / frame step at fixed **30 fps** (no per-clip fps UI) |

## Features

- Multi-track timeline: import, move, trim in/out, split at playhead, delete (no ripple)
- Same-track **overwrite** (dragged clip wins); higher track wins across tracks
- **Gap hatch** on empty track time; **trim handles** show unused source outside in/out
- Per-source clip colors; long names truncated (full path on hover)
- Snap on drag/trim (**Shift** = free); Fit zoom to sequence width
- **Program out** sequence end (shortening trims/deletes media past that time)
- Import placement: append on track / at playhead / each file → new track
- Named **markers** on the ruler; copy / paste / duplicate clips
- Preview: dual-buffer free-run; track **solo** (preview only); viewport pan/zoom vs clip transform
- Compact toolbar: **File ▾**, **Import** + place menu, **Export**, undo/redo, **Canvas ▾** (presets + W×H)
- Relink + Reveal source; autosave to `*.autosave.json` beside the project
- Export filename includes project name, duration, and clip count
- Startup check for `ffmpeg`

## Requirements

| Tool | Notes |
|------|--------|
| **Node.js** | LTS (`npm`) |
| **Rust** | Stable (`rustc` / `cargo`) for Tauri |
| **ffmpeg** | Probe, encode, concat — must be on `PATH` |

```bash
# macOS (Homebrew)
brew install ffmpeg
```

Also: [Rust toolchain](https://rustup.rs/) and [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) if packaging.

## Development

```bash
npm install
npm run tauri dev
```

| Command | Purpose |
|---------|---------|
| `npm run dev` | Frontend only (no Tauri shell) |
| `npm run build` | Production frontend build |
| `npm run check` | TypeScript / svelte-check |
| `npm test` | Vitest (timeline/export pure logic) |
| `npm run tauri build` | Package the desktop app |
| `cd src-tauri && cargo test` | Rust unit tests |

## Usage

1. **Import** (`Import` or ⌘I). Default place mode **appends** on the selected track. Use Import ▾ for playhead or each-file→new-track (or ⌘⇧I).
2. **Edit** on the timeline: drag to move (snaps), edge-drag to trim (dim **handles** show remaining unused source), **S** split, Delete remove.
3. **Reframe** in the preview: **Ctrl/⌘-drag** pans the clip on the canvas; **Shift-drag** scales; wheel zooms the **viewport**. Timeline **Fit** fills the track width.
4. **Canvas ▾** — presets (1080p, 720p, vertical, square) or custom even W×H.
5. **Save** project JSON (absolute source paths). Dirty projects autosave beside the file as `name.autosave.json`.
6. **Export** → MP4 (last export dir or `~/Movies/Slop Refs`) → Finder reveals on success.
7. Open the MP4 in **slop-animator** as a video reference.

Missing media: **Relink…** or **Reveal** in the Inspector. Open warns if sources fail to probe.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / pause |
| ← / → | Step **1 frame** (30 fps) |
| Shift+← / → | Step **1 second** |
| Home / End | Sequence start / end |
| `[` / `]` | Previous / next cut (clip edges + markers) |
| M | Marker at playhead |
| S | Split selected clip at playhead |
| Delete / Backspace | Delete selected clip |
| ⌘C / ⌘V / ⌘D | Copy / paste / duplicate |
| ⌘S / ⌘⇧S | Save / Save As |
| ⌘O | Open project |
| ⌘I / ⌘⇧I | Import / import each → new track |
| ⌘Z / ⌘⇧Z | Undo / Redo |
| Shift (while dragging) | Disable snap |

Ignored while focus is in text fields.

### Timeline notes

- **Snap** targets: clip edges, markers, playhead, sequence ends.
- **Program out:** blue sequence-end handle — drag right for black tail; left trims/deletes past that time (on release).
- **Trim handles:** dashed extensions = media still in the file but outside the used range.
- **Gap hatch:** empty track time (no clip, not trimmed media).
- **Solo:** double-click a track label (preview only; export uses all tracks).
- **Markers:** click to seek; Alt+click to remove.

## Project files

JSON `version: 1` — name, canvas, duration (program out), tracks, clips (`sourcePath`, `sourceIn` / `sourceOut`, `timelineStart`, transform), optional **markers**. Paths are absolute; use Relink if a file moves.

## Design

Internal design notes: `docs/superpowers/specs/2026-07-27-slop-video-compositor-design.md`.

## Contributors

<table>
  <tr>
    <td align="center" width="140">
      <a href="https://github.com/meigo">
        <img src="https://github.com/meigo.png?size=100" width="100" height="100" alt="meigo" /><br />
        <sub><b>Meigo Kukk</b></sub>
      </a><br />
      <sub>owner</sub>
    </td>
    <td align="center" width="140">
      <a href="https://x.ai/">
        <img src="https://www.google.com/s2/favicons?domain=x.ai&sz=128" width="100" height="100" alt="Grok / xAI" /><br />
        <sub><b>Grok</b></sub>
      </a><br />
      <sub>xAI · co-author</sub>
    </td>
  </tr>
</table>

Assisted by **[Grok](https://x.ai/)** (xAI). Commits may include:

```text
Co-Authored-By: Grok <noreply@x.ai>
```

## License

MIT — see [LICENSE](LICENSE).
