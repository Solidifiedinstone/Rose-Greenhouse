//! Where the access tokens live.
//!
//! A Matrix access token is a bearer credential: anything holding it *is* the
//! account until the device is logged out. The obvious place to put it is
//! `localStorage`, and that is what most web-first clients do — but in a
//! desktop app it buys nothing and costs plenty. `localStorage` is readable by
//! any script that ends up in the webview, it lands in a world-readable
//! profile directory, and it is trivially scraped by anything running as the
//! user.
//!
//! So tokens never reach the webview's storage. They are passed to Rust,
//! written to the app's own config directory with `0600`, and handed back only
//! on request at startup. That is not a hardware keystore and does not pretend
//! to be one — a process running as this user can still read the file — but it
//! removes the tokens from the browser's attack surface, which is the part an
//! app like this actually controls.
//!
//! This file holds *several* sessions, because the client supports being
//! signed into more than one account. They live in one file rather than one
//! file each so that "which account was I using?" is answered atomically with
//! the list itself.
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

impl Session {
    /// Stable key for one signed-in device.
    ///
    /// The user id alone is not enough: the same account signed in twice is
    /// two devices with two tokens and two separate crypto stores.
    fn key(&self) -> String {
        format!("{}/{}", self.user_id, self.device_id)
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Sessions {
    /// Key of the session to resume on launch.
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub sessions: Vec<Session>,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("no config directory: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("could not create {dir:?}: {err}"))?;
    Ok(dir)
}

fn sessions_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("sessions.json"))
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

fn write(app: &AppHandle, sessions: &Sessions) -> Result<(), String> {
    let path = sessions_path(app)?;
    let body = serde_json::to_string_pretty(sessions)
        .map_err(|err| format!("could not encode sessions: {err}"))?;

    // Written to a temporary file first and then renamed, so an interrupted
    // write can't leave a half-parsed file that locks the user out of every
    // account at once.
    let temporary = path.with_extension("json.part");
    fs::write(&temporary, body).map_err(|err| format!("could not write sessions: {err}"))?;
    restrict(&temporary)?;
    fs::rename(&temporary, &path).map_err(|err| format!("could not replace sessions: {err}"))?;
    Ok(())
}

fn read(app: &AppHandle) -> Sessions {
    let Ok(dir) = config_dir(app) else {
        return Sessions::default();
    };

    if let Ok(body) = fs::read_to_string(dir.join("sessions.json")) {
        if let Ok(parsed) = serde_json::from_str::<Sessions>(&body) {
            return parsed;
        }
    }

    // Migration: earlier versions kept exactly one session in `session.json`.
    // Reading it here means an existing install stays signed in rather than
    // being silently logged out by an upgrade.
    let legacy = dir.join("session.json");
    if let Ok(body) = fs::read_to_string(&legacy) {
        if let Ok(session) = serde_json::from_str::<Session>(&body) {
            let sessions = Sessions {
                active: Some(session.key()),
                sessions: vec![session],
            };
            let _ = write(app, &sessions);
            let _ = fs::remove_file(&legacy);
            return sessions;
        }
    }

    Sessions::default()
}

/// Add or replace a session, and make it the active one.
#[tauri::command]
pub fn save_session(app: AppHandle, session: Session) -> Result<(), String> {
    let mut sessions = read(&app);
    let key = session.key();
    // Signing into an account that is already present replaces it rather than
    // adding a duplicate with a stale token.
    sessions.sessions.retain(|existing| existing.key() != key);
    sessions.sessions.push(session);
    sessions.active = Some(key);
    write(&app, &sessions)
}

/// Every stored session, and which one was last used.
///
/// A corrupt or unreadable file is treated as "no sessions" rather than an
/// error: the recovery is the same either way (show the login screen), and an
/// error dialog on launch that the user cannot act on is just noise.
#[tauri::command]
pub fn load_sessions(app: AppHandle) -> Result<Sessions, String> {
    Ok(read(&app))
}

#[tauri::command]
pub fn set_active_session(app: AppHandle, key: String) -> Result<(), String> {
    let mut sessions = read(&app);
    if !sessions.sessions.iter().any(|s| s.key() == key) {
        return Err(format!("no stored session for {key}"));
    }
    sessions.active = Some(key);
    write(&app, &sessions)
}

/// Forget one account, leaving the others signed in.
#[tauri::command]
pub fn remove_session(app: AppHandle, key: String) -> Result<(), String> {
    let mut sessions = read(&app);
    sessions.sessions.retain(|existing| existing.key() != key);
    if sessions.active.as_deref() == Some(key.as_str()) {
        sessions.active = sessions.sessions.first().map(|s| s.key());
    }
    write(&app, &sessions)
}

/// Forget everything. Used when signing out of the last account.
#[tauri::command]
pub fn clear_session(app: AppHandle) -> Result<(), String> {
    let path = sessions_path(&app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("could not remove sessions: {err}")),
    }
}
