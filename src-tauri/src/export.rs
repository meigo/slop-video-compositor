//! Export segment types, pure ffmpeg argv / concat-list builders, and encode pipeline.

use crate::deps::which;
use crate::geometry::draw_rect;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// One flattened segment from the frontend (serde).
#[derive(Debug, Clone, PartialEq, Deserialize)]
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
    Black {
        duration: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ExportOpts {
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub segments: Vec<ExportSegment>,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportResult {
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportProgress {
    pub phase: String,
    pub message: String,
    pub pct: Option<f64>,
}

/// RAII cleanup for the export temp directory.
struct TempDir(PathBuf);

impl TempDir {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn stderr_tail(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let start = t
        .char_indices()
        .rev()
        .nth(max.saturating_sub(1))
        .map(|(i, _)| i)
        .unwrap_or(0);
    t[start..].to_string()
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
    let tail = stderr_tail(&stderr, 500);
    if tail.is_empty() {
        Err(format!(
            "ffmpeg failed with status {}",
            output.status.code().unwrap_or(-1)
        ))
    } else {
        Err(format!("ffmpeg failed: {tail}"))
    }
}

fn emit_progress(app: &AppHandle, phase: &str, message: impl Into<String>, pct: Option<f64>) {
    let _ = app.emit(
        "export-progress",
        ExportProgress {
            phase: phase.into(),
            message: message.into(),
            pct,
        },
    );
}

fn make_temp_dir() -> Result<TempDir, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("slop-vc-{nanos}"));
    fs::create_dir_all(&dir).map_err(|e| format!("create temp dir: {e}"))?;
    Ok(TempDir(dir))
}

/// Encode segments with ffmpeg and concat to `opts.output_path`.
#[tauri::command]
pub async fn export_project(app: AppHandle, opts: ExportOpts) -> Result<ExportResult, String> {
    if opts.segments.is_empty() {
        return Err("nothing to export".into());
    }

    let ffmpeg = which("ffmpeg").ok_or_else(|| "ffmpeg not found on PATH".to_string())?;

    let output_path = PathBuf::from(&opts.output_path);
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("create output directory {}: {e}", parent.display()))?;
        }
    }

    let temp = make_temp_dir()?;
    let n = opts.segments.len();
    let mut segment_paths: Vec<String> = Vec::with_capacity(n);

    for (i, seg) in opts.segments.iter().enumerate() {
        let seg_name = format!("seg{i:04}.mp4");
        let seg_path = temp.path().join(&seg_name);
        let seg_path_str = seg_path.to_string_lossy().into_owned();

        let pct = Some((i as f64) / (n as f64 + 1.0));
        emit_progress(
            &app,
            "segment",
            format!("Encoding segment {}/{}", i + 1, n),
            pct,
        );

        let args = match seg {
            ExportSegment::Clip { .. } => {
                clip_segment_args(seg, opts.canvas_width, opts.canvas_height, &seg_path_str)
            }
            ExportSegment::Black { duration } => black_segment_args(
                *duration,
                opts.canvas_width,
                opts.canvas_height,
                &seg_path_str,
            ),
        };

        run_ffmpeg(&ffmpeg, &args)?;
        segment_paths.push(seg_path_str);
    }

    emit_progress(
        &app,
        "concat",
        "Concatenating segments",
        Some(n as f64 / (n as f64 + 1.0)),
    );

    let list_path = temp.path().join("concat.txt");
    let list_body = concat_list_body(&segment_paths);
    fs::write(&list_path, list_body).map_err(|e| format!("write concat list: {e}"))?;

    let list_str = list_path.to_string_lossy().into_owned();
    let out_str = opts.output_path.clone();

    let copy_args = vec![
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        list_str.clone(),
        "-c".into(),
        "copy".into(),
        out_str.clone(),
    ];

    if run_ffmpeg(&ffmpeg, &copy_args).is_err() {
        let reencode_args = vec![
            "-y".into(),
            "-f".into(),
            "concat".into(),
            "-safe".into(),
            "0".into(),
            "-i".into(),
            list_str,
            "-c:v".into(),
            "libx264".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-c:a".into(),
            "aac".into(),
            "-movflags".into(),
            "+faststart".into(),
            out_str,
        ];
        run_ffmpeg(&ffmpeg, &reencode_args)?;
    }

    // Drop temp before success path (explicit; Drop also cleans up on Err early return).
    drop(temp);

    emit_progress(&app, "done", "Export complete", Some(1.0));

    Ok(ExportResult {
        output_path: opts.output_path,
    })
}

