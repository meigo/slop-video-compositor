//! Timeline filmstrip JPEG generation via ffmpeg (cached on disk).
//! Returns a data URL so the webview does not depend on asset-protocol scopes.

use crate::deps::which;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// Clamp tile count into a sane range for the contact sheet.
/// Keep in sync with frontend `FILMSTRIP_MAX_TILES` (64).
pub fn clamp_count(count: u32) -> u32 {
    count.clamp(1, 64)
}

pub fn clamp_height(height: u32) -> u32 {
    height.clamp(8, 128)
}

/// Even dimensions — odd pad/scale targets break ffmpeg (`pad` / yuv420).
pub fn even_dim(v: u32) -> u32 {
    let v = v.max(2);
    v + (v % 2)
}

/// djb2 — stable across Rust versions (unlike DefaultHasher).
fn djb2(s: &str) -> u64 {
    let mut h: u64 = 5381;
    for b in s.bytes() {
        h = h.wrapping_mul(33).wrapping_add(u64::from(b));
    }
    h
}

/// Stable short id for cache filenames (not cryptographic).
pub fn cache_id(
    path: &str,
    source_start: f64,
    duration: f64,
    count: u32,
    height: u32,
    target_width: u32,
) -> String {
    let start_ms = (source_start * 1000.0).round() as i64;
    let dur_ms = (duration * 1000.0).round() as i64;
    // v4-even: even cell sizes; do not cache multi-key with single-frame fallback.
    let key = format!(
        "v4-even|{path}|{start_ms}|{dur_ms}|{}|{}|{}",
        clamp_count(count),
        even_dim(clamp_height(height)),
        even_dim(target_width.max(8))
    );
    format!("{:016x}", djb2(&key))
}

/// Effective tile count that can actually be sampled from `duration` at ~30fps.
pub fn effective_tile_count(count: u32, duration: f64) -> u32 {
    let n = clamp_count(count);
    if !(duration > 0.12) {
        return 1;
    }
    // Don't ask tile for more cells than frames we can pull from the window.
    let max_from_dur = ((duration * 30.0).floor() as u32).max(1);
    n.min(max_from_dur).max(1)
}

/// Cell width and sheet width used for generation (even, matches vf).
pub fn sheet_geometry(count: u32, height: u32, duration: f64, target_width: u32) -> (u32, u32, u32) {
    let h = even_dim(clamp_height(height));
    let n = effective_tile_count(count, duration);
    let tw_in = even_dim(target_width.max(8));
    let cell_w = even_dim((tw_in / n).max(2));
    let sheet_w = cell_w * n;
    (n, h, sheet_w)
}

/// ffmpeg `-vf`: equal cells that tile to `sheet_w`×`height` (even dims).
///
/// Each cell **contains** the full frame (uniform scale + pad), so faces/action
/// are not cropped off the top/bottom. Pad color matches the dark timeline bar.
pub fn filmstrip_vf(count: u32, height: u32, duration: f64, target_width: u32) -> String {
    let (n, h, sheet_w) = sheet_geometry(count, height, duration, target_width);
    let cell_w = sheet_w / n;
    // Dark pad close to --bg / clip bar so letterbox is unobtrusive.
    let pad = "0x1a1a1e";

    if n <= 1 {
        return format!(
            "scale={sheet_w}:{h}:force_original_aspect_ratio=decrease,pad={sheet_w}:{h}:(ow-iw)/2:(oh-ih)/2:color={pad}"
        );
    }
    let fps = ((n as f64) / duration).clamp(0.05, 30.0);
    format!(
        "fps={fps:.6},scale={cell_w}:{h}:force_original_aspect_ratio=decrease,pad={cell_w}:{h}:(ow-iw)/2:(oh-ih)/2:color={pad},tile={n}x1"
    )
}

