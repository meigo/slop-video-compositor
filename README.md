# Slop Video Compositor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Desktop multi-shot video compositor: load local clips onto tracks, trim/cut/reorder, reframe on a fixed canvas, export one animator-friendly **H.264 + AAC MP4**.

Sits in the Slop pipeline between **[slop-video-downloader](../slop-video-downloader)** (clip export) and **[slop-animator](../slop-animator)** (video reference layer): download or gather clips → compose here → open the MP4 as a video ref in the animator.

**Stack:** Tauri 2 + SvelteKit + TypeScript, with **ffmpeg** as an external tool on your `PATH` (not bundled).

## Features

- Multi-track timeline: import, move, trim in/out, split at playhead, delete (no ripple)
- Hard-cut compositing: higher track wins on overlap; gaps render black (silent audio)
- Per-clip scale + pan on a user canvas (default 1920×1080)
- Live preview with transport (play/pause/stop) and transform gizmo
- Project save/open as JSON with **absolute** source paths
- Relink missing media from the Inspector
- Export H.264 + AAC `.mp4` at canvas size, 30 fps, audio always muxed
- Dependency check for `ffmpeg` with a banner when missing
- macOS-first (Finder reveal on export)

## Requirements

| Tool | Notes |
|------|--------|
| **Node.js** | LTS for frontend tooling (`npm`) |
| **Rust** | Stable toolchain (`rustc` / `cargo`) for the Tauri backend |
| **ffmpeg** | Probe, encode, and concat — must be on `PATH` |

On macOS with Homebrew:

```bash
brew install ffmpeg
```

Also install a recent Node LTS and the [Rust toolchain](https://rustup.rs/). Tauri 2 may need additional platform libraries — see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

**Notes**

- **ffmpeg must be on `PATH`.** The app checks at startup and shows install guidance if missing. The binary is not bundled.
- Source clips are local video files (e.g. MP4/MOV from the downloader or elsewhere).

## Development

```bash
npm install
npm run tauri dev
```

Other useful scripts:

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite/SvelteKit only (no Tauri shell) |
| `npm run build` | Production frontend build |
| `npm run check` | `svelte-check` / TypeScript |
| `npm run tauri build` | Package the desktop app |

## Tests

Frontend (Vitest — pure logic):

```bash
npm test
```

Rust backend:

```bash
cd src-tauri && cargo test
```

## Usage

1. **Import** clips onto the selected track (`Import` or ⌘I).
2. **Edit** on the timeline: drag to move, edge-drag to trim, **S** to split at playhead, Delete to remove.
3. **Reframe** in the preview: drag the selected clip to pan; scroll wheel to scale (or use the Inspector).
4. **Canvas** W×H in the toolbar sets preview and export size.
5. **Save** the project (`.json` with absolute paths) — reopen later with **Open**.
6. **Export** → choose an `.mp4` path (defaults under last export dir or `~/Movies/Slop Refs`) → progress in the status line → Finder reveals the file on success.
7. Open that MP4 in **slop-animator** as a video reference layer.

If a source file moved, select the clip → **Relink…** in the Inspector.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / pause |
| S | Split selected clip at playhead |
| Delete / Backspace | Delete selected clip |
| ⌘S / Ctrl+S | Save |
| ⌘⇧S / Ctrl+Shift+S | Save As |
| ⌘O / Ctrl+O | Open project |
| ⌘I / Ctrl+I | Import videos |
| ⌘Z / Ctrl+Z | Undo |
| ⌘⇧Z / Ctrl+Shift+Z | Redo |

(Shortcuts are ignored while typing in inputs.)

## Project files

Projects are JSON (`version: 1`) with canvas size, tracks, and clips (source path, in/out, timeline start, transform). Paths are absolute so the same machine can reopen them; use Relink when a file is missing.

Default export folder: last used export directory, else `~/Movies/Slop Refs`.

## Design

See `docs/superpowers/specs/2026-07-27-slop-video-compositor-design.md`.

## License

MIT — see [LICENSE](LICENSE).
