/**
 * Plain snapshots of Matrix objects, for the UI to render.
 *
 * The SDK's `Room`, `MatrixEvent` and `RoomMember` are large, mutable, and
 * full of methods and back-references. Handing them to Svelte's `$state`
 * would deep-proxy them — which is both very slow and a good way to confuse
 * an SDK that expects to own its own objects.
 *
 * So nothing from the SDK crosses into reactive state. It is flattened here
 * into small immutable records first, and the UI only ever sees these. That
 * boundary is the single most important performance decision in the app: a
 * room list of 500 rooms is 500 tiny objects, not 500 live proxies.
 */

export interface RoomView {
	id: string;
	name: string;
	/** `mxc://` URI, unresolved. The UI turns it into an HTTP URL when needed. */
	avatarUrl: string | null;
	topic: string;
	isDirect: boolean;
	isSpace: boolean;
	isEncrypted: boolean;
	/** Total unread, and how many of those actually mention you. */
	unread: number;
	highlights: number;
	/** Timestamp of the newest event, for ordering. */
	lastActivity: number;
	/** A one-line preview of the last message, already rendered to text. */
	preview: string;
	/** Which space this room belongs to, if any. Empty means "no space". */
	spaceIds: string[];
	membership: "join" | "invite" | "leave" | "unknown";
}

export interface MemberView {
	userId: string;
	name: string;
	avatar: string | null;
	/** 100 admin, 50 moderator, 0 default — Matrix's convention, not a rule. */
	power: number;
	membership: "join" | "invite";
	/** Set from presence when the server publishes it. */
	presence: "online" | "unavailable" | "offline" | "unknown";
}

/**
 * The label for a power level.
 *
 * 100/50/0 are conventions rather than spec, and a room can use any number,
 * so anything unusual is shown as the raw value instead of being forced into
 * a name that would misdescribe it.
 */
export function powerLabel(power: number): string {
	if (power >= 100) return "Admin";
	if (power >= 50) return "Moderator";
	if (power > 0) return `Level ${power}`;
	return "";
}

/** Members sorted the way people look for them: power, then name. */
export function sortMembers(members: MemberView[]): MemberView[] {
	return [...members].sort((a, b) => {
		if (a.membership !== b.membership) return a.membership === "join" ? -1 : 1;
		if (a.power !== b.power) return b.power - a.power;
		return a.name.localeCompare(b.name);
	});
}

export interface Reaction {
	key: string;
	count: number;
	/** True when you are one of the reactors, so the pill can highlight. */
	mine: boolean;
	/** The reaction event you sent, needed to redact it when un-reacting. */
	myEventId: string | null;
	/** Who reacted, for the tooltip. */
	who: string[];
}

export type MessageKind =
	| "text"
	| "emote"
	| "notice"
	| "image"
	| "file"
	| "video"
	| "audio"
	| "redacted"
	| "state"
	| "unsupported";

export interface MessageView {
	id: string;
	roomId: string;
	sender: string;
	senderName: string;
	senderAvatar: string | null;
	timestamp: number;
	kind: MessageKind;
	/** The plain-text body. Always present, even for media (the filename). */
	body: string;
	/** Sanitised HTML, when the event carried a formatted body. */
	html: string | null;
	/** `mxc://` for plain media events. */
	mediaUrl: string | null;
	/**
	 * The `file` block of an encrypted attachment: ciphertext location plus
	 * the key to decrypt it. Present instead of `mediaUrl` in encrypted rooms.
	 */
	encryptedFile: Record<string, unknown> | null;
	mimeType: string | null;
	fileSize: number | null;
	/** Pixel dimensions, when the sender included them. */
	mediaWidth: number | null;
	mediaHeight: number | null;
	/** Set when the event failed to decrypt, so the UI can say so honestly. */
	decryptionFailed: boolean;
	/** True while the event is only local — sent, not yet acknowledged. */
	pending: boolean;
	/** Set when sending failed outright. */
	failed: boolean;
	/** True when this event has been edited; body already reflects the edit. */
	edited: boolean;
	/** The event this replies to, if any. */
	replyTo: string | null;
	/** Enough of the replied-to message to render the quote line. */
	replyPreview: { sender: string; body: string } | null;
	/** Emoji reactions, already grouped and counted. */
	reactions: Reaction[];
	/**
	 * Set on a message that has a thread hanging off it.
	 *
	 * Only ever present on the *root* — replies inside a thread live in the
	 * thread's own timeline, not the room's, so they never carry this.
	 */
	thread: { replies: number; lastActivity: number } | null;
	/** True when you sent it — gates edit and delete later. */
	mine: boolean;
	/**
	 * True when this message should be drawn tucked under the one above it —
	 * same sender, close in time. Computed once here rather than by every
	 * component that renders a list.
	 */
	continuation: boolean;
}

