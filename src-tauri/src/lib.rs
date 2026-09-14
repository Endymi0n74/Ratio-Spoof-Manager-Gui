mod commands;
mod ipc_guard;
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
        // Garde-fou de panique autour du dispatch IPC : sans lui, une panique
        // dans une commande aborte tout le processus depuis la limite FFI de
        // WebView2 (crash 0xc0000409 — cf. ipc_guard.rs).
        .invoke_handler(ipc_guard::guarded_invoke_handler(tauri::generate_handler![
            commands::launch_session,
            commands::stop_session,
            commands::delete_session,
            commands::pause_session,
            commands::resume_session,
            commands::get_sessions,
            commands::get_sessions_since,
            commands::get_session_logs,
            commands::get_settings,
            commands::save_settings,
            commands::get_build_info,
            commands::pick_torrent,
            commands::pick_executable,
            commands::get_presets,
            commands::validate_field,
            commands::minimize_window,
            commands::quit_app,
        ]))
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                _app.get_webview_window("main").unwrap().open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