/// Integer pixel geometry for ffmpeg scale/overlay (rounded from float draw rect).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PixelRect {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

fn pixel_draw_rect(
    src_w: u32,
    src_h: u32,
    canvas_w: u32,
    canvas_h: u32,
    scale: f64,
    tx: f64,
    ty: f64,
) -> PixelRect {
    let r = draw_rect(src_w, src_h, canvas_w, canvas_h, scale, tx, ty);
    let w = r.w.round().max(1.0) as u32;
    let h = r.h.round().max(1.0) as u32;
    PixelRect {
        x: r.x.round() as i32,
        y: r.y.round() as i32,
        w,
        h,
    }
}

fn fmt_f(v: f64) -> String {
    // Compact, stable for unit tests; keeps integers without trailing .0 noise.
    if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        // Trim trailing zeros from default Display
        let s = format!("{v}");
        s
    }
}

/// Build ffmpeg argv (without binary) for one clip segment → `out` (re-encode).
///
/// Expects `ExportSegment::Clip`. Panics if given `Black`.
pub fn clip_segment_args(
    seg: &ExportSegment,
    canvas_w: u32,
    canvas_h: u32,
    out: &str,
) -> Vec<String> {
    let ExportSegment::Clip {
        source_path,
        source_start,
        duration,
        scale,
        x,
        y,
        src_w,
        src_h,
        has_audio,
    } = seg
    else {
        panic!("clip_segment_args requires ExportSegment::Clip");
    };

    let px = pixel_draw_rect(*src_w, *src_h, canvas_w, canvas_h, *scale, *x, *y);
    let start = fmt_f(*source_start);
    let dur = fmt_f(*duration);
    let can = format!("{canvas_w}x{canvas_h}");

    let video = format!(
        "[0:v]trim=start={start}:duration={dur},setpts=PTS-STARTPTS,scale={}:{},setsar=1[v];\
color=c=black:s={can}:d={dur}:r=30[bg];\
[bg][v]overlay={}:{}:shortest=1,format=yuv420p[vout]",
        px.w, px.h, px.x, px.y
    );

    let audio = if *has_audio {
        format!(
            "[0:a]atrim=start={start}:duration={dur},asetpts=PTS-STARTPTS,aresample=48000[a]"
        )
    } else {
        format!("anullsrc=r=48000:cl=stereo,atrim=duration={dur}[a]")
    };

    let filter = format!("{video};{audio}");

    vec![
        "-y".into(),
        "-i".into(),
        source_path.clone(),
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[vout]".into(),
        "-map".into(),
        "[a]".into(),
        "-c:v".into(),
        "libx264".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-r".into(),
        "30".into(),
        "-c:a".into(),
        "aac".into(),
        "-t".into(),
        dur,
        out.into(),
    ]
}