/** How long two messages from one person can be apart and still group. */
export const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/**
 * Mark the messages that should render without a repeated avatar and name.
 *
 * Pure, and separated from the SDK on purpose: this is the rule most likely
 * to be tweaked for taste, and it should be testable without a homeserver.
 */
export function markContinuations(messages: MessageView[]): MessageView[] {
	let previous: MessageView | null = null;
	return messages.map((message) => {
		const grouped =
			previous !== null &&
			previous.sender === message.sender &&
			previous.kind !== "state" &&
			message.kind !== "state" &&
			message.kind !== "emote" &&
			message.timestamp - previous.timestamp < GROUPING_WINDOW_MS;

		const result = grouped === message.continuation ? message : { ...message, continuation: grouped };
		previous = result;
		return result;
	});
}

/**
 * Order rooms the way a person expects to find them.
 *
 * Invites first — they're the only entry that needs an action. Then anything
 * with a mention, then anything unread, then by recency. Straight recency
 * alone buries an invite the moment a busy room says anything.
 */
export function sortRooms(rooms: RoomView[]): RoomView[] {
	return [...rooms].sort((a, b) => {
		if (a.membership !== b.membership) {
			if (a.membership === "invite") return -1;
			if (b.membership === "invite") return 1;
		}
		if ((a.highlights > 0) !== (b.highlights > 0)) return a.highlights > 0 ? -1 : 1;
		if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
		return b.lastActivity - a.lastActivity;
	});
}

/**
 * A stable colour per user, picked from the theme's palette.
 *
 * Stable so a face is recognisable before you have read the name, and taken
 * from the theme because a room list is mostly avatars — a palette fixed
 * independently of the theme is guaranteed to fight every theme somebody
 * writes.
 */
export function colourForId(id: string, palette: string[]): string {
	if (!palette.length) return "hsl(0 0% 40%)";
	return palette[hashOf(id) % palette.length];
}

/** A small stable hash. Not cryptographic; it only has to be consistent. */
export function hashOf(text: string): number {
	let hash = 0;
	for (let index = 0; index < text.length; index += 1) {
		hash = (hash * 31 + text.charCodeAt(index)) | 0;
	}
	return Math.abs(hash);
}

/** Up to two letters for an avatar with no picture. */
export function initials(name: string): string {
	// A bare Matrix ID gets its server dropped first. Without this,
	// "@gavin:example.org" splits on the dot in the domain and initials as
	// "GO" — the user's first letter and the TLD's, which means nothing.
	const withoutServer = /^[@#!+]/.test(name) ? name.split(":")[0] : name;
	const cleaned = withoutServer.replace(/^[@#!+]/, "").trim();
	if (!cleaned) return "?";
	const words = cleaned.split(/[\s._-]+/).filter(Boolean);
	if (words.length >= 2) {
		return (words[0][0] + words[1][0]).toUpperCase();
	}
	return cleaned.slice(0, 2).toUpperCase();
}

/** "14:32" for today, "Tue 14:32" this week, "12 Aug" beyond that. */
export function formatTimestamp(
	timestamp: number,
	now = Date.now(),
	clock: "24h" | "12h" = "24h"
): string {
	const date = new Date(timestamp);
	const time = date.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hour12: clock === "12h"
	});
	const age = now - timestamp;

	const sameDay = new Date(now).toDateString() === date.toDateString();
	if (sameDay) return time;
	if (age < 7 * 24 * 60 * 60 * 1000) {
		return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
	}
	return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "1.4 MB". Used for attachments. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
