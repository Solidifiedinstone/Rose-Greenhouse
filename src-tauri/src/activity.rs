//! Optional detection of what you are running.
//!
//! This is the one feature in the app that looks at anything outside itself,
//! so it is built to be narrow on purpose:
//!
//!  * It is **off unless asked for**, and it only ever answers about programs
//!    the user has explicitly put on a watchlist. A general "what is running"
//!    feed is not something a chat client should have.
//!  * Nothing leaves this machine here. This returns names to the frontend;
//!    publishing an activity is a separate, deliberate act.
//!  * `sysinfo` is used rather than reading `/proc` directly, because the same
//!    code then works on Windows and macOS. Nothing here may be specific to
//!    one operating system.

use std::collections::BTreeSet;

use sysinfo::{ProcessRefreshKind, RefreshKind, System};

/// Process names currently running, deduplicated and sorted.
///
/// Used to populate the watchlist picker. It is only ever called when the
/// settings panel is open and asked for it.
#[tauri::command]
pub fn list_processes() -> Vec<String> {
    let mut system = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()),
    );
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut names: BTreeSet<String> = BTreeSet::new();
    for process in system.processes().values() {
        let name = process.name().to_string_lossy().to_string();
        // Kernel threads and short-lived helpers are noise in a picker meant
        // for "which game or app do you want to show".
        if name.is_empty() || name.starts_with('[') {
            continue;
        }
        names.insert(name);
    }
    names.into_iter().collect()
}

/// Which of the watched names are running right now.
///
/// The watchlist comes from the frontend on every call rather than being
/// stored here: this process should not hold a list of what the user is
/// interested in any longer than it takes to answer.
#[tauri::command]
pub fn running_from(watchlist: Vec<String>) -> Vec<String> {
    if watchlist.is_empty() {
        return Vec::new();
    }

    let mut system = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()),
    );
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let wanted: Vec<String> = watchlist.iter().map(|name| name.to_lowercase()).collect();
    let mut found: BTreeSet<String> = BTreeSet::new();

    for process in system.processes().values() {
        let name = process.name().to_string_lossy().to_lowercase();
        if let Some(hit) = wanted.iter().find(|candidate| **candidate == name) {
            // Report the watchlist's spelling, so the UI shows what the user
            // typed rather than the executable's casing.
            if let Some(original) = watchlist
                .iter()
                .find(|entry| entry.to_lowercase() == *hit)
            {
                found.insert(original.clone());
            }
        }
    }
    found.into_iter().collect()
}
