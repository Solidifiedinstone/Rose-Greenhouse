/**
 * Your profile: the bits Matrix standardises, and the bits it doesn't.
 *
 *   Standard — display name, avatar, presence and status message. Every
 *   Matrix client shows these, so changing them here changes what people see
 *   in Element too.
 *
 *   Extras — banner, about me, pronouns. Matrix has no field for these, and
 *   where they are stored decides who can ever see them:
 *
 *     • MSC4133 extended profiles, if the homeserver supports it. These are
 *       genuinely part of your public profile, so another client that reads
 *       them can show them.
 *     • Account data otherwise. Account data is private to its owner, so on
 *       a server without MSC4133 these are visible to *you* and nobody else.
 *
 * That distinction is not cosmetic and the UI reports which one is in force.
 * Saying "other people will see this" when it is account data would be a
 * flat lie about who can read something the user wrote about themselves.
 */

import type { MatrixClient } from "matrix-js-sdk";

import { forgetMxc } from "./upload.svelte";
import { SYSTEM_MONO_STACK, SYSTEM_UI_STACK } from "../theme/fonts";
import { decodeActivity, encodeActivity } from "./activity.svelte";

/** Our own account-data event. Namespaced so it can never collide. */
export const PROFILE_EVENT = "org.rose.greenhouse.profile";

/**
 * Presence as this client understands it.
 *
 * Matrix only defines online / unavailable / offline — there is no "do not
 * disturb" in the spec. DND is therefore a Greenhouse concept: it reports
 * `online` to the server, because you *are* online, and is published in the
 * extended profile so other Greenhouse users see the red dot. What it really
 * does is local and immediate: it silences notifications.
 */
export type Presence = "online" | "dnd" | "unavailable" | "offline";

/** What actually goes to the homeserver. */
function toMatrixPresence(presence: Presence): "online" | "unavailable" | "offline" {
	return presence === "dnd" ? "online" : presence;
}

/**
 * Fonts a profile may be rendered in.
 *
 * Stored as an id, never as a font stack. The value ends up in a `font-family`
 * on a card describing *somebody else*, so it is remote input: an id that has
 * to match this list can't carry anything into CSS, whereas a free-text stack
 * from a stranger's profile is an injection waiting to happen.
 *
 * Generic families only. A profile styled with a font you don't have would
 * fall back silently anyway, so promising specific typefaces across machines
 * would be a promise this cannot keep.
 */
export const PROFILE_FONTS: { id: string; label: string; stack: string }[] = [
	{ id: "default", label: "Default", stack: "inherit" },
	{ id: "sans", label: "Sans-serif", stack: "sans-serif" },
	{ id: "serif", label: "Serif", stack: "serif" },
	{ id: "mono", label: "Monospace", stack: "monospace" },
	{ id: "system", label: "System", stack: SYSTEM_UI_STACK() },
	{ id: "systemmono", label: "System monospace", stack: SYSTEM_MONO_STACK() }
];

export function fontStack(id: string): string {
	return PROFILE_FONTS.find((font) => font.id === id)?.stack ?? "inherit";
}

/** How one element is filled. A fixed set, for the same reason as fonts. */
export const FILL_KINDS = [
	{ id: "flat", label: "Flat" },
	{ id: "gradient", label: "Gradient" },
	{ id: "glass", label: "Glass" },
	{ id: "outline", label: "Outlined" },
	{ id: "none", label: "Use my theme" }
] as const;

export type FillKind = (typeof FILL_KINDS)[number]["id"];

/**
 * A fill for one part of the card — background, name, whatever comes next.
 *
 * Per element rather than one style for the whole card, so a flat background
 * can carry a gradient name, which is the point of letting people style this
 * at all.
 *
 * Encoded as `kind|from|to|angle` rather than JSON. Every field is then a
 * short, individually-checkable token, and a malformed value from somebody
 * else's profile degrades to the default instead of throwing mid-render.
 */
export interface Fill {
	kind: FillKind;
	from: string;
	to: string;
	angle: number;
}

export const DEFAULT_FILL: Fill = { kind: "none", from: "", to: "", angle: 160 };

export function encodeFill(fill: Fill): string {
	if (fill.kind === "none") return "";
	return [fill.kind, fill.from, fill.to, String(fill.angle)].join("|");
}

export function decodeFill(value: unknown): Fill {
	if (typeof value !== "string" || !value.trim()) return { ...DEFAULT_FILL };
	const [kind, from, to, angle] = value.split("|");
	const hex = (candidate: string | undefined) =>
		typeof candidate === "string" && /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : "";
	const parsedAngle = Number(angle);
	return {
		kind: FILL_KINDS.some((option) => option.id === kind) ? (kind as FillKind) : "none",
		from: hex(from),
		to: hex(to),
		angle: Number.isFinite(parsedAngle) ? Math.min(360, Math.max(0, parsedAngle)) : 160
	};
}

