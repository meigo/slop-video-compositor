//! External tool detection (`ffmpeg`) via PATH `which`.

use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct DepsStatus {
    pub ffmpeg: bool,
    pub ffmpeg_path: Option<String>,
}

pub fn which(bin: &str) -> Option<String> {
    // Prefer `which` on macOS/Linux
    let output = Command::new("which").arg(bin).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[tauri::command]
pub fn check_deps() -> DepsStatus {
    let ffmpeg_path = which("ffmpeg");
    DepsStatus {
        ffmpeg: ffmpeg_path.is_some(),
        ffmpeg_path,
    }
}
