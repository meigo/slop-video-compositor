//! Media probe via `ffmpeg -i` stderr parsing.

use crate::deps::which;
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MediaMeta {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
}

/// Parse ffmpeg probe stderr (Duration + first Video stream WxH + Audio presence).
///
/// Restricts scanning to the input section (before "Stream mapping:" / "Output #")
/// so remux/null output streams are not double-counted.
pub fn parse_ffmpeg_probe_output(stderr: &str) -> Result<MediaMeta, String> {
    let input = input_section(stderr);

    let duration = parse_duration(input)
        .ok_or_else(|| "Could not parse Duration from ffmpeg output".to_string())?;
    let (width, height) = parse_video_size(input)
        .ok_or_else(|| "Could not parse video dimensions from ffmpeg output".to_string())?;
    let has_audio = input_has_audio(input);

    Ok(MediaMeta {
        duration,
        width,
        height,
        has_audio,
    })
}

fn input_section(stderr: &str) -> &str {
    if let Some(i) = stderr.find("Stream mapping:") {
        return &stderr[..i];
    }
    if let Some(i) = stderr.find("Output #") {
        return &stderr[..i];
    }
    stderr
}

fn parse_duration(s: &str) -> Option<f64> {
    let key = "Duration: ";
    let idx = s.find(key)?;
    let rest = &s[idx + key.len()..];
    let token = rest
        .split(|c: char| c == ',' || c.is_whitespace())
        .next()
        .unwrap_or("");
    if token.is_empty() || token == "N/A" {
        return None;
    }
    parse_hms(token)
}

fn parse_hms(token: &str) -> Option<f64> {
    let mut parts = token.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let sec: f64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// First `Video:` line containing `WIDTHxHEIGHT` (e.g. 1920x1080).
fn parse_video_size(s: &str) -> Option<(u32, u32)> {
    for line in s.lines() {
        if !line.contains("Video:") {
            continue;
        }
        if let Some(wh) = find_wxh(line) {
            return Some(wh);
        }
    }
    None
}

fn find_wxh(line: &str) -> Option<(u32, u32)> {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'x' {
                let w_str = &line[start..i];
                i += 1; // skip 'x'
                let h_start = i;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i > h_start {
                    // Avoid matching things like "0x1" stream ids in brackets when
                    // they appear as hex — require sensible video dimensions.
                    if let (Ok(w), Ok(h)) = (w_str.parse::<u32>(), line[h_start..i].parse::<u32>()) {
                        if w > 0 && h > 0 && w < 100_000 && h < 100_000 {
                            // Stream ids look like `0x1` (hex) — skip tiny hex-like pairs
                            // only when the width token is a single digit and height is tiny
                            // *and* preceded by '[' — handled by requiring video-sized dims
                            // is enough: real video is almost always >= 16.
                            if w >= 16 && h >= 16 {
                                return Some((w, h));
                            }
                        }
                    }
                    continue;
                }
            }
        } else {
            i += 1;
        }
    }
    None
}

fn input_has_audio(s: &str) -> bool {
    s.lines().any(|line| line.contains("Audio:"))
}

#[tauri::command]
pub fn probe_media(path: String) -> Result<MediaMeta, String> {
    let ffmpeg = which("ffmpeg").ok_or_else(|| "ffmpeg not found on PATH".to_string())?;

    // Probe only: no full decode. ffmpeg prints format info on stderr then exits
    // non-zero when no output is specified — that is expected.
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-i", &path])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("Error opening input") {
        return Err(format!("Failed to open media file: {path}"));
    }
    parse_ffmpeg_probe_output(&stderr)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_WITH_AUDIO: &str = r#"Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/probe_fixture.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf62.12.100
  Duration: 00:00:02.00, start: 0.000000, bitrate: 264 kb/s
  Stream #0:0[0x1](und): Video: h264 (High 4:4:4 Predictive) (avc1 / 0x31637661), yuv444p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 179 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      encoder         : Lavc62.28.100 libx264
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)
    Metadata:
      handler_name    : SoundHandler
Stream mapping:
  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))
  Stream #0:1 -> #0:1 (aac (native) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Stream #0:0(und): Video: wrapped_avframe, yuv444p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], q=2-31, 200 kb/s, 30 fps, 30 tbn (default)
  Stream #0:1(und): Audio: pcm_s16le, 44100 Hz, mono, s16, 705 kb/s (default)
"#;

    const FIXTURE_NO_AUDIO: &str = r#"Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/video_only.mp4':
  Metadata:
    major_brand     : isom
    encoder         : Lavf58.76.100
  Duration: 00:01:30.50, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1280x720, 4998 kb/s, 24 fps, 24 tbr, 12288 tbn (default)
"#;

    const FIXTURE_LONG_DURATION: &str = r#"Input #0, matroska,webm, from 'clip.mkv':
  Duration: 01:02:03.45, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0: Video: vp9, yuv420p, 3840x2160, SAR 1:1 DAR 16:9, 30 fps
  Stream #0:1: Audio: opus, 48000 Hz, stereo
"#;

    const FIXTURE_MISSING_VIDEO: &str = r#"Input #0, wav, from 'sound.wav':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 1411 kb/s
  Stream #0:0: Audio: pcm_s16le, 44100 Hz, stereo, s16, 1411 kb/s
"#;

    #[test]
    fn parses_video_with_audio() {
        let m = parse_ffmpeg_probe_output(FIXTURE_WITH_AUDIO).unwrap();
        assert!((m.duration - 2.0).abs() < 1e-6);
        assert_eq!(m.width, 1920);
        assert_eq!(m.height, 1080);
        assert!(m.has_audio);
    }

    #[test]
    fn parses_video_without_audio() {
        let m = parse_ffmpeg_probe_output(FIXTURE_NO_AUDIO).unwrap();
        assert!((m.duration - 90.5).abs() < 1e-6);
        assert_eq!((m.width, m.height), (1280, 720));
        assert!(!m.has_audio);
    }

    #[test]
    fn parses_long_duration_and_4k() {
        let m = parse_ffmpeg_probe_output(FIXTURE_LONG_DURATION).unwrap();
        assert!((m.duration - (1.0 * 3600.0 + 2.0 * 60.0 + 3.45)).abs() < 1e-6);
        assert_eq!((m.width, m.height), (3840, 2160));
        assert!(m.has_audio);
    }

    #[test]
    fn rejects_missing_video_stream() {
        let err = parse_ffmpeg_probe_output(FIXTURE_MISSING_VIDEO).unwrap_err();
        assert!(err.to_lowercase().contains("dimension") || err.to_lowercase().contains("video"));
    }

    #[test]
    fn rejects_empty_output() {
        assert!(parse_ffmpeg_probe_output("").is_err());
    }

    #[test]
    fn ignores_output_section_audio_when_input_has_none() {
        // Synthetic: input video-only, but Output # has Audio (should not count)
        let s = r#"Input #0, mov,mp4, from 'v.mp4':
  Duration: 00:00:01.00, start: 0.000000, bitrate: 100 kb/s
  Stream #0:0: Video: h264, yuv420p, 640x360, 30 fps
Stream mapping:
  Stream #0:0 -> #0:0
Output #0, null, to 'pipe:':
  Stream #0:0: Video: wrapped_avframe, 640x360
  Stream #0:1: Audio: pcm_s16le, 44100 Hz, mono
"#;
        let m = parse_ffmpeg_probe_output(s).unwrap();
        assert!(!m.has_audio);
        assert_eq!((m.width, m.height), (640, 360));
    }
}
