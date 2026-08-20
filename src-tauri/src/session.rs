//! Where the access token lives.
//!
//! A Matrix access token is a bearer credential: anything holding it *is* the
//! account until the device is logged out. The obvious place to put it is
//! `localStorage`, and that is what most web-first clients do — but in a
//! desktop app it buys nothing and costs plenty. `localStorage` is readable by
//! any script that ends up in the webview, it lands in a world-readable
//! profile directory, and it is trivially scraped by anything running as the
//! user.
//!
//! So the token never reaches the webview's storage. It is passed to Rust,
//! written to the app's own config directory with `0600`, and handed back only
//! on request at startup. That is not a hardware keystore and does not pretend
//! to be one — a process running as this user can still read the file — but it
//! removes the token from the browser's attack surface, which is the part an
//! app like this actually controls.
//!
//! A proper OS keyring is the next step up and is tracked in the README.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Everything needed to resume a Matrix session without logging in again.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// The homeserver's actual client API base URL, already resolved through
    /// `.well-known` — not whatever the user typed.
    pub homeserver: String,
    pub user_id: String,
    pub device_id: String,
    pub access_token: String,
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("no config directory: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("could not create {dir:?}: {err}"))?;
    Ok(dir.join("session.json"))
}

/// Tighten permissions to owner-only. A no-op on platforms without Unix modes,
/// where the app data directory is already per-user.
#[cfg(unix)]
fn restrict(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)
        .map_err(|err| format!("could not stat session file: {err}"))?
        .permissions();
    perms.set_mode(0o600);
    fs::set_permissions(path, perms).map_err(|err| format!("could not chmod session file: {err}"))
}

#[cfg(not(unix))]
fn restrict(_path: &PathBuf) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn save_session(app: AppHandle, session: Session) -> Result<(), String> {
    let path = session_path(&app)?;
    let body = serde_json::to_string_pretty(&session)
        .map_err(|err| format!("could not encode session: {err}"))?;

    // Written to a temporary file first and then renamed, so an interrupted
    // write can't leave a half-parsed session that locks the user out of
    // their own client on next launch.
    let temporary = path.with_extension("json.part");
    fs::write(&temporary, body).map_err(|err| format!("could not write session: {err}"))?;
    restrict(&temporary)?;
    fs::rename(&temporary, &path).map_err(|err| format!("could not replace session: {err}"))?;
    Ok(())
}

/// The stored session, or `None` when there isn't one.
///
/// A corrupt or unreadable file is treated as "no session" rather than an
/// error: the recovery is the same either way (show the login screen), and an
/// error dialog on launch that the user cannot act on is just noise.
#[tauri::command]
pub fn load_session(app: AppHandle) -> Result<Option<Session>, String> {
    let path = session_path(&app)?;
    let Ok(body) = fs::read_to_string(&path) else {
        return Ok(None);
    };
    Ok(serde_json::from_str(&body).ok())
}

#[tauri::command]
pub fn clear_session(app: AppHandle) -> Result<(), String> {
    let path = session_path(&app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("could not remove session: {err}")),
    }
}