/// Build ffmpeg argv (without binary) writing one JPEG to `out`.
pub fn filmstrip_args(
    input: &str,
    source_start: f64,
    duration: f64,
    count: u32,
    height: u32,
    target_width: u32,
    out: &str,
) -> Vec<String> {
    let start = source_start.max(0.0);
    let dur = duration.max(1.0 / 30.0);
    let vf = filmstrip_vf(count, height, dur, target_width);
    let mut args = vec!["-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into()];
    if start > 0.0 {
        args.push("-ss".into());
        args.push(format!("{start:.3}"));
    }
    args.extend([
        "-t".into(),
        format!("{dur:.3}"),
        "-i".into(),
        input.into(),
        "-an".into(),
        "-vf".into(),
        vf,
        "-frames:v".into(),
        "1".into(),
        // Newer ffmpeg image2 wants -update for a single non-pattern filename.
        "-update".into(),
        "1".into(),
        "-q:v".into(),
        "5".into(),
        out.into(),
    ]);
    args
}

fn cache_dir() -> Result<PathBuf, String> {
    let base = dirs::cache_dir().ok_or_else(|| "Could not resolve cache directory".to_string())?;
    let dir = base.join("slop-video-compositor").join("filmstrips");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create filmstrip cache: {e}"))?;
    Ok(dir)
}

fn run_ffmpeg(ffmpeg: &str, args: &[String]) -> Result<(), String> {
    let output = Command::new(ffmpeg)
        .args(args)
        .output()
        .map_err(|e| format!("failed to spawn ffmpeg: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let msg = stderr.trim();
    if msg.is_empty() {
        Err(format!(
            "ffmpeg filmstrip failed with status {}",
            output.status.code().unwrap_or(-1)
        ))
    } else {
        Err(format!("ffmpeg filmstrip failed: {msg}"))
    }
}

/// Wire input from the frontend (single `opts` object — same pattern as export).
#[derive(Debug, Clone, Deserialize)]
pub struct FilmstripOpts {
    pub path: String,
    pub source_start: f64,
    pub duration: f64,
    pub count: u32,
    pub height: u32,
    /// On-screen clip width in CSS pixels — strip is generated to this width.
    pub target_width: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct FilmstripResult {
    /// `data:image/jpeg;base64,...` for reliable <img> loading in the webview.
    pub data_url: String,
    pub cached: bool,
    /// Actual tile count in the sheet (after clamps / short-clip reduction).
    pub count: u32,
    /// Native pixel width of the JPEG (after width quantization).
    pub width: u32,
    /// Native pixel height of the JPEG.
    pub height: u32,
}

fn jpeg_to_data_url(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read filmstrip: {e}"))?;
    if bytes.is_empty() {
        return Err("filmstrip file is empty".into());
    }
    Ok(format!("data:image/jpeg;base64,{}", B64.encode(bytes)))
}

#[tauri::command]
pub async fn generate_filmstrip(
    _app: AppHandle,
    opts: FilmstripOpts,
) -> Result<FilmstripResult, String> {
    let FilmstripOpts {
        path,
        source_start,
        duration,
        count,
        height,
        target_width,
    } = opts;

    if path.trim().is_empty() {
        return Err("empty media path".into());
    }
    if !Path::new(&path).is_file() {
        return Err(format!("media not found: {path}"));
    }
    let n_req = clamp_count(count);
    let start = source_start.max(0.0);
    let dur = duration.max(1.0 / 30.0);
    // Quantize + even so pad/scale never hit odd-dimension ffmpeg failures.
    let tw_q = even_dim(((target_width.max(8) + 4) / 8 * 8).max(8));
    let (n, h, sheet_w) = sheet_geometry(n_req, height, dur, tw_q);

    let id = cache_id(&path, start, dur, n_req, h, sheet_w);
    let out = cache_dir()?.join(format!("{id}.jpg"));
    if out.is_file() {
        // Reject tiny "blank pad" leftovers from older bugs (single frame under multi key).
        if is_plausible_sheet(&out, sheet_w, h, n) {
            return Ok(FilmstripResult {
                data_url: jpeg_to_data_url(&out)?,
                cached: true,
                count: n,
                width: sheet_w,
                height: h,
            });
        }
        let _ = std::fs::remove_file(&out);
    }

    // Unique temp then rename — avoids partial files if two jobs race the same key.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = out.with_extension(format!("part.{stamp}.jpg"));
    let args = filmstrip_args(&path, start, dur, n_req, h, sheet_w, &tmp.to_string_lossy());

    let ffmpeg = which("ffmpeg").ok_or_else(|| "ffmpeg not found".to_string())?;
    let ffmpeg2 = ffmpeg.clone();
    let args2 = args.clone();
    let primary = tauri::async_runtime::spawn_blocking(move || run_ffmpeg(&ffmpeg2, &args2))
        .await
        .map_err(|e| format!("filmstrip task join: {e}"))?;

    if primary.is_ok() && tmp.is_file() && is_plausible_sheet(&tmp, sheet_w, h, n) {
        if out.is_file() {
            let _ = std::fs::remove_file(&tmp);
            return Ok(FilmstripResult {
                data_url: jpeg_to_data_url(&out)?,
                cached: true,
                count: n,
                width: sheet_w,
                height: h,
            });
        }
        std::fs::rename(&tmp, &out).map_err(|e| format!("rename filmstrip: {e}"))?;
        return Ok(FilmstripResult {
            data_url: jpeg_to_data_url(&out)?,
            cached: false,
            count: n,
            width: sheet_w,
            height: h,
        });
    }

    // Multi-tile failed or blank — single still at one cell width (never full sheet_w).
    // Do not write this under the multi-tile cache key (that caused empty-cell layout).
    let _ = std::fs::remove_file(&tmp);
    let cell_w = sheet_w / n;
    let args1 = filmstrip_args(
        &path,
        start,
        dur.max(0.05),
        1,
        h,
        cell_w,
        &tmp.to_string_lossy(),
    );
    let ff = which("ffmpeg").ok_or_else(|| "ffmpeg not found".to_string())?;
    tauri::async_runtime::spawn_blocking(move || run_ffmpeg(&ff, &args1))
        .await
        .map_err(|e| format!("filmstrip fallback join: {e}"))??;

    if !tmp.is_file() {
        return Err(primary
            .err()
            .unwrap_or_else(|| "ffmpeg produced no filmstrip file".into()));
    }
    // Return single still without caching under multi key.
    let data_url = jpeg_to_data_url(&tmp)?;
    let _ = std::fs::remove_file(&tmp);
    Ok(FilmstripResult {
        data_url,
        cached: false,
        count: 1,
        width: cell_w,
        height: h,
    })
}

/// Heuristic: multi-tile sheets with real content are much larger than solid pad.
fn is_plausible_sheet(path: &Path, sheet_w: u32, height: u32, count: u32) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    let len = meta.len();
    if len < 400 {
        return false;
    }
    // Solid pad JPEG for a wide sheet is ~2–4KB; real tiles scale with pixels.
    let pixels = (sheet_w as u64).saturating_mul(height as u64).max(1);
    let min_bytes = if count <= 1 {
        800
    } else {
        // ~0.04 bpp floor — blank 4544×40 was ~2.5KB; good ones are 30KB+.
        (pixels / 25).max(8_000)
    };
    len >= min_bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_count_bounds() {
        assert_eq!(clamp_count(0), 1);
        assert_eq!(clamp_count(3), 3);
        assert_eq!(clamp_count(64), 64);
        assert_eq!(clamp_count(100), 64);
    }

    #[test]
    fn cache_id_stable_and_sensitive() {
        let a = cache_id("/a.mp4", 1.0, 5.0, 8, 32, 400);
        let b = cache_id("/a.mp4", 1.0, 5.0, 8, 32, 400);
        assert_eq!(a, b);
        assert_ne!(a, cache_id("/b.mp4", 1.0, 5.0, 8, 32, 400));
        assert_ne!(a, cache_id("/a.mp4", 1.0, 5.0, 9, 32, 400));
        assert_ne!(a, cache_id("/a.mp4", 1.0, 5.0, 8, 32, 480));
    }

    #[test]
    fn even_dim_rounds_up() {
        assert_eq!(even_dim(71), 72);
        assert_eq!(even_dim(72), 72);
        assert_eq!(even_dim(1), 2);
    }

    #[test]
    fn vf_single_tile_contain_pads_target() {
        let vf = filmstrip_vf(1, 32, 10.0, 200);
        assert!(vf.contains("force_original_aspect_ratio=decrease"), "vf={vf}");
        assert!(vf.contains("pad=200:32:"), "vf={vf}");
        assert!(!vf.contains("crop="), "vf={vf}");
        assert!(!vf.contains("tile"), "vf={vf}");
    }

    #[test]
    fn vf_multi_tiles_even_cells() {
        // 400px / 8 tiles → cell 50 (even)
        let vf = filmstrip_vf(8, 32, 4.0, 400);
        assert!(vf.contains("tile=8x1"), "vf={vf}");
        assert!(vf.contains("pad=50:32:"), "vf={vf}");
        assert!(vf.contains("force_original_aspect_ratio=decrease"), "vf={vf}");
        assert!(vf.contains("fps="), "vf={vf}");
    }

    #[test]
    fn vf_odd_tile_width_becomes_even() {
        // 71px cells would break pad; geometry must even them.
        let (n, h, sheet_w) = sheet_geometry(10, 40, 10.0, 710);
        assert_eq!(n, 10);
        assert_eq!(h % 2, 0);
        assert_eq!((sheet_w / n) % 2, 0);
        let vf = filmstrip_vf(10, 40, 10.0, 710);
        let cell = sheet_w / n;
        assert!(vf.contains(&format!("pad={cell}:{h}:")), "vf={vf}");
    }

    #[test]
    fn args_include_seek_trim_and_output() {
        let args = filmstrip_args("/in.mp4", 1.5, 3.0, 6, 32, 300, "/tmp/out.jpg");
        assert!(args.contains(&"-ss".to_string()));
        assert!(args.contains(&"1.500".to_string()));
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"3.000".to_string()));
        assert!(args.contains(&"/in.mp4".to_string()));
        assert!(args.contains(&"-update".to_string()));
        assert_eq!(args.last().unwrap(), "/tmp/out.jpg");
        let vf_i = args.iter().position(|a| a == "-vf").unwrap();
        assert!(args[vf_i + 1].contains("tile=6x1"));
        // 300→ even sheet; 6 tiles of even cell width
        assert!(args[vf_i + 1].contains("pad=50:32:") || args[vf_i + 1].contains("pad=52:32:"), "vf={}", args[vf_i + 1]);
    }
}
