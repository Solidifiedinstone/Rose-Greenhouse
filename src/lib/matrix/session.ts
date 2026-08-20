/**
 * The stored session, as seen from the frontend.
 *
 * Nothing here keeps the access token in the webview's own storage — every
 * call crosses into Rust, which owns the file. See `src-tauri/src/session.rs`
 * for why.
 */

import { invoke } from "@tauri-apps/api/core";

export interface StoredSession {
	homeserver: string;
	user_id: string;
	device_id: string;
	access_token: string;
}

export async function saveSession(session: StoredSession): Promise<void> {
	await invoke("save_session", { session });
}

export async function loadSession(): Promise<StoredSession | null> {
	return (await invoke<StoredSession | null>("load_session")) ?? null;
}

export async function clearSession(): Promise<void> {
	await invoke("clear_session");
}
