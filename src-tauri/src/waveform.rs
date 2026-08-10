//! Timeline audio waveform PNG generation via ffmpeg `showwavespic` (cached on disk).
//! Full-media sheets only — trim is applied in CSS on the frontend.

use crate::deps::which;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

pub fn clamp_height(height: u32) -> u32 {
    height.clamp(8, 128)
}

pub fn clamp_width(width: u32) -> u32 {
    // Even dims play nicer with some image paths; keep a usable min/max.
    let w = width.clamp(64, 4096);
    w + (w % 2)
}

/// djb2 — stable across Rust versions.
fn djb2(s: &str) -> u64 {
    let mut h: u64 = 5381;
    for b in s.bytes() {
        h = h.wrapping_mul(33).wrapping_add(u64::from(b));
    }
    h
}

pub fn cache_id(path: &str, duration: f64, width: u32, height: u32) -> String {
    let dur_ms = (duration * 1000.0).round() as i64;
    let key = format!(
        "v1-wavespic|{path}|{dur_ms}|{}|{}",
        clamp_width(width),
        clamp_height(height)
    );
    format!("{:016x}", djb2(&key))
}

/// ffmpeg filter: mono waveform picture, light stroke on transparent-ish dark.
pub fn waveform_vf(width: u32, height: u32) -> String {
    let w = clamp_width(width);
    let h = clamp_height(height);
    // Light cyan drawn on black; frontend uses mix-blend / opacity on dark clip bars.
    format!(
        "aformat=channel_layouts=mono,showwavespic=s={w}x{h}:colors=#9ec5ff:scale=sqrt"
    )
}

pub fn waveform_args(input: &str, duration: f64, width: u32, height: u32, out: &str) -> Vec<String> {
    let dur = duration.max(1.0 / 30.0);
    let vf = waveform_vf(width, height);
    vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-t".into(),
        format!("{dur:.3}"),
        "-i".into(),
        input.into(),
        "-filter_complex".into(),
        vf,
        "-frames:v".into(),
        "1".into(),
        "-update".into(),
        "1".into(),
        out.into(),
    ]
}

fn cache_dir() -> Result<PathBuf, String> {
    let base = dirs::cache_dir().ok_or_else(|| "Could not resolve cache directory".to_string())?;
    let dir = base.join("slop-video-compositor").join("waveforms");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create waveform cache: {e}"))?;
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
            "ffmpeg waveform failed with status {}",
            output.status.code().unwrap_or(-1)
        ))
    } else {
        Err(format!("ffmpeg waveform failed: {msg}"))
    }
}

fn png_to_data_url(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read waveform: {e}"))?;
    if bytes.is_empty() {
        return Err("waveform file is empty".into());
    }
    Ok(format!("data:image/png;base64,{}", B64.encode(bytes)))
}

#[derive(Debug, Clone, Deserialize)]
pub struct WaveformOpts {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct WaveformResult {
    pub data_url: String,
    pub cached: bool,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn generate_waveform(
    _app: AppHandle,
    opts: WaveformOpts,
) -> Result<WaveformResult, String> {
    let WaveformOpts {
        path,
        duration,
        width,
        height,
    } = opts;

    if path.trim().is_empty() {
        return Err("empty media path".into());
    }
    if !Path::new(&path).is_file() {
        return Err(format!("media not found: {path}"));
    }

    let dur = duration.max(1.0 / 30.0);
    let w = clamp_width(width);
    let h = clamp_height(height);

    let id = cache_id(&path, dur, w, h);
    let out = cache_dir()?.join(format!("{id}.png"));
    if out.is_file() && out.metadata().map(|m| m.len() > 200).unwrap_or(false) {
        return Ok(WaveformResult {
            data_url: png_to_data_url(&out)?,
            cached: true,
            width: w,
            height: h,
        });
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = out.with_extension(format!("part.{stamp}.png"));
    let args = waveform_args(&path, dur, w, h, &tmp.to_string_lossy());

    let ffmpeg = which("ffmpeg").ok_or_else(|| "ffmpeg not found".to_string())?;
    let ffmpeg2 = ffmpeg.clone();
    let args2 = args.clone();
    tauri::async_runtime::spawn_blocking(move || run_ffmpeg(&ffmpeg2, &args2))
        .await
        .map_err(|e| format!("waveform task join: {e}"))??;

    if !tmp.is_file() {
        return Err("ffmpeg produced no waveform file".into());
    }
    if out.is_file() {
        let _ = std::fs::remove_file(&tmp);
        return Ok(WaveformResult {
            data_url: png_to_data_url(&out)?,
            cached: true,
            width: w,
            height: h,
        });
    }
    std::fs::rename(&tmp, &out).map_err(|e| format!("rename waveform: {e}"))?;
    Ok(WaveformResult {
        data_url: png_to_data_url(&out)?,
        cached: false,
        width: w,
        height: h,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_width_even_bounds() {
        assert_eq!(clamp_width(1), 64);
        assert_eq!(clamp_width(100), 100);
        assert_eq!(clamp_width(101), 102);
        assert_eq!(clamp_width(9000), 4096);
    }

    #[test]
    fn cache_id_stable_and_sensitive() {
        let a = cache_id("/a.mp3", 10.0, 800, 32);
        let b = cache_id("/a.mp3", 10.0, 800, 32);
        assert_eq!(a, b);
        assert_ne!(a, cache_id("/b.mp3", 10.0, 800, 32));
        assert_ne!(a, cache_id("/a.mp3", 10.0, 900, 32));
        assert_ne!(a, cache_id("/a.mp3", 10.0, 800, 40));
    }

    #[test]
    fn vf_contains_showwavespic_size() {
        let vf = waveform_vf(800, 32);
        assert!(vf.contains("showwavespic=s=800x32"), "vf={vf}");
        assert!(vf.contains("aformat=channel_layouts=mono"), "vf={vf}");
    }

    #[test]
    fn args_include_trim_input_and_output() {
        let args = waveform_args("/in.m4a", 12.5, 640, 40, "/tmp/w.png");
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"12.500".to_string()));
        assert!(args.contains(&"/in.m4a".to_string()));
        assert!(args.contains(&"-filter_complex".to_string()));
        assert!(args.contains(&"-update".to_string()));
        assert_eq!(args.last().unwrap(), "/tmp/w.png");
    }
}
