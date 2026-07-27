mod deps;
mod export;
mod geometry;
mod probe;
mod settings;

use deps::check_deps;
use probe::probe_media;
use settings::{default_export_dir, load_settings, reveal_in_folder, save_settings};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_deps,
            load_settings,
            save_settings,
            default_export_dir,
            reveal_in_folder,
            probe_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
