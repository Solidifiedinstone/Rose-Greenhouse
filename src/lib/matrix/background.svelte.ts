/**
 * Accounts that are signed in but not on screen.
 *
 * Level 1 of multi-account only synced whichever account you were looking at,
 * which meant the others were invisible until you switched — no unread counts,
 * no notifications, and a wait every time you moved between them.
 *
 * These clients sync in the background so all of that is live. Two rules keep
 * it from turning into a mess:
 *
 *  1. **A background client never writes to `mx`.** That state describes the
 *     account on screen. Two sync loops writing into one set of rooms would
 *     race, and whichever answered last would win.
 *  2. **Each has its own crypto store**, via the same per-account prefix the
 *     foreground uses. Sharing one makes device keys collide silently.
 *
 * The cost is real — a second sync loop, a second store, a second copy of room
 * state — so it is a setting, and it says what it costs.
 */

import { ClientEvent, NotificationCountType, createClient, type MatrixClient } from "matrix-js-sdk";

import { considerEvent } from "./notify.svelte";
import { cryptoPrefix, sessionKey, type StoredSession } from "./session";

export interface AccountBadge {
	unread: number;
	highlights: number;
	/** False until the first sync lands, so the UI can say "connecting". */
	ready: boolean;
}

export const background = $state({
	/** Whether inactive accounts sync at all. */
	enabled: true,
	/** Per-account unread, keyed by session key. */
	badges: {} as Record<string, AccountBadge>
});

const ENABLED_KEY = "greenhouse.backgroundSync";

/** Live background clients, keyed the same way. Never reactive. */
const clients = new Map<string, MatrixClient>();

export function loadBackgroundPref(): void {
	if (typeof localStorage === "undefined") return;
	background.enabled = localStorage.getItem(ENABLED_KEY) !== "off";
}

export function setBackgroundSync(enabled: boolean): void {
	background.enabled = enabled;
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(ENABLED_KEY, enabled ? "on" : "off");
	}
	if (!enabled) stopAll();
}

/**
 * Hand over a client that is already running.
 *
 * Used when switching accounts: the account being left is already synced, so
 * demoting it is far cheaper than tearing it down and building it again — and
 * promoting the target back is instant for the same reason.
 */
export function adopt(session: StoredSession, client: MatrixClient): void {
	const key = sessionKey(session);
	if (!background.enabled) {
		client.stopClient();
		return;
	}
	clients.set(key, client);
	attach(key, client);
	refreshBadge(key);
}

/** Take a client back, ready to become the foreground one. */
export function release(key: string): MatrixClient | null {
	const client = clients.get(key) ?? null;
	if (client) {
		detach(client);
		clients.delete(key);
		delete background.badges[key];
	}
	return client;
}

/** Start syncing an account we do not already have running. */
export async function run(session: StoredSession): Promise<void> {
	const key = sessionKey(session);
	if (!background.enabled || clients.has(key)) return;

	const client = createClient({
		baseUrl: session.homeserver,
		accessToken: session.access_token,
		userId: session.user_id,
		deviceId: session.device_id
	});

	try {
		await client.initRustCrypto({ cryptoDatabasePrefix: cryptoPrefix(session) });
	} catch (error) {
		// An account whose crypto will not start still syncs; it just cannot
		// read encrypted rooms, exactly as in the foreground.
		console.warn(`background crypto failed for ${key}`, error);
	}

	clients.set(key, client);
	background.badges[key] = { unread: 0, highlights: 0, ready: false };
	attach(key, client);

	// Deliberately small: a background account needs counts and new messages,
	// not scrollback nobody is looking at.
	await client.startClient({ initialSyncLimit: 1 });
}

export function stop(key: string): void {
	const client = clients.get(key);
	if (!client) return;
	detach(client);
	client.stopClient();
	clients.delete(key);
	delete background.badges[key];
}

export function stopAll(): void {
	for (const key of [...clients.keys()]) stop(key);
	background.badges = {};
	onChange?.();
}

// ── Listening ────────────────────────────────────────────────────

const handlers = new WeakMap<MatrixClient, { sync: () => void; timeline: () => void }>();

function attach(key: string, client: MatrixClient): void {
	const onSync = () => refreshBadge(key);
	const onTimeline = (...args: unknown[]) => {
		refreshBadge(key);
		const [event, room, , removed, data] = args as [
			Parameters<typeof considerEvent>[0],
			Parameters<typeof considerEvent>[1],
			unknown,
			boolean | undefined,
			{ liveEvent?: boolean } | undefined
		];
		if (removed || !data?.liveEvent) return;
		// Notifications for accounts you are not looking at are the whole point
		// of syncing them; the room name in the title says which one it was.
		void considerEvent(event, room, { client, activeRoomId: null });
	};

	client.on(ClientEvent.Sync, onSync as never);
	client.on("Room.timeline" as never, onTimeline as never);
	handlers.set(client, { sync: onSync, timeline: onTimeline as () => void });
}

function detach(client: MatrixClient): void {
	const found = handlers.get(client);
	if (!found) return;
	client.off(ClientEvent.Sync, found.sync as never);
	client.off("Room.timeline" as never, found.timeline as never);
	handlers.delete(client);
}

function refreshBadge(key: string): void {
	const client = clients.get(key);
	if (!client) return;

	let unread = 0;
	let highlights = 0;
	for (const room of client.getRooms()) {
		if (room.getMyMembership() !== "join") continue;
		unread += room.getUnreadNotificationCount(NotificationCountType.Total) ?? 0;
		highlights += room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
	}

	const existing = background.badges[key];
	if (existing && existing.unread === unread && existing.highlights === highlights) {
		existing.ready = true;
		return;
	}
	background.badges[key] = { unread, highlights, ready: true };
	onChange?.();
}

/**
 * Told when any background count changes.
 *
 * A callback rather than an import, because the tray lives in `client` and
 * importing it here would make the two modules circular. Without this the
 * tray only updated on a *foreground* room rebuild, so a message arriving in
 * a background account left the tooltip stale until you did something else.
 */
let onChange: (() => void) | null = null;

export function onBadgesChanged(callback: (() => void) | null): void {
	onChange = callback;
}

/** Totals across every background account, for the tray. */
export function backgroundTotals(): { unread: number; highlights: number } {
	let unread = 0;
	let highlights = 0;
	for (const badge of Object.values(background.badges)) {
		unread += badge.unread;
		highlights += badge.highlights;
	}
	return { unread, highlights };
}
