# Slop Video Compositor

Desktop multi-shot video compositor: load local clips onto tracks, trim/cut/reorder, optionally reframe on a fixed canvas, export one animator-friendly **H.264 + AAC MP4**.

Sits between **slop-video-downloader** (clip export) and **slop-animator** (video reference layer).

**Stack:** Tauri 2 + SvelteKit + TypeScript, with **ffmpeg** as an external tool on your `PATH` (not bundled).

## Status

Scaffold only — timeline and export come in later work.

## Development

Requirements: Node.js (LTS), Rust stable toolchain, and (later) `ffmpeg` on `PATH`.

```bash
npm install
npm run tauri dev
```

## Design

See `docs/superpowers/specs/2026-07-27-slop-video-compositor-design.md`.