/** Turn a fill into a CSS background value, or "" to leave the theme alone. */
export function fillBackground(fill: Fill, fallback: string): string {
	switch (fill.kind) {
		case "flat":
			return fill.from || fallback;
		case "gradient":
			return `linear-gradient(${fill.angle}deg, ${fill.from || fallback}, ${
				fill.to || fill.from || fallback
			})`;
		case "glass":
			return fill.from ? `${fill.from}66` : fallback;
		case "outline":
			return "transparent";
		default:
			return fallback;
	}
}

export interface Extras {
	/** `mxc://` for the profile banner. */
	banner: string | null;
	about: string;
	pronouns: string;
	/** Body text colour on the card. */
	text: string;
	/** One of `PROFILE_FONTS`. */
	font: string;
	/** Encoded activity, `kind|name`. See `activity.svelte.ts`. */
	activity: string;
	/** The card's background. */
	card: Fill;
	/** The display name, styled independently of the card. */
	name: Fill;
}

export const EMPTY_EXTRAS: Extras = {
	banner: null,
	about: "",
	pronouns: "",
	text: "",
	font: "default",
	activity: "",
	card: { ...DEFAULT_FILL },
	name: { ...DEFAULT_FILL }
};

export const profile = $state({
	/** True when extras go to the public profile rather than private storage. */
	extrasShared: false,
	/** Set when a public write was refused and we fell back to private. */
	extrasFellBack: false,
	/** Whatever the server said when it refused, for the UI to show. */
	extrasError: "",
	displayName: "",
	avatar: null as string | null,
	presence: "online" as Presence,
	statusMessage: "",
	extras: { ...EMPTY_EXTRAS },
	loaded: false,
	saving: false,
	error: ""
});

/** Read everything back from the server. */
export async function loadProfile(client: MatrixClient): Promise<void> {
	const userId = client.getUserId();
	if (!userId) return;
	try {
		const info = await client.getProfileInfo(userId);
		profile.displayName = info.displayname ?? userId;
		profile.avatar = info.avatar_url ?? null;
	} catch (error) {
		console.warn("could not read profile", error);
	}

	try {
		profile.extrasShared = await client.doesServerSupportExtendedProfiles();
	} catch {
		profile.extrasShared = false;
	}

	try {
		if (profile.extrasShared) {
			const fields = await client.getExtendedProfile(userId);
			profile.extras = extrasFromFields(fields);
		} else {
			const stored = (await client.getAccountDataFromServer(
				PROFILE_EVENT as never
			)) as Partial<Extras> | null;
			profile.extras = sanitise(stored);
		}
	} catch {
		profile.extras = { ...EMPTY_EXTRAS };
	}

	/*
	 * Presence is a *preference*, not something to read back off the server.
	 *
	 * `getPresence` returns what the server currently believes — and for your
	 * own account that is "offline" until a heartbeat lands, or permanently if
	 * presence is disabled server-side. Displaying that as the user's choice
	 * meant the app announced "Appear offline" to someone who had never picked
	 * it, and worse, made it look like they were hidden when they were not.
	 *
	 * So the choice is remembered here, and pushed *to* the server. Only the
	 * status message is worth reading back, and only if we have none stored.
	 */
	const stored = readPresenceChoice();
	profile.presence = stored?.presence ?? "online";
	profile.statusMessage = stored?.statusMessage ?? "";

	if (!stored) {
		try {
			const state = await client.getPresence(userId);
			profile.statusMessage = state?.status_msg ?? "";
		} catch {
			/* presence disabled server-side; the default stands */
		}
	} else {
		// Re-assert it: the SDK sets presence to online while syncing, which
		// would quietly undo "appear offline" on every launch.
		try {
			await client.setPresence({
				presence: toMatrixPresence(stored.presence),
				status_msg: stored.statusMessage
			});
		} catch {
			/* server may not accept presence; the UI still shows the choice */
		}
	}

	profile.loaded = true;
}

/** Values from account data are user-editable, so they get checked. */
export function sanitise(input: Partial<Extras> | null): Extras {
	const raw = (input ?? {}) as Record<string, unknown>;
	const hex = (value: unknown): string =>
		typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "";

	return {
		banner:
			typeof raw.banner === "string" && raw.banner.startsWith("mxc://") ? raw.banner : null,
		about: typeof raw.about === "string" ? raw.about.slice(0, 1000) : "",
		pronouns: typeof raw.pronouns === "string" ? raw.pronouns.slice(0, 40) : "",
		text: hex(raw.text),
		// Only ids from the list survive, so nothing from a stranger's profile
		// reaches a stylesheet.
		font: PROFILE_FONTS.some((f) => f.id === raw.font) ? (raw.font as string) : "default",
		// Re-encoded through the activity validator, so a hostile value from
		// somebody else's profile cannot reach the card.
		activity: encodeActivity(decodeActivity(raw.activity)),
		card: asFill(raw.card),
		name: asFill(raw.name)
	};
}

