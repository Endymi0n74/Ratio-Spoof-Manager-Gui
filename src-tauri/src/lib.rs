mod commands;
mod ipc_guard;
mod session;
mod settings;
mod process;
// Tests de contrat du manifeste `latest.json` de l'auto-updater.
#[cfg(test)]
mod updater_manifest;

use session::SessionManager;
use settings::AppSettings;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        // Auto-mise à jour : téléchargement/signature des artefacts (updater)
        // + redémarrage après installation (process::relaunch).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer par la croix / Alt+F4 ne passe pas par `quit_app` : sans
            // ceci, les moteurs survivent sur Unix (pas de job kill_on_close).
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                use tauri::Manager;
                let manager = window.state::<SessionManager>();
                tauri::async_runtime::block_on(manager.shutdown(crate::process::SHUTDOWN_GRACE_PERIOD));
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
