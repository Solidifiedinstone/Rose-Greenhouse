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

export const notifications = $state({
	/** Whether the OS has given us permission. Asked for once, lazily. */
	allowed: false,
	asked: false,
	/** Turn the whole feature off without touching DND. */
	enabled: true
});

const ENABLED_KEY = "greenhouse.notifications";

export function loadNotificationPrefs(): void {
	if (typeof localStorage === "undefined") return;
	notifications.enabled = localStorage.getItem(ENABLED_KEY) !== "off";
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

	if (!(await ensurePermission())) return false;

	const sender = room.getMember(event.getSender() ?? "")?.name ?? event.getSender() ?? "Someone";
	const title = room.name && room.name !== sender ? `${sender} — ${room.name}` : sender;

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
