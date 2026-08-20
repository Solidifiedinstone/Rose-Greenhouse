/**
 * Desktop notifications.
 *
 * What to notify about is not a judgement this client makes. Matrix has push
 * rules — per-account, synced across devices, and already tuned by whatever
 * you set in Element — so `getPushActionsForEvent` is asked, and its answer
 * is obeyed. Inventing our own rule ("notify on DMs and mentions") would
 * disagree with every other client you use.
 *
 * Three things suppress a notification, in this order:
 *
 *   1. Do not disturb. Local, immediate, absolute.
 *   2. A muted room, which is a real Matrix push rule and so applies on your
 *      phone too — not a local flag that only silences this machine.
 *   3. Looking at the room already, in a focused window. Notifying someone
 *      about a message they are watching arrive is pure noise.
 */

import {
	isPermissionGranted,
	requestPermission,
	sendNotification
} from "@tauri-apps/plugin-notification";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";

import { silenced } from "./profile.svelte";

/**
 * Quiet hours.
 *
 * Notifications are *held*, not dropped. Anything that arrives during quiet
 * hours is remembered and shown as a single summary when they end — the point
 * is to not be interrupted, not to lose things. Dropping them silently would
 * make this a feature you can't trust with anything that matters.
 *
 * Stored as minutes past midnight so a window can wrap over midnight, which
 * is the common case: 23:00 to 07:00.
 */
export interface QuietHours {
	enabled: boolean;
	/** Minutes past midnight. */
	from: number;
	to: number;
}

export const DEFAULT_QUIET: QuietHours = { enabled: false, from: 23 * 60, to: 7 * 60 };

export function inQuietHours(quiet: QuietHours, now = new Date()): boolean {
	if (!quiet.enabled) return false;
	const minutes = now.getHours() * 60 + now.getMinutes();
	// A window that wraps past midnight is two ranges, not one.
	if (quiet.from === quiet.to) return false;
	if (quiet.from < quiet.to) return minutes >= quiet.from && minutes < quiet.to;
	return minutes >= quiet.from || minutes < quiet.to;
}

export function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60) % 24;
	const mins = minutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export const notifications = $state({
	/** Whether the OS has given us permission. Asked for once, lazily. */
	allowed: false,
	asked: false,
	/** Turn the whole feature off without touching DND. */
	enabled: true,
	quiet: { ...DEFAULT_QUIET } as QuietHours,
	/** What arrived during quiet hours, waiting to be summarised. */
	held: [] as { room: string; sender: string; body: string }[]
});

const ENABLED_KEY = "greenhouse.notifications";
const QUIET_KEY = "greenhouse.quietHours";

export function loadNotificationPrefs(): void {
	if (typeof localStorage === "undefined") return;
	notifications.enabled = localStorage.getItem(ENABLED_KEY) !== "off";
	try {
		const raw = JSON.parse(localStorage.getItem(QUIET_KEY) ?? "null");
		if (raw && typeof raw === "object") {
			notifications.quiet = {
				enabled: raw.enabled === true,
				from: clampMinutes(raw.from, DEFAULT_QUIET.from),
				to: clampMinutes(raw.to, DEFAULT_QUIET.to)
			};
		}
	} catch {
		notifications.quiet = { ...DEFAULT_QUIET };
	}
}

function clampMinutes(value: unknown, fallback: number): number {
	const minutes = Number(value);
	if (!Number.isFinite(minutes)) return fallback;
	return Math.min(24 * 60 - 1, Math.max(0, Math.round(minutes)));
}

export function setQuietHours(quiet: QuietHours): void {
	notifications.quiet = {
		enabled: quiet.enabled,
		from: clampMinutes(quiet.from, DEFAULT_QUIET.from),
		to: clampMinutes(quiet.to, DEFAULT_QUIET.to)
	};
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(QUIET_KEY, JSON.stringify(notifications.quiet));
	}
	if (!inQuietHours(notifications.quiet)) void releaseHeld();
}

/**
 * Show what was held, as one notification rather than a burst.
 *
 * Firing thirty notifications the moment quiet hours end is exactly the
 * interruption they existed to prevent.
 */
export async function releaseHeld(): Promise<void> {
	const held = notifications.held;
	if (!held.length) return;
	notifications.held = [];

	if (!(await ensurePermission())) return;
	const rooms = [...new Set(held.map((entry) => entry.room))];
	const title =
		held.length === 1
			? `${held[0].sender} — ${held[0].room}`
			: `${held.length} messages while you were away`;
	const body =
		held.length === 1
			? held[0].body
			: rooms.slice(0, 4).join(", ") + (rooms.length > 4 ? `, and ${rooms.length - 4} more` : "");

	try {
		sendNotification({ title, body });
	} catch {
		/* nothing to do if the OS refuses at this point */
	}
}

