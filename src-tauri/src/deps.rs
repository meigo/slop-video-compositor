//! External tool detection (`ffmpeg`) via PATH and well-known install locations.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct DepsStatus {
    pub ffmpeg: bool,
    pub ffmpeg_path: Option<String>,
}

fn path_looks_runnable(path: &str) -> bool {
    Path::new(path).is_file()
}

/// First line of stdout from a path lookup command (trimmed).
fn first_path_line(stdout: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(stdout);
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        None
    } else {
        Some(line.to_string())
    }
}

/// Lookup `bin` on the process PATH (`which` / `where`).
fn which_on_path(bin: &str) -> Option<String> {
    #[cfg(windows)]
    {
        let output = Command::new("where").arg(bin).output().ok()?;
        if !output.status.success() {
            return None;
        }
        first_path_line(&output.stdout)
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("which").arg(bin).output().ok()?;
        if !output.status.success() {
            return None;
        }
        first_path_line(&output.stdout)
    }
}

/// Well-known absolute paths when GUI apps inherit a minimal PATH (macOS Finder, etc.).
pub fn known_bin_paths(bin: &str) -> Vec<String> {
    if bin != "ffmpeg" && bin != "ffprobe" {
        return Vec::new();
    }
    #[cfg(target_os = "macos")]
    {
        return vec![
            format!("/opt/homebrew/bin/{bin}"),
            format!("/usr/local/bin/{bin}"),
            format!("/usr/bin/{bin}"),
        ];
    }
    #[cfg(target_os = "linux")]
    {
        return vec![
            format!("/usr/bin/{bin}"),
            format!("/usr/local/bin/{bin}"),
            format!("/snap/bin/{bin}"),
        ];
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = bin;
        Vec::new()
    }
}

/// Resolve `bin` via PATH, then known install locations. Returns absolute path if found.
pub fn which(bin: &str) -> Option<String> {
    if let Some(p) = which_on_path(bin) {
        if path_looks_runnable(&p) {
            return Some(p);
        }
    }
    for candidate in known_bin_paths(bin) {
        if path_looks_runnable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command]
pub fn check_deps() -> DepsStatus {
    let ffmpeg_path = which("ffmpeg");
    DepsStatus {
        ffmpeg: ffmpeg_path.is_some(),
        ffmpeg_path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_paths_include_homebrew_on_unix_like() {
        let paths = known_bin_paths("ffmpeg");
        #[cfg(target_os = "macos")]
        {
            assert!(paths.iter().any(|p| p.ends_with("/opt/homebrew/bin/ffmpeg")));
            assert!(paths.iter().any(|p| p.ends_with("/usr/local/bin/ffmpeg")));
        }
        #[cfg(target_os = "linux")]
        {
            assert!(paths.iter().any(|p| p.ends_with("/usr/bin/ffmpeg")));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            assert!(paths.is_empty());
        }
    }

    #[test]
    fn known_paths_ignore_unknown_bins() {
        assert!(known_bin_paths("curl").is_empty());
    }
}
