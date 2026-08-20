/**
 * Activity status — "Playing X", the Discord-shaped thing.
 *
 * Matrix has no rich presence, so this is a Greenhouse field published in your
 * extended profile alongside the banner and pronouns. That has a consequence
 * worth being straight about: **other Greenhouse users see it, other Matrix
 * clients do not**, and on a homeserver without extended profiles it is
 * visible only to you. The UI says which.
 *
 * Detection is opt-in and narrow. Nothing is watched unless you name it, the
 * watchlist never leaves this machine, and publishing is a separate step from
 * detecting. A chat client that quietly reported everything you had open
 * would be spyware with a nice icon.
 */

import { invoke } from "@tauri-apps/api/core";

export const ACTIVITY_KINDS = [
	{ id: "playing", label: "Playing" },
	{ id: "listening", label: "Listening to" },
	{ id: "watching", label: "Watching" },
	{ id: "working", label: "Working on" },
	{ id: "custom", label: "Custom" }
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]["id"];

export interface Activity {
	kind: ActivityKind;
	name: string;
}

export const EMPTY_ACTIVITY: Activity = { kind: "playing", name: "" };

export const activity = $state({
	/** What is published right now. */
	current: { ...EMPTY_ACTIVITY },
	/** Detect from running programs rather than typing it. */
	auto: false,
	/** Program names to watch. Only these are ever looked for. */
	watchlist: [] as string[],
	/** What the last scan found running. */
	detected: [] as string[]
});

const KEY = "greenhouse.activity";

export function loadActivity(): void {
	if (typeof localStorage === "undefined") return;
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
		if (!raw || typeof raw !== "object") return;
		activity.auto = raw.auto === true;
		activity.watchlist = Array.isArray(raw.watchlist)
			? raw.watchlist.filter((entry: unknown) => typeof entry === "string").slice(0, 40)
			: [];
		activity.current = sanitiseActivity(raw.current);
	} catch {
		/* defaults stand */
	}
}

function persist(): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(
		KEY,
		JSON.stringify({
			auto: activity.auto,
			watchlist: activity.watchlist,
			current: activity.current
		})
	);
}

/**
 * An activity is remote input when it belongs to somebody else, so it is
 * checked the same way as the rest of a profile: a known kind, and a name
 * short enough to render.
 */
export function sanitiseActivity(input: unknown): Activity {
	if (!input || typeof input !== "object") return { ...EMPTY_ACTIVITY };
	const raw = input as Partial<Activity>;
	return {
		kind: ACTIVITY_KINDS.some((option) => option.id === raw.kind)
			? (raw.kind as ActivityKind)
			: "playing",
		name: typeof raw.name === "string" ? raw.name.slice(0, 80) : ""
	};
}

/** `playing|Some Game`, or "" when there is nothing to say. */
export function encodeActivity(value: Activity): string {
	const clean = sanitiseActivity(value);
	if (!clean.name.trim()) return "";
	return `${clean.kind}|${clean.name.trim()}`;
}

export function decodeActivity(value: unknown): Activity {
	if (typeof value !== "string" || !value.includes("|")) return { ...EMPTY_ACTIVITY };
	const divider = value.indexOf("|");
	return sanitiseActivity({ kind: value.slice(0, divider), name: value.slice(divider + 1) });
}

/** "Playing Some Game", or "" when empty. */
export function activityLabel(value: Activity): string {
	const clean = sanitiseActivity(value);
	if (!clean.name.trim()) return "";
	if (clean.kind === "custom") return clean.name;
	const kind = ACTIVITY_KINDS.find((option) => option.id === clean.kind);
	return `${kind?.label ?? "Playing"} ${clean.name}`;
}

export function setActivity(value: Activity): void {
	activity.current = sanitiseActivity(value);
	persist();
}

export function setAuto(enabled: boolean): void {
	activity.auto = enabled;
	if (!enabled) activity.detected = [];
	persist();
}

export function addToWatchlist(name: string): void {
	const clean = name.trim().slice(0, 60);
	if (!clean || activity.watchlist.includes(clean)) return;
	activity.watchlist = [...activity.watchlist, clean].slice(0, 40);
	persist();
}

export function removeFromWatchlist(name: string): void {
	activity.watchlist = activity.watchlist.filter((entry) => entry !== name);
	persist();
}

/** Everything currently running, for the picker. Only called on demand. */
export async function listProcesses(): Promise<string[]> {
	try {
		return await invoke<string[]>("list_processes");
	} catch {
		return [];
	}
}

/**
 * Check the watchlist and update the activity if it changed.
 *
 * Returns true when the published activity should be re-sent. The caller
 * decides whether to publish, because detection and publishing are separate
 * on purpose.
 */
export async function detectOnce(): Promise<boolean> {
	if (!activity.auto || !activity.watchlist.length) return false;

	let running: string[] = [];
	try {
		running = await invoke<string[]>("running_from", { watchlist: activity.watchlist });
	} catch {
		return false;
	}
	activity.detected = running;

	// First match in watchlist order, so the user's own ordering is the
	// priority rather than whatever the process table happened to return.
	const first = activity.watchlist.find((entry) => running.includes(entry)) ?? "";
	const next: Activity = { kind: activity.current.kind, name: first };

	if (next.name === activity.current.name) return false;
	activity.current = next;
	persist();
	return true;
}

export function resetActivity(): void {
	activity.current = { ...EMPTY_ACTIVITY };
	activity.detected = [];
}
