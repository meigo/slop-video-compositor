# Slop Video Compositor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-meigo%2Fslop--video--compositor-181717?logo=github)](https://github.com/meigo/slop-video-compositor)

Desktop multi-shot **hard-cut** video compositor: load local clips onto tracks, trim/cut/reorder, reframe on a fixed canvas, export one animator-friendly **H.264 + AAC MP4**.

Part of the Slop pipeline between **[slop-video-downloader](https://github.com/meigo/slop-video-downloader)** (clip export) and **[slop-animator](https://github.com/meigo/slop-animator)** (video reference layer): download or gather clips → compose here → open the MP4 as a video ref in the animator.

**Stack:** Tauri 2 + SvelteKit + TypeScript, with **ffmpeg** as an external tool on your `PATH` (not bundled).

| | |
|--|--|
| **License** | MIT |
| **Platform** | macOS-first (Tauri desktop) |
| **Export** | H.264 + AAC MP4 @ 30 fps, canvas size |

## Features

- Multi-track timeline: import, move, trim in/out, split at playhead, delete (no ripple)
- Same-track **overwrite**; higher track wins; gap hatching; per-source clip colors
- Snap on drag/trim (**Shift** = free); Fit zoom; program-out sequence end
- Import placement: append / playhead / each file → new track
- Markers on the ruler; canvas presets + free W×H
- Preview solo (track label double-click); copy/paste/duplicate
- Relink + Reveal source; autosave draft beside project file
- Export H.264 + AAC `.mp4` @ 30 fps (filename includes duration/clip count)
- Dependency check for `ffmpeg`; macOS-first

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

1. **Import** clips (`Import` or ⌘I). Default **Place** mode appends on the selected track (gap-free shot list).
2. **Edit** on the timeline: drag to move (snaps; **Shift** = free), edge-drag to trim, **S** to split, Delete to remove.
3. **Reframe** in the preview: **Ctrl/⌘-drag** pans the clip on the canvas; **Shift-drag** scales; wheel zooms the **viewport** (not the clip). Fit resets timeline zoom to full width.
4. **Canvas** presets or W×H in the toolbar set preview and export size.
5. **Save** the project (`.json` with absolute paths). Dirty projects autosave to `name.autosave.json` beside the project file.
6. **Export** → MP4 (defaults under last export dir or `~/Movies/Slop Refs`) → Finder reveals on success.
7. Open that MP4 in **slop-animator** as a video reference layer.

If a source file moved, select the clip → **Relink…** or **Reveal** in the Inspector.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / pause |
| ← / → | Step playhead by **1 frame** (30 fps) |
| Shift+← / → | Step playhead by **1 second** |
| Home / End | Playhead to start / sequence end |
| `[` / `]` | Previous / next cut (clip edges + markers) |
| M | Add marker at playhead |
| S | Split selected clip at playhead |
| Delete / Backspace | Delete selected clip |
| ⌘C / ⌘V / ⌘D | Copy / paste / duplicate clip |
| ⌘S / Ctrl+S | Save |
| ⌘⇧S / Ctrl+Shift+S | Save As |
| ⌘O / Ctrl+O | Open project |
| ⌘I / Ctrl+I | Import videos |
| ⌘⇧I | Import each file onto a new track |
| ⌘Z / Ctrl+Z | Undo |
| ⌘⇧Z / Ctrl+Shift+Z | Redo |
| Shift (while dragging clip) | Disable snap |

(Shortcuts are ignored while typing in inputs.)

### Timeline / preview notes

- **Snap** to clip edges, markers, playhead, and sequence ends.
- **Program out:** drag the blue sequence-end handle left to trim/delete media past that time (applied on release).
- **Solo:** double-click a track label (preview only; export still uses all tracks).
- **Markers:** click to seek; Alt+click to remove.

## Project files

Projects are JSON (`version: 1`) with canvas size, tracks, and clips (source path, in/out, timeline start, transform). Paths are absolute so the same machine can reopen them; use Relink when a file is missing.

Default export folder: last used export directory, else `~/Movies/Slop Refs`.

## Design

See `docs/superpowers/specs/2026-07-27-slop-video-compositor-design.md`.

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

Development has been substantially assisted by **[Grok](https://x.ai/)** (xAI). Commits that include that work use:

```text
Co-Authored-By: Grok <noreply@x.ai>
```

That matches the Claude style used on other Meigo projects (`Co-Authored-By: … <noreply@anthropic.com>`).

**Note on GitHub’s automatic “Contributors” list:** GitHub only lists **linked GitHub accounts**. Anthropic’s [`claude`](https://github.com/claude) account is tied to `noreply@anthropic.com`, so Claude can appear in that panel when they author or co-author commits. There is currently **no official GitHub user linked to `noreply@x.ai`**, so Grok shows as co-author on individual commit pages but not in the auto-generated Contributors sidebar. Credit here (and on commits) is intentional.

## License

MIT — see [LICENSE](LICENSE).
