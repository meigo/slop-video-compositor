//! App settings persistence (JSON in app config dir).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub last_export_dir: Option<String>,
    pub last_project_dir: Option<String>,
    /// Timeline panel height in CSS pixels (UI preference).
    #[serde(default)]
    pub timeline_height_px: Option<u32>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            last_export_dir: None,
            last_project_dir: None,
            timeline_height_px: None,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> AppSettings {
    let path = match settings_path(&app) {
        Ok(p) => p,
        Err(_) => return AppSettings::default(),
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn default_export_dir() -> String {
    // ~/Movies/Slop Refs
    let home = dirs::home_dir().unwrap_or_default();
    home.join("Movies")
        .join("Slop Refs")
        .to_string_lossy()
        .into()
}

/// Reject empty paths, NUL bytes, and non-absolute paths (basic command hardening).
fn validate_user_path(path: &str, kind: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err(format!("{kind}: empty path"));
    }
    if path.contains('\0') {
        return Err(format!("{kind}: path contains NUL"));
    }
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(format!("{kind}: path must be absolute"));
    }
    Ok(())
}

/// Read a UTF-8 text file (project JSON, etc.).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    validate_user_path(&path, "read")?;
    std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

/// Write a UTF-8 text file (project JSON, etc.).
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    validate_user_path(&path, "write")?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create parent dir {}: {e}", parent.display()))?;
        }
    }
    std::fs::write(&path, contents).map_err(|e| format!("write {path}: {e}"))
}

/// Reveal `path` in the system file manager (Finder on macOS).
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        use std::path::Path;
        let parent = Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| Path::new(".").to_path_buf());
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_empty_dirs() {
        let s = AppSettings::default();
        assert_eq!(s.last_export_dir, None);
        assert_eq!(s.last_project_dir, None);
        assert_eq!(s.timeline_height_px, None);
    }

    #[test]
    fn default_export_dir_ends_with_slop_refs() {
        let d = default_export_dir();
        assert!(
            d.ends_with("Movies/Slop Refs") || d.ends_with("Movies\\Slop Refs"),
            "unexpected default_export_dir: {d}"
        );
    }

    #[test]
    fn validate_user_path_rejects_relative_and_nul() {
        assert!(validate_user_path("relative.json", "read").is_err());
        assert!(validate_user_path("/tmp/a\0b.json", "read").is_err());
        assert!(validate_user_path("", "read").is_err());
        #[cfg(unix)]
        assert!(validate_user_path("/tmp/project.json", "read").is_ok());
        #[cfg(windows)]
        assert!(validate_user_path(r"C:\tmp\project.json", "read").is_ok());
    }
}
