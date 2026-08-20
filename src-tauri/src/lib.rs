//! Rose Greenhouse — a Matrix client.
//!
//! The Rust side is deliberately thin. Matrix itself is spoken by
//! `matrix-js-sdk` in the webview, which is where the WebRTC stack lives and
//! therefore where voice, video and screen sharing will have to happen. Rust
//! holds the things a webview should not: the access token, and later the
//! window/tray plumbing.

mod session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            session::save_session,
            session::load_session,
            session::clear_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
