/**
 * Stored sessions, as seen from the frontend.
 *
 * Nothing here keeps an access token in the webview's own storage — every
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

export interface StoredSessions {
	active: string | null;
	sessions: StoredSession[];
}

/**
 * The key identifying one signed-in device.
 *
 * User id alone is not enough: the same account signed in twice is two
 * devices, with two tokens and — importantly — two separate crypto stores.
 */
export function sessionKey(session: StoredSession): string {
	return `${session.user_id}/${session.device_id}`;
}

/**
 * A filesystem- and IndexedDB-safe name derived from a session.
 *
 * Used to give each account its own crypto store. Without a distinct prefix,
 * two accounts share one store and their device keys collide — which does not
 * fail loudly, it just quietly stops either account decrypting properly.
 */
export function cryptoPrefix(session: StoredSession): string {
	return `greenhouse-${sessionKey(session).replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

export async function saveSession(session: StoredSession): Promise<void> {
	await invoke("save_session", { session });
}

export async function loadSessions(): Promise<StoredSessions> {
	const result = await invoke<StoredSessions | null>("load_sessions");
	return result ?? { active: null, sessions: [] };
}

export async function setActiveSession(key: string): Promise<void> {
	await invoke("set_active_session", { key });
}

export async function removeSession(key: string): Promise<void> {
	await invoke("remove_session", { key });
}

export async function clearSessions(): Promise<void> {
	await invoke("clear_session");
}
