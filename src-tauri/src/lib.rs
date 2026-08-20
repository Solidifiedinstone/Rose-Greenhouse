//! Rose Greenhouse — a Matrix client.
//!
//! The Rust side is deliberately thin. Matrix itself is spoken by
//! `matrix-js-sdk` in the webview, which is where the WebRTC stack lives and
//! therefore where voice, video and screen sharing will have to happen. Rust
//! holds the things a webview should not: the access token, and later the
//! window/tray plumbing.

mod activity;
mod session;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // A tray that fails to build should not stop the app starting —
            // some minimal desktops have no tray at all.
            if let Err(error) = tray::build(app.handle()) {
                eprintln!("tray unavailable: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session::save_session,
            session::load_sessions,
            session::set_active_session,
            session::remove_session,
            session::clear_session,
            tray::set_unread,
            activity::list_processes,
            activity::running_from,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