export function setNotificationsEnabled(enabled: boolean): void {
	notifications.enabled = enabled;
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(ENABLED_KEY, enabled ? "on" : "off");
	}
}

/**
 * Ask the OS, once, and only when there is something to show.
 *
 * Prompting on launch trains people to click "deny" before they know what
 * the app is for.
 */
async function ensurePermission(): Promise<boolean> {
	if (notifications.allowed) return true;
	if (notifications.asked) return notifications.allowed;
	notifications.asked = true;
	try {
		let granted = await isPermissionGranted();
		if (!granted) granted = (await requestPermission()) === "granted";
		notifications.allowed = granted;
	} catch {
		notifications.allowed = false;
	}
	return notifications.allowed;
}

/** Is this room muted, per the account's push rules? */
export function isRoomMuted(client: MatrixClient, roomId: string): boolean {
	try {
		const rule = client.getRoomPushRule("global", roomId);
		if (!rule) return false;
		// A mute is a room rule whose actions contain no "notify".
		const actions = rule.actions ?? [];
		return !actions.includes("notify" as never);
	} catch {
		return false;
	}
}

export async function setRoomMuted(
	client: MatrixClient,
	roomId: string,
	muted: boolean
): Promise<void> {
	// A real push rule rather than a local flag, so muting here mutes on your
	// phone too — which is what "mute this room" is expected to mean.
	await client.setRoomMutePushRule("global", roomId, muted);
}

interface Context {
	client: MatrixClient;
	activeRoomId: string | null;
	/** Called when the user clicks through; the caller opens the room. */
	onOpen?: (roomId: string) => void;
}

/**
 * Decide about one event and, if it survives, show it.
 *
 * Returns true when a notification was raised, which the tests and the caller
 * use rather than guessing.
 */
export async function considerEvent(
	event: MatrixEvent,
	room: Room | undefined,
	context: Context
): Promise<boolean> {
	if (!notifications.enabled) return false;
	if (silenced()) return false;
	if (!room) return false;

	// Never notify about your own messages, or about history arriving from a
	// back-pagination — only about things happening now.
	const client = context.client;
	if (event.getSender() === client.getUserId()) return false;
	if (event.isRelation("m.replace")) return false;
	if (Date.now() - event.getTs() > 60_000) return false;

	if (isRoomMuted(client, room.roomId)) return false;

	// Watching the room, in a focused window: they have already seen it.
	const looking =
		context.activeRoomId === room.roomId &&
		typeof document !== "undefined" &&
		document.hasFocus();
	if (looking) return false;

	let notify = false;
	try {
		notify = Boolean(client.getPushActionsForEvent(event)?.notify);
	} catch {
		return false;
	}
	if (!notify) return false;

	const sender = room.getMember(event.getSender() ?? "")?.name ?? event.getSender() ?? "Someone";
	const title = room.name && room.name !== sender ? `${sender} — ${room.name}` : sender;

	// Held rather than dropped, and summarised when quiet hours end.
	if (inQuietHours(notifications.quiet)) {
		notifications.held.push({
			room: room.name || room.roomId,
			sender,
			body: previewFor(event)
		});
		// Bounded: a night of a busy room should not accumulate forever.
		if (notifications.held.length > 200) notifications.held.shift();
		return false;
	}

	if (!(await ensurePermission())) return false;

	try {
		sendNotification({ title, body: previewFor(event) });
		return true;
	} catch {
		return false;
	}
}

/** One line of what was said, without leaking anything encrypted. */
export function previewFor(event: MatrixEvent): string {
	if (event.isDecryptionFailure()) return "Encrypted message";
	if (event.isRedacted()) return "Message deleted";
	const content = event.getContent();
	const body = typeof content.body === "string" ? content.body : "";
	switch (content.msgtype) {
		case "m.image":
			return body ? `📷 ${body}` : "Sent an image";
		case "m.file":
			return body ? `📎 ${body}` : "Sent a file";
		case "m.video":
			return "Sent a video";
		case "m.audio":
			return "Sent audio";
	}
	const text = body.replace(/\s+/g, " ").trim();
	return text.length > 140 ? `${text.slice(0, 137)}…` : text || "New message";
}
