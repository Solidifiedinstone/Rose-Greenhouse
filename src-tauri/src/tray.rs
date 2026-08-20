//! The system tray icon.
//!
//! Two jobs: a way back to the window when it is hidden, and a place to show
//! that something is waiting. The tooltip carries the unread count because a
//! numeric badge is not something every Linux tray implementation supports —
//! promising one and having it silently not appear would be worse than a
//! tooltip that always works.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Bring the window back and focus it.
fn show_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Rose Greenhouse", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("default window icon".into())
        })?)
        .tooltip("Rose Greenhouse")
        .menu(&menu)
        // The menu is for the right button only; a left click should just
        // bring the window back, which is what people expect from a tray icon.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Reflect the unread count in the tray tooltip.
///
/// Called from the frontend, which is the only place that knows what Matrix
/// considers unread — the push rules live there.
#[tauri::command]
pub fn set_unread(app: AppHandle, total: u32, highlights: u32) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };

    let tooltip = match (total, highlights) {
        (0, _) => "Rose Greenhouse".to_string(),
        (t, 0) => format!("Rose Greenhouse — {t} unread"),
        (t, h) => format!("Rose Greenhouse — {t} unread, {h} mentioning you"),
    };
    tray.set_tooltip(Some(&tooltip))
        .map_err(|err| format!("could not set tray tooltip: {err}"))
}