/// Black + silence segment args (without binary) → `out`.
pub fn black_segment_args(duration: f64, canvas_w: u32, canvas_h: u32, out: &str) -> Vec<String> {
    let dur = fmt_f(duration);
    let color = format!("color=c=black:s={canvas_w}x{canvas_h}:d={dur}:r=30");
    let anull = "anullsrc=r=48000:cl=stereo".to_string();

    vec![
        "-y".into(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        color,
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        anull,
        "-c:v".into(),
        "libx264".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-r".into(),
        "30".into(),
        "-c:a".into(),
        "aac".into(),
        "-t".into(),
        dur,
        "-shortest".into(),
        out.into(),
    ]
}

/// Concat demuxer file body (`file 'path'` lines). Escapes single quotes in paths.
pub fn concat_list_body(segment_paths: &[String]) -> String {
    let mut body = String::new();
    for p in segment_paths {
        body.push_str("file '");
        body.push_str(&p.replace('\'', "'\\''"));
        body.push_str("'\n");
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_clip(has_audio: bool) -> ExportSegment {
        ExportSegment::Clip {
            source_path: "/tmp/src.mp4".into(),
            source_start: 1.5,
            duration: 2.0,
            scale: 1.0,
            x: 0.0,
            y: 0.0,
            src_w: 100,
            src_h: 100,
            has_audio,
        }
    }

    #[test]
    fn clip_args_contain_trim_scale_overlay_and_encode() {
        // Square 100x100 on 200x100 canvas → letterbox x=50, size 100x100
        let seg = sample_clip(true);
        let args = clip_segment_args(&seg, 200, 100, "/tmp/seg0.mp4");

        assert_eq!(args[0], "-y");
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"/tmp/src.mp4".to_string()));
        assert!(args.contains(&"-filter_complex".to_string()));
        assert!(args.contains(&"-map".to_string()));
        assert!(args.contains(&"[vout]".to_string()));
        assert!(args.contains(&"[a]".to_string()));
        assert!(args.contains(&"libx264".to_string()));
        assert!(args.contains(&"yuv420p".to_string()));
        assert!(args.contains(&"aac".to_string()));
        assert!(args.contains(&"30".to_string()));
        assert_eq!(args.last().unwrap(), "/tmp/seg0.mp4");

        let fc = args
            .iter()
            .position(|a| a == "-filter_complex")
            .map(|i| &args[i + 1])
            .expect("filter_complex");

        assert!(fc.contains("trim=start=1.5:duration=2"), "fc={fc}");
        assert!(fc.contains("scale=100:100"), "fc={fc}");
        assert!(fc.contains("setsar=1"), "fc={fc}");
        assert!(fc.contains("color=c=black:s=200x100:d=2:r=30"), "fc={fc}");
        assert!(fc.contains("overlay=50:0:shortest=1"), "fc={fc}");
        assert!(fc.contains("format=yuv420p"), "fc={fc}");
        assert!(
            fc.contains("[0:a]atrim=start=1.5:duration=2,asetpts=PTS-STARTPTS,aresample=48000[a]"),
            "fc={fc}"
        );

        // -t duration
        let t_idx = args.iter().position(|a| a == "-t").unwrap();
        assert_eq!(args[t_idx + 1], "2");
    }

    #[test]
    fn clip_args_without_audio_use_anullsrc() {
        let seg = sample_clip(false);
        let args = clip_segment_args(&seg, 200, 100, "/tmp/seg1.mp4");
        let fc = args
            .iter()
            .position(|a| a == "-filter_complex")
            .map(|i| &args[i + 1])
            .unwrap();
        assert!(
            fc.contains("anullsrc=r=48000:cl=stereo,atrim=duration=2[a]"),
            "fc={fc}"
        );
        assert!(!fc.contains("[0:a]"), "fc={fc}");
    }

    #[test]
    fn clip_args_apply_scale_and_pan_geometry() {
        // Matches geometry test: scale=2, pan=(10,-5) → w/h=200, x=60, y=-5
        let seg = ExportSegment::Clip {
            source_path: "/clips/a.mp4".into(),
            source_start: 0.0,
            duration: 3.25,
            scale: 2.0,
            x: 10.0,
            y: -5.0,
            src_w: 100,
            src_h: 100,
            has_audio: true,
        };
        let args = clip_segment_args(&seg, 200, 100, "out.mp4");
        let fc = args
            .iter()
            .position(|a| a == "-filter_complex")
            .map(|i| &args[i + 1])
            .unwrap();
        assert!(fc.contains("scale=200:200"), "fc={fc}");
        assert!(fc.contains("overlay=60:-5:shortest=1"), "fc={fc}");
        assert!(fc.contains("duration=3.25"), "fc={fc}");
    }

    #[test]
    fn black_args_use_color_and_anullsrc() {
        let args = black_segment_args(1.5, 1920, 1080, "/tmp/black.mp4");
        assert_eq!(args[0], "-y");
        assert!(args.contains(&"lavfi".to_string()));
        assert!(args.iter().any(|a| a.starts_with("color=c=black:s=1920x1080:d=1.5:r=30")));
        assert!(args.contains(&"anullsrc=r=48000:cl=stereo".to_string()));
        assert!(args.contains(&"libx264".to_string()));
        assert!(args.contains(&"yuv420p".to_string()));
        assert!(args.contains(&"aac".to_string()));
        assert!(args.contains(&"-shortest".to_string()));
        assert_eq!(args.last().unwrap(), "/tmp/black.mp4");

        let t_idx = args.iter().position(|a| a == "-t").unwrap();
        assert_eq!(args[t_idx + 1], "1.5");
    }

    #[test]
    fn concat_list_body_formats_paths() {
        let paths = vec!["/tmp/a.mp4".into(), "/tmp/b.mp4".into()];
        assert_eq!(
            concat_list_body(&paths),
            "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n"
        );
    }

    #[test]
    fn concat_list_body_escapes_single_quotes() {
        let paths = vec!["/tmp/o'brien.mp4".into()];
        assert_eq!(
            concat_list_body(&paths),
            "file '/tmp/o'\\''brien.mp4'\n"
        );
    }

    #[test]
    fn export_segment_deserializes_clip_and_black() {
        let clip: ExportSegment = serde_json::from_str(
            r#"{
              "kind": "clip",
              "source_path": "/a.mp4",
              "source_start": 0.5,
              "duration": 1.0,
              "scale": 1.0,
              "x": 0.0,
              "y": 0.0,
              "src_w": 640,
              "src_h": 360,
              "has_audio": true
            }"#,
        )
        .unwrap();
        match clip {
            ExportSegment::Clip {
                source_path,
                source_start,
                duration,
                src_w,
                src_h,
                has_audio,
                ..
            } => {
                assert_eq!(source_path, "/a.mp4");
                assert!((source_start - 0.5).abs() < 1e-9);
                assert!((duration - 1.0).abs() < 1e-9);
                assert_eq!((src_w, src_h), (640, 360));
                assert!(has_audio);
            }
            _ => panic!("expected clip"),
        }

        let black: ExportSegment =
            serde_json::from_str(r#"{"kind":"black","duration":2.5}"#).unwrap();
        match black {
            ExportSegment::Black { duration } => assert!((duration - 2.5).abs() < 1e-9),
            _ => panic!("expected black"),
        }
    }

    #[test]
    #[should_panic(expected = "clip_segment_args requires ExportSegment::Clip")]
    fn clip_args_reject_black_segment() {
        let seg = ExportSegment::Black { duration: 1.0 };
        let _ = clip_segment_args(&seg, 100, 100, "out.mp4");
    }

    #[test]
    fn export_opts_deserializes() {
        let opts: ExportOpts = serde_json::from_str(
            r#"{
              "canvas_width": 1920,
              "canvas_height": 1080,
              "segments": [{"kind":"black","duration":1.0}],
              "output_path": "/out/final.mp4"
            }"#,
        )
        .unwrap();
        assert_eq!(opts.canvas_width, 1920);
        assert_eq!(opts.canvas_height, 1080);
        assert_eq!(opts.output_path, "/out/final.mp4");
        assert_eq!(opts.segments.len(), 1);
    }
}