function asFill(value: unknown): Fill {
	if (typeof value === "string") return decodeFill(value);
	if (value && typeof value === "object") {
		const raw = value as Partial<Fill>;
		return decodeFill(
			encodeFill({
				kind: (raw.kind ?? "none") as FillKind,
				from: raw.from ?? "",
				to: raw.to ?? "",
				angle: typeof raw.angle === "number" ? raw.angle : 160
			})
		);
	}
	return { ...DEFAULT_FILL };
}

const PRESENCE_KEY = "greenhouse.presence";

function readPresenceChoice(): { presence: Presence; statusMessage: string } | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(PRESENCE_KEY) ?? "null");
		if (!raw || typeof raw !== "object") return null;
		const value = raw as { presence?: unknown; statusMessage?: unknown };
		const presence: Presence =
			value.presence === "unavailable" ||
			value.presence === "offline" ||
			value.presence === "dnd"
				? value.presence
				: "online";
		return {
			presence,
			statusMessage: typeof value.statusMessage === "string" ? value.statusMessage : ""
		};
	} catch {
		return null;
	}
}

function writePresenceChoice(presence: Presence, statusMessage: string): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(PRESENCE_KEY, JSON.stringify({ presence, statusMessage }));
}

export async function saveDisplayName(client: MatrixClient, name: string): Promise<void> {
	const trimmed = name.trim();
	if (!trimmed || trimmed === profile.displayName) return;
	await client.setDisplayName(trimmed);
	profile.displayName = trimmed;
}

export async function saveAvatar(client: MatrixClient, file: File): Promise<void> {
	// Profile pictures are public by design — every server you share a room
	// with fetches them — so this one is deliberately NOT encrypted, unlike
	// message attachments.
	const uploaded = await client.uploadContent(file, {
		name: file.name,
		type: file.type || "application/octet-stream"
	});
	await client.setAvatarUrl(uploaded.content_uri);
	// The old picture is cached as a blob under its own mxc, so nothing to
	// clear for the new one — but drop the previous entry so a re-upload of
	// the same file doesn't serve a stale copy.
	if (profile.avatar) forgetMxc(profile.avatar);
	profile.avatar = uploaded.content_uri;
}

export async function clearAvatar(client: MatrixClient): Promise<void> {
	await client.setAvatarUrl("");
	if (profile.avatar) forgetMxc(profile.avatar);
	profile.avatar = null;
}

export async function savePresence(
	client: MatrixClient,
	presence: Presence,
	statusMessage: string
): Promise<void> {
	const message = statusMessage.slice(0, 120);
	// Remembered before the request: a server that rejects presence entirely
	// should not stop the client honouring what you picked — and DND has to
	// silence notifications even if the server never hears about it.
	writePresenceChoice(presence, message);
	profile.presence = presence;
	profile.statusMessage = message;

	await client.setPresence({ presence: toMatrixPresence(presence), status_msg: message });

	// Published so other Greenhouse clients can show DND, which Matrix itself
	// has no way to express. Best effort — the local behaviour is what matters.
	if (profile.extrasShared) {
		try {
			await writeField(client, "presence", presence === "online" ? "" : presence);
		} catch {
			/* not worth failing a status change over */
		}
	}
}

/**
 * Save the non-standard half, to wherever this server actually supports.
 *
 * Extended profile when available so it is genuinely part of your profile;
 * private account data otherwise. Never both — writing to both would leave
 * two copies that drift apart.
 */
export async function saveExtras(client: MatrixClient, extras: Extras): Promise<void> {
	const clean = sanitise(extras);
	profile.extrasFellBack = false;
	profile.extrasError = "";

	if (profile.extrasShared) {
		const fields: [string, string][] = [
			["banner", clean.banner ?? ""],
			["about", clean.about],
			["pronouns", clean.pronouns],
			["text", clean.text],
			["font", clean.font],
			["activity", clean.activity],
			["card", encodeFill(clean.card)],
			["name", encodeFill(clean.name)]
		];

		/*
		 * Written one at a time, and a failure on one does not abandon the
		 * rest. Servers differ about which custom keys they will accept, and
		 * losing a whole profile because one field was refused is how "I saved
		 * my styling and nothing happened" happens.
		 */
		const failed: string[] = [];
		let lastError = "";
		for (const [name, value] of fields) {
			try {
				await writeField(client, name, value);
			} catch (error) {
				failed.push(name);
				lastError = error instanceof Error ? error.message : String(error);
			}
		}

		if (!failed.length) {
			profile.extras = clean;
			return;
		}

		if (failed.length < fields.length) {
			// Some landed. Say which didn't rather than implying a clean save.
			profile.extras = clean;
			profile.extrasError = `Your homeserver refused: ${failed.join(", ")}. ${lastError}`;
			return;
		}

		// Nothing landed at all — the server advertised support and then took
		// none of it. Keep what was typed by storing it privately.
		console.warn("extended profile writes all refused, storing privately", lastError);
		profile.extrasShared = false;
		profile.extrasFellBack = true;
		profile.extrasError = lastError;
	}

	await client.setAccountData(PROFILE_EVENT as never, clean as never);
	profile.extras = clean;
}

