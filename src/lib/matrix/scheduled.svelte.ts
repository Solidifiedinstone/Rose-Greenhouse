/**
 * Messages written now and sent later.
 *
 * Matrix has no server-side scheduling, so this is genuinely local: the queue
 * lives on this device and only sends while Greenhouse is running. That is a
 * real limitation, not a detail — a message scheduled for 9am does not arrive
 * if the app is closed at 9am — and the UI says so rather than letting anyone
 * assume otherwise.
 *
 * Two kinds of trigger:
 *   at    — a time. Sends at or after it.
 *   next  — the next time this client is connected and syncing.
 */

export interface Scheduled {
	id: string;
	roomId: string;
	roomName: string;
	body: string;
	/** Milliseconds since the epoch, or null for "next time I'm online". */
	sendAt: number | null;
	createdAt: number;
	/** Set when a send failed, so it is visible rather than retried forever. */
	error: string;
}

const KEY = "greenhouse.scheduled";

export const scheduled = $state({
	queue: [] as Scheduled[]
});

export function loadScheduled(): void {
	if (typeof localStorage === "undefined") return;
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		scheduled.queue = Array.isArray(raw) ? raw.filter(isScheduled) : [];
	} catch {
		scheduled.queue = [];
	}
}

function isScheduled(value: unknown): value is Scheduled {
	if (!value || typeof value !== "object") return false;
	const entry = value as Partial<Scheduled>;
	return (
		typeof entry.id === "string" &&
		typeof entry.roomId === "string" &&
		typeof entry.body === "string" &&
		(entry.sendAt === null || typeof entry.sendAt === "number")
	);
}

function persist(): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(KEY, JSON.stringify(scheduled.queue));
}

let counter = 0;

export function schedule(entry: Omit<Scheduled, "id" | "createdAt" | "error">): void {
	scheduled.queue.push({
		...entry,
		id: `s-${Date.now()}-${(counter += 1)}`,
		createdAt: Date.now(),
		error: ""
	});
	persist();
}

export function unschedule(id: string): void {
	scheduled.queue = scheduled.queue.filter((entry) => entry.id !== id);
	persist();
}

/** Everything waiting for a given room, soonest first. */
export function scheduledFor(roomId: string): Scheduled[] {
	return scheduled.queue
		.filter((entry) => entry.roomId === roomId)
		.sort((a, b) => (a.sendAt ?? 0) - (b.sendAt ?? 0));
}

/**
 * Which entries are due now.
 *
 * Pure, so the rule is testable without a clock or a client. "Next time I am
 * online" is due as soon as this is called at all, because being called means
 * we are.
 */
export function dueNow(queue: Scheduled[], now = Date.now()): Scheduled[] {
	return queue.filter((entry) => !entry.error && (entry.sendAt === null || entry.sendAt <= now));
}

/**
 * Send anything due, using the callback the client supplies.
 *
 * The sender is injected rather than imported so this module never depends on
 * the client — which is also what lets the queue be tested on its own.
 */
export async function flush(
	send: (roomId: string, body: string) => Promise<void>,
	now = Date.now()
): Promise<number> {
	const due = dueNow(scheduled.queue, now);
	let sent = 0;

	for (const entry of due) {
		try {
			await send(entry.roomId, entry.body);
			scheduled.queue = scheduled.queue.filter((item) => item.id !== entry.id);
			sent += 1;
		} catch (error) {
			// Marked rather than dropped or retried in a loop: a message that
			// cannot send should be visible and recoverable, not silently gone
			// and not hammering a server that just refused it.
			const message = error instanceof Error ? error.message : String(error);
			scheduled.queue = scheduled.queue.map((item) =>
				item.id === entry.id ? { ...item, error: message } : item
			);
		}
	}

	if (due.length) persist();
	return sent;
}

export function clearScheduled(): void {
	scheduled.queue = [];
	persist();
}
