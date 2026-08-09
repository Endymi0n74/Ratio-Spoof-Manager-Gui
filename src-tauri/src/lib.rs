use tauri::Manager;

mod commands;
mod session;
mod settings;
mod process;

use session::SessionManager;
use settings::AppSettings;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SessionManager::new())
        .manage(AppSettings::load())
        .invoke_handler(tauri::generate_handler![
            commands::launch_session,
            commands::stop_session,
            commands::pause_session,
            commands::resume_session,
            commands::get_sessions,
            commands::get_session_logs,
            commands::get_settings,
            commands::save_settings,
            commands::pick_torrent,
            commands::pick_executable,
            commands::get_presets,
            commands::validate_field,
		.invoke_handler(tauri::generate_handler![
// ... tes commandes existantes ...
			save_settings
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.get_webview_window("main").unwrap().open_devtools();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
#[tauri::command]
fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    // TODO: ecrire dans un fichier JSON ou SQLite
    Ok(())
}