/** One extended-profile field. Empty means delete rather than store "". */
async function writeField(client: MatrixClient, name: string, value: string): Promise<void> {
	const key = `${PROFILE_EVENT}.${name}`;
	if (!value) {
		try {
			await client.deleteExtendedProfileProperty(key);
		} catch {
			// Deleting something that was never set is not a failure.
		}
		return;
	}
	await client.setExtendedProfileProperty(key, value);
}

export async function saveBanner(client: MatrixClient, file: File): Promise<string> {
	const uploaded = await client.uploadContent(file, {
		name: file.name,
		type: file.type || "application/octet-stream"
	});
	return uploaded.content_uri;
}

export function cloneExtras(source: Extras): Extras {
	return { ...source, card: { ...source.card }, name: { ...source.name } };
}

/**
 * Would these two save identically?
 *
 * Lives here rather than in the dialog so it can be tested: the Save button
 * is gated on this, and a field missing from the comparison is a field the
 * user can edit but never save. That is precisely the bug this replaced.
 */
export function sameExtras(a: Extras, b: Extras): boolean {
	return (
		a.banner === b.banner &&
		a.about === b.about &&
		a.pronouns === b.pronouns &&
		a.text === b.text &&
		a.font === b.font &&
		a.activity === b.activity &&
		encodeFill(a.card) === encodeFill(b.card) &&
		encodeFill(a.name) === encodeFill(b.name)
	);
}

export function resetProfile(): void {
	profile.displayName = "";
	profile.avatar = null;
	profile.presence = "online";
	profile.statusMessage = "";
	profile.extras = { ...EMPTY_EXTRAS };
	profile.extrasShared = false;
	profile.extrasFellBack = false;
	profile.extrasError = "";
	profile.loaded = false;
	profile.error = "";
}

/** Turn a flat extended-profile response into our shape. */
export function extrasFromFields(fields: Record<string, unknown>): Extras {
	const at = (name: string) => fields[`${PROFILE_EVENT}.${name}`];
	return sanitise({
		banner: at("banner") as string,
		about: at("about") as string,
		pronouns: at("pronouns") as string,
		text: at("text") as string,
		font: at("font") as string,
		activity: at("activity") as string,
		card: at("card"),
		name: at("name")
	} as never);
}

/**
 * Somebody else's profile, styling included.
 *
 * Only works when their homeserver supports extended profiles — otherwise the
 * extras simply aren't public and there is nothing to fetch. The caller shows
 * the standard half regardless.
 */
export interface OtherProfile {
	userId: string;
	displayName: string;
	avatar: string | null;
	extras: Extras;
	/** False when only the standard fields could be read. */
	styled: boolean;
}

export async function loadUserProfile(
	client: MatrixClient,
	userId: string
): Promise<OtherProfile> {
	const result: OtherProfile = {
		userId,
		displayName: userId,
		avatar: null,
		extras: { ...EMPTY_EXTRAS },
		styled: false
	};

	try {
		const info = await client.getProfileInfo(userId);
		result.displayName = info.displayname ?? userId;
		result.avatar = info.avatar_url ?? null;
	} catch {
		/* a profile that cannot be read still gets a card, with the id */
	}

	try {
		const fields = await client.getExtendedProfile(userId);
		result.extras = extrasFromFields(fields);
		result.styled = Object.keys(fields).some((key) => key.startsWith(PROFILE_EVENT));
	} catch {
		/* their server has no extended profiles; standard fields only */
	}

	return result;
}

export const PRESENCE_LABELS: Record<Presence, string> = {
	online: "Online",
	dnd: "Do not disturb",
	unavailable: "Away",
	offline: "Appear offline"
};

export const PRESENCE_HINTS: Record<Presence, string> = {
	online: "",
	dnd: "Silences all notifications",
	unavailable: "",
	offline: "Others see you as offline"
};

export const PRESENCE_COLOURS: Record<Presence, string> = {
	online: "var(--success)",
	dnd: "var(--danger)",
	unavailable: "var(--warning)",
	offline: "var(--text-faint)"
};

/** True while notifications should be suppressed. */
export function silenced(): boolean {
	return profile.presence === "dnd";
}
