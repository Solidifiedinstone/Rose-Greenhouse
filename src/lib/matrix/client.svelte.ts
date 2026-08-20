/**
 * The Matrix client's whole lifecycle, and the reactive state the UI reads.
 *
 * Design rules, all of which exist for a reason and none of which are style:
 *
 *  1. **No SDK object ever enters `$state`.** Everything is flattened into
 *     the plain records in `views.ts` first. See that file for why.
 *  2. **The client itself is a module-level variable, not reactive.** It is a
 *     live object with its own event emitter; proxying it would be a bug.
 *  3. **Rebuilds are coalesced.** A single sync can fire hundreds of room
 *     events; rebuilding the room list on each one is how a client ends up
 *     using a whole CPU core to sit idle. Everything schedules a rebuild on
 *     the next animation frame instead.
 *  4. **Failures are reported, never swallowed.** An empty room list and a
 *     failed connection look identical to a user, so they must not look
 *     identical in the code.
 */

import {
	AutoDiscovery,
	ClientEvent,
	createClient,
	EventType,
	MatrixEvent,
	MsgType,
	NotificationCountType,
	Room,
	RoomEvent,
	RoomMember,
	RoomMemberEvent,
	SyncState,
	type ICreateClientOpts,
	type ReceiptType,
	type MatrixClient
} from "matrix-js-sdk";

import { invoke } from "@tauri-apps/api/core";

import {
	clearSessions,
	cryptoPrefix,
	loadSessions,
	removeSession,
	saveSession,
	sessionKey,
	setActiveSession,
	type StoredSession
} from "./session";
import {
	considerEvent,
	inQuietHours,
	isRoomMuted,
	loadNotificationPrefs,
	notifications,
	releaseHeld,
	setRoomMuted
} from "./notify.svelte";
import { hasMarkdown, renderMarkdown } from "./markdown";
import { loadProfile, resetProfile } from "./profile.svelte";
import { flush, loadScheduled } from "./scheduled.svelte";
import { refreshStatus, reset as resetVerification, watchForRequests } from "./verification.svelte";
import { forgetAttachments, sendFile } from "./upload.svelte";
import {
	markContinuations,
	sortMembers,
	sortRooms,
	type MemberView,
	type MessageView,
	type Reaction,
	type RoomView
} from "./views";

export type Phase =
	| "starting" // reading the stored session
	| "login" // no session; show the login screen
	| "connecting" // credentials in hand, first sync in flight
	| "ready" // synced at least once
	| "error"; // something went wrong that the user must see

/**
 * Everything the UI is allowed to read. Deliberately flat and small.
 */
export const mx = $state({
	phase: "starting" as Phase,
	error: "",
	/** Set while a long operation is in flight, for buttons to disable on. */
	busy: false,

	userId: "",
	displayName: "",
	avatarUrl: null as string | null,
	homeserver: "",

	/** True once the crypto stack is up; encrypted rooms are unreadable until. */
	cryptoReady: false,

	rooms: [] as RoomView[],
	activeRoomId: null as string | null,
	/** Space filter. Null means "everything". */
	activeSpaceId: null as string | null,

	timeline: [] as MessageView[],
	/** True while older messages are being fetched. */
	loadingMore: false,
	/** False once we've reached the start of the room. */
	canLoadMore: true,

	/** Who is typing in the active room, excluding you. */
	typing: [] as string[],
	/** Members of the active room, sorted by power then name. */
	members: [] as MemberView[],

	/** Rooms hidden from this device's sidebar. */
	hidden: [] as string[],
	/** Users blocked account-wide. */
	ignored: [] as string[],
	/** True when read receipts are private by default. */
	receiptsOff: false,

	/** Every signed-in account, and which one is showing. */
	accounts: [] as { key: string; userId: string; homeserver: string }[],
	activeAccount: "" as string,
	/** True while the login screen is adding a second account, not replacing. */
	addingAccount: false
});

/** The live client. Never reactive — see rule 2. */
let client: MatrixClient | null = null;

/** Handles for the listeners we attach, so logout can detach them cleanly. */
let detachers: Array<() => void> = [];

let rebuildQueued = false;
let timelineQueued = false;

export function getClient(): MatrixClient | null {
	return client;
}

// ── Starting up ──────────────────────────────────────────────────

/**
 * Resume a stored session, or fall through to the login screen.
 *
 * Called once, on app start.
 */
export async function start(): Promise<void> {
	mx.phase = "starting";
	let stored: Awaited<ReturnType<typeof loadSessions>> = { active: null, sessions: [] };
	try {
		stored = await loadSessions();
	} catch (error) {
		// Sessions we cannot read are the same as none, and the user can act on
		// the login screen but not on this error.
		console.warn("could not read stored sessions", error);
	}

	mx.accounts = stored.sessions.map((session) => ({
		key: sessionKey(session),
		userId: session.user_id,
		homeserver: session.homeserver
	}));

	const wanted =
		stored.sessions.find((session) => sessionKey(session) === stored.active) ??
		stored.sessions[0];

	if (!wanted) {
		mx.phase = "login";
		return;
	}

	try {
		await connect(wanted);
	} catch (error) {
		// The token may simply have been revoked from another device. Say so,
		// and drop only that account rather than everything.
		mx.phase = "login";
		mx.error = describe(error);
		await removeSession(sessionKey(wanted)).catch(() => {});
		mx.accounts = mx.accounts.filter((account) => account.key !== sessionKey(wanted));
	}
}

/**
 * Switch to another signed-in account.
 *
 * The current client is stopped first: two sync loops against two homeservers
 * would both be writing into the same reactive state, and whichever answered
 * last would win.
 */
export async function switchAccount(key: string): Promise<void> {
	if (key === mx.activeAccount) return;
	const stored = await loadSessions();
	const wanted = stored.sessions.find((session) => sessionKey(session) === key);
	if (!wanted) return;

	mx.busy = true;
	try {
		await stopClient();
		await setActiveSession(key);
		await connect(wanted);
	} catch (error) {
		mx.error = describe(error);
		mx.phase = "login";
	} finally {
		mx.busy = false;
	}
}

/** Put the login screen up without signing anything out. */
export function beginAddAccount(): void {
	mx.addingAccount = true;
	mx.phase = "login";
	mx.error = "";
}

export function cancelAddAccount(): void {
	mx.addingAccount = false;
	if (mx.accounts.length) void switchAccount(mx.accounts[0].key);
}

/** Sign out of one account, staying signed into the rest. */
export async function signOutAccount(key: string): Promise<void> {
	const isCurrent = key === mx.activeAccount;
	mx.busy = true;
	try {
		if (isCurrent && client) {
			await client.logout(true).catch((error) => console.warn("logout call failed", error));
			await stopClient();
		}
		await removeSession(key);
		mx.accounts = mx.accounts.filter((account) => account.key !== key);

		if (!isCurrent) return;
		const next = mx.accounts[0];
		if (next) await switchAccount(next.key);
		else await finishLogout();
	} finally {
		mx.busy = false;
	}
}

/** Stop syncing and detach, without touching stored sessions. */
async function stopClient(): Promise<void> {
	if (client) {
		// `stopClient` shuts the crypto stack down too. Each account already
		// has its own IndexedDB via `cryptoDatabasePrefix`, so the stores can
		// never interleave even if teardown were slow.
		client.stopClient();
	}
	detachListeners();
	resetVerification();
	resetProfile();
	forgetAttachments();
	viewCache.clear();
	client = null;

	mx.rooms = [];
	mx.timeline = [];
	mx.members = [];
	mx.activeRoomId = null;
	mx.activeSpaceId = null;
	mx.typing = [];
	mx.cryptoReady = false;
}

/**
 * Turn what someone typed into a homeserver into a real base URL.
 *
 * People type "matrix.org", "@me:matrix.org", or a full URL. All three have
 * to work, and only `.well-known` knows where a domain's actual client API
 * lives — for many servers it is not the domain itself.
 */
export async function resolveHomeserver(input: string): Promise<string> {
	const text = input.trim().replace(/\/+$/, "");
	if (!text) throw new Error("Enter a homeserver.");

	if (/^https?:\/\//i.test(text)) {
		return text;
	}

	const domain = text.includes(":") ? text.split(":").pop()! : text;
	const config = await AutoDiscovery.findClientConfig(domain);
	const homeserver = config["m.homeserver"];

	if (homeserver?.base_url && homeserver.state === AutoDiscovery.SUCCESS) {
		return homeserver.base_url.replace(/\/+$/, "");
	}
	if (homeserver?.error) {
		throw new Error(`${domain} did not answer as a Matrix homeserver: ${homeserver.error}`);
	}
	// No .well-known at all is normal for small servers — the domain itself
	// is then the homeserver, and login will say so if it isn't.
	return `https://${domain}`;
}

/** Log in with a password and store the resulting session. */
export async function login(
	homeserverInput: string,
	username: string,
	password: string
): Promise<void> {
	mx.busy = true;
	mx.error = "";
	try {
		const homeserver = await resolveHomeserver(homeserverInput);
		const temporary = createClient({ baseUrl: homeserver });

		const response = await temporary.loginRequest({
			type: "m.login.password",
			identifier: { type: "m.id.user", user: username.trim().replace(/^@/, "") },
			password,
			initial_device_display_name: "Rose Greenhouse"
		});

		const session: StoredSession = {
			homeserver,
			user_id: response.user_id,
			device_id: response.device_id,
			access_token: response.access_token
		};
		await saveSession(session);
		// Only now is the previous account replaced: if login had failed, the
		// account already signed in is still there and still syncing.
		await stopClient();
		await connect(session);
	} catch (error) {
		mx.error = describe(error);
		mx.phase = "login";
		throw error;
	} finally {
		mx.busy = false;
	}
}

/**
 * Build the real client from a session and get it syncing.
 *
 * Resolves once the first sync lands, so callers can tell the difference
 * between "connected" and "still trying".
 */
async function connect(session: StoredSession): Promise<void> {
	mx.phase = "connecting";
	mx.error = "";
	mx.homeserver = session.homeserver;
	mx.userId = session.user_id;

	const options: ICreateClientOpts = {
		baseUrl: session.homeserver,
		accessToken: session.access_token,
		userId: session.user_id,
		deviceId: session.device_id,
		// Room state is worth keeping in memory; without it every room switch
		// re-derives names and members from scratch.
		timelineSupport: true
	};

	client = createClient(options);

	// Encryption is not a feature to add later. Most direct messages on Matrix
	// are encrypted, and a client without crypto shows them as a wall of
	// "unable to decrypt" — which looks like a bug, because it is one.
	try {
		/*
		 * Each account gets its own crypto database.
		 *
		 * Without a distinct prefix two accounts share one store, and their
		 * device keys collide. That does not fail loudly — it quietly stops
		 * either account decrypting properly, which is the worst kind of bug
		 * to ship in an encrypted client.
		 */
		await client.initRustCrypto({ cryptoDatabasePrefix: cryptoPrefix(session) });
		mx.cryptoReady = true;
	} catch (error) {
		// Carry on unencrypted rather than refusing to start. The UI shows
		// this state honestly, per rule 4.
		mx.cryptoReady = false;
		mx.error =
			"Encryption could not start, so encrypted rooms will not be readable. " +
			describe(error);
	}

	attachListeners(client);

	await client.startClient({ initialSyncLimit: 30 });
	await waitForFirstSync();

	const me = client.getUser(session.user_id);
	mx.displayName = me?.displayName ?? session.user_id;
	mx.avatarUrl = me?.avatarUrl ?? null;

	mx.hidden = readHidden();
	mx.ignored = client.getIgnoredUsers();
	loadNotificationPrefs();
	mx.receiptsOff = receiptPrefs().off;

	/*
	 * Quiet hours end by the clock, not by anyone clicking anything, so
	 * something has to notice. A minute's granularity is plenty for a feature
	 * measured in hours, and the check is trivial.
	 */
	const quietTimer = setInterval(() => {
		if (!inQuietHours(notifications.quiet)) void releaseHeld();
	}, 60_000);
	detachers.push(() => clearInterval(quietTimer));

	// Scheduled messages: the queue is local, so something has to notice when
	// one comes due. Flushed once on connect too, which is what makes "send
	// next time I'm online" mean anything.
	loadScheduled();
	void flushScheduled();
	const scheduleTimer = setInterval(() => void flushScheduled(), 20_000);
	detachers.push(() => clearInterval(scheduleTimer));

	// Verification state, and a listener so a request started from another
	// client (Element on a phone, say) surfaces here rather than being missed.
	detachers.push(watchForRequests(client));
	void refreshStatus(client);
	void loadProfile(client);
	// Device trust arrives asynchronously after sync; re-read when it changes
	// so the "verify" prompt disappears by itself once it's done.
	const onKeys = () => void refreshStatus(client);
	client.on("crypto.devicesUpdated" as never, onKeys as never);
	client.on("crossSigning.keysChanged" as never, onKeys as never);
	detachers.push(() => {
		client?.off("crypto.devicesUpdated" as never, onKeys as never);
		client?.off("crossSigning.keysChanged" as never, onKeys as never);
	});

	mx.activeAccount = sessionKey(session);
	mx.addingAccount = false;
	if (!mx.accounts.some((account) => account.key === mx.activeAccount)) {
		mx.accounts.push({
			key: mx.activeAccount,
			userId: session.user_id,
			homeserver: session.homeserver
		});
	}

	mx.phase = "ready";
	scheduleRoomRebuild();
}

/** Resolve on the first `PREPARED`, reject if the server rejects us. */
function waitForFirstSync(): Promise<void> {
	const active = client;
	if (!active) return Promise.reject(new Error("No client."));

	return new Promise((resolve, reject) => {
		const onSync = (syncState: SyncState, _previous: SyncState | null, data?: unknown) => {
			if (syncState === SyncState.Prepared) {
				active.off(ClientEvent.Sync, onSync);
				resolve();
				return;
			}
			if (syncState === SyncState.Error) {
				const error = (data as { error?: Error } | undefined)?.error;
				// A single sync error is often transient — the SDK retries. Only
				// an authentication failure is fatal, and that is the one the
				// user has to act on.
				const code = (error as { errcode?: string } | undefined)?.errcode;
				if (code === "M_UNKNOWN_TOKEN" || code === "M_FORBIDDEN") {
					active.off(ClientEvent.Sync, onSync);
					reject(error ?? new Error("The homeserver rejected this session."));
				}
			}
		};
		active.on(ClientEvent.Sync, onSync);
	});
}

export async function logout(): Promise<void> {
	mx.busy = true;
	try {
		if (client) {
			// Best effort: tell the server, but never let a failed request trap
			// someone in an account they're trying to leave.
			await client.logout(true).catch((error) => console.warn("logout call failed", error));
		}
		await stopClient();
		await clearSessions().catch(() => {});
		await finishLogout();
	} finally {
		mx.busy = false;
	}
}

/** Reset everything that outlives a single account. */
async function finishLogout(): Promise<void> {
	mx.phase = "login";
	mx.userId = "";
	mx.displayName = "";
	mx.avatarUrl = null;
	mx.accounts = [];
	mx.activeAccount = "";
	mx.addingAccount = false;
	mx.ignored = [];
	mx.error = "";
}

// ── Listeners ────────────────────────────────────────────────────

function attachListeners(active: MatrixClient): void {
	const on = <T extends string>(event: T, handler: (...args: never[]) => void) => {
		// The SDK's emitter types are stricter than this generic helper; the
		// cast is confined to this one line rather than sprinkled at each call.
		(active as unknown as {
			on: (event: string, handler: (...args: never[]) => void) => void;
			off: (event: string, handler: (...args: never[]) => void) => void;
		}).on(event, handler);
		detachers.push(() =>
			(active as unknown as {
				off: (event: string, handler: (...args: never[]) => void) => void;
			}).off(event, handler)
		);
	};

	on(RoomEvent.Timeline, ((
		event: MatrixEvent,
		room: Room | undefined,
		_toStart: boolean | undefined,
		removed: boolean | undefined,
		data: { liveEvent?: boolean } | undefined
	) => {
		scheduleRoomRebuild();
		if (room && room.roomId === mx.activeRoomId) {
			scheduleTimelineRebuild();
			// A reply lands in the thread's timeline, not the room's, so the
			// open panel has to be told separately or it silently goes stale.
			if (threadView.rootId) rebuildThread();
		}

		// Only live events: back-pagination replays history through this same
		// callback, and notifying about a month of scrollback would be absurd.
		if (!removed && data?.liveEvent && active) {
			void considerEvent(event, room, {
				client: active,
				activeRoomId: mx.activeRoomId
			});
		}
	}) as never);

	on(RoomEvent.LocalEchoUpdated, (() => {
		scheduleTimelineRebuild();
	}) as never);

	on(RoomEvent.Name, (() => scheduleRoomRebuild()) as never);
	// Membership and power changes only matter for the room being looked at.
	on("RoomState.members", ((_event: MatrixEvent, state: { roomId?: string }) => {
		if (state?.roomId === mx.activeRoomId) rebuildMembers();
	}) as never);
	on("RoomMember.powerLevel", (() => rebuildMembers()) as never);
	on(RoomEvent.Receipt, (() => scheduleRoomRebuild()) as never);
	on(RoomEvent.MyMembership, (() => scheduleRoomRebuild()) as never);
	on(ClientEvent.Room, (() => scheduleRoomRebuild()) as never);
	on(ClientEvent.DeleteRoom, (() => scheduleRoomRebuild()) as never);

	on(ClientEvent.Sync, ((syncState: SyncState) => {
		if (syncState === SyncState.Prepared || syncState === SyncState.Syncing) {
			if (mx.phase === "ready") scheduleRoomRebuild();
		}
	}) as never);

	// The ignore list can be changed from any device. Without this, blocking
	// on a phone leaves this client showing "Block" and still rendering their
	// messages until a restart.
	on(ClientEvent.AccountData, ((event: MatrixEvent) => {
		if (event.getType() !== "m.ignored_user_list") return;
		mx.ignored = client?.getIgnoredUsers() ?? [];
		rebuildTimeline();
		scheduleRoomRebuild();
	}) as never);

	// Decryption arrives after the event does, so a timeline that ignores this
	// shows "unable to decrypt" forever on messages that decrypted fine.
	on("Event.decrypted", ((event: MatrixEvent) => {
		if (event.getRoomId() === mx.activeRoomId) scheduleTimelineRebuild();
		scheduleRoomRebuild();
	}) as never);

	// Typing is a member-level event, not a room-level one — the member whose
	// state changed is what the SDK hands over, so the room is re-read rather
	// than taken from the callback.
	on(RoomMemberEvent.Typing, ((_event: MatrixEvent, member: RoomMember) => {
		if (member.roomId !== mx.activeRoomId) return;
		const room = client?.getRoom(member.roomId);
		if (!room) return;
		mx.typing = room
			.getMembers()
			.filter((other) => other.typing && other.userId !== mx.userId)
			.map((other) => other.name);
	}) as never);
}

function detachListeners(): void {
	for (const detach of detachers) {
		try {
			detach();
		} catch {
			// A listener that was never attached is not worth a crash on logout.
		}
	}
	detachers = [];
}

// ── Rebuilding the reactive snapshots ────────────────────────────

function scheduleRoomRebuild(): void {
	if (rebuildQueued) return;
	rebuildQueued = true;
	queueMicrotaskOrFrame(() => {
		rebuildQueued = false;
		rebuildRooms();
	});
}

function scheduleTimelineRebuild(): void {
	if (timelineQueued) return;
	timelineQueued = true;
	queueMicrotaskOrFrame(() => {
		timelineQueued = false;
		rebuildTimeline();
	});
}

/** A frame in a window, a microtask anywhere else (tests, SSR). */
function queueMicrotaskOrFrame(run: () => void): void {
	if (typeof requestAnimationFrame === "function") {
		requestAnimationFrame(run);
	} else {
		queueMicrotask(run);
	}
}

/**
 * Which spaces each room belongs to.
 *
 * Built once per rebuild rather than per room: a space lists its children as
 * `m.space.child` state events, so asking "which spaces contain this room?"
 * the other way round would mean walking every space for every room.
 */
function spaceMembership(rooms: Room[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const room of rooms) {
		const creation = room.currentState.getStateEvents(EventType.RoomCreate, "");
		if (creation?.getContent()?.type !== "m.space") continue;

		for (const child of room.currentState.getStateEvents("m.space.child")) {
			const childId = child.getStateKey();
			// A child event with no `via` has been removed from the space; the
			// event stays as a tombstone and must not still count as membership.
			const via = child.getContent()?.via;
			if (!childId || !Array.isArray(via) || !via.length) continue;

			const existing = map.get(childId);
			if (existing) existing.push(room.roomId);
			else map.set(childId, [room.roomId]);
		}
	}
	return map;
}

function rebuildRooms(): void {
	if (!client) return;
	const views: RoomView[] = [];

	const all = client.getRooms();
	const spaces = spaceMembership(all);

	const hidden = new Set(mx.hidden);
	for (const room of all) {
		const membership = room.getMyMembership();
		if (membership === "leave") continue;
		if (hidden.has(room.roomId)) continue;

		views.push(roomToView(room, spaces.get(room.roomId) ?? []));
	}
	mx.rooms = sortRooms(views);
	updateTray(views);

	// A space you have left, or that no longer exists, must not keep filtering
	// the list — that would leave an empty sidebar with no way back.
	if (mx.activeSpaceId && !views.some((room) => room.id === mx.activeSpaceId)) {
		mx.activeSpaceId = null;
	}
}

/**
 * Keep the tray tooltip in step with what is waiting.
 *
 * Counted from the same room views the sidebar shows, so the tray can never
 * disagree with the badge next to a room — a tray saying "3 unread" over an
 * empty list is the kind of thing people stop trusting.
 */
let lastTray = "";

function updateTray(views: RoomView[]): void {
	let total = 0;
	let highlights = 0;
	for (const room of views) {
		total += room.unread;
		highlights += room.highlights;
	}

	const signature = `${total}|${highlights}`;
	if (signature === lastTray) return;
	lastTray = signature;

	// Failing to reach the tray is not worth surfacing: plenty of desktops
	// have no tray, and the app works perfectly without one.
	invoke("set_unread", { total, highlights }).catch(() => {});
}

function roomToView(room: Room, spaceIds: string[]): RoomView {
	const membership = room.getMyMembership();
	const lastEvent = lastMessageEvent(room);
	const creation = room.currentState.getStateEvents(EventType.RoomCreate, "");
	const isSpace = creation?.getContent()?.type === "m.space";

	return {
		id: room.roomId,
		name: room.name || room.roomId,
		avatarUrl: room.getMxcAvatarUrl() ?? null,
		topic:
			room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent()?.topic ?? "",
		isDirect: isDirectRoom(room),
		isSpace,
		isEncrypted: safeIsEncrypted(room.roomId),
		unread: room.getUnreadNotificationCount(NotificationCountType.Total) ?? 0,
		highlights: room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0,
		lastActivity: lastEvent?.getTs() ?? room.getLastActiveTimestamp() ?? 0,
		preview: lastEvent ? previewOf(lastEvent) : "",
		spaceIds,
		membership: (membership as RoomView["membership"]) ?? "unknown"
	};
}

function safeIsEncrypted(roomId: string): boolean {
	try {
		return client?.isRoomEncrypted(roomId) ?? false;
	} catch {
		return false;
	}
}

function isDirectRoom(room: Room): boolean {
	const direct = client?.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>();
	if (!direct) return false;
	return Object.values(direct).some((ids) => ids?.includes(room.roomId));
}

function lastMessageEvent(room: Room): MatrixEvent | null {
	const events = room.getLiveTimeline().getEvents();
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index].getType() === EventType.RoomMessage) return events[index];
	}
	return null;
}

function previewOf(event: MatrixEvent): string {
	const content = event.getContent();
	const body = typeof content.body === "string" ? content.body : "";
	if (event.isRedacted()) return "message deleted";
	// The SDK puts its own diagnostic ("** Unable to decrypt: ... **") in the
	// body of an event it could not decrypt. That string is for a log, not for
	// a room list — left alone it leaks internals into the most-read part of
	// the UI. The timeline says the same thing properly, with a reason.
	if (event.isDecryptionFailure()) return "encrypted message";
	if (content.msgtype === MsgType.Image) return body || "sent an image";
	if (content.msgtype === MsgType.File) return body || "sent a file";
	if (content.msgtype === MsgType.Video) return body || "sent a video";
	if (content.msgtype === MsgType.Audio) return body || "sent audio";
	if (event.isEncrypted() && !body) return "encrypted message";
	return body.replace(/\s+/g, " ").slice(0, 140);
}

// ── The active room ──────────────────────────────────────────────

// ── Making and finding rooms ─────────────────────────────────────

export interface NewRoom {
	name: string;
	topic: string;
	/** Private rooms are invite-only and unlisted; public are joinable by anyone. */
	isPublic: boolean;
	/** Only meaningful for public rooms — the part before the colon. */
	alias: string;
	encrypted: boolean;
	/** Matrix IDs to invite immediately. */
	invite: string[];
}

/**
 * Create a room and open it.
 *
 * Encryption is decided here and only here: it is a room-creation setting in
 * Matrix and **cannot be turned on later for existing history**, so the
 * dialog asks up front rather than offering a toggle that would silently do
 * nothing to what came before.
 */
export async function createRoom(options: NewRoom): Promise<string | null> {
	if (!client) return null;
	mx.busy = true;
	mx.error = "";
	try {
		const initialState: { type: string; state_key: string; content: object }[] = [];
		if (options.encrypted) {
			initialState.push({
				type: "m.room.encryption",
				state_key: "",
				content: { algorithm: "m.megolm.v1.aes-sha2" }
			});
		}

		const result = await client.createRoom({
			name: options.name.trim() || undefined,
			topic: options.topic.trim() || undefined,
			visibility: (options.isPublic ? "public" : "private") as never,
			preset: (options.isPublic ? "public_chat" : "private_chat") as never,
			room_alias_name:
				options.isPublic && options.alias.trim() ? options.alias.trim() : undefined,
			invite: options.invite.length ? options.invite : undefined,
			initial_state: initialState as never
		});

		scheduleRoomRebuild();
		openRoom(result.room_id);
		return result.room_id;
	} catch (error) {
		mx.error = describe(error);
		return null;
	} finally {
		mx.busy = false;
	}
}

/**
 * Join by room id, alias, or a matrix.to link.
 *
 * People paste links far more often than they type aliases, so the link form
 * is unwrapped here rather than rejected as malformed.
 */
export async function joinRoom(target: string): Promise<string | null> {
	if (!client) return null;
	const wanted = parseRoomTarget(target);
	if (!wanted) {
		mx.error = "That doesn't look like a room address or link.";
		return null;
	}

	mx.busy = true;
	mx.error = "";
	try {
		const room = await client.joinRoom(wanted);
		scheduleRoomRebuild();
		openRoom(room.roomId);
		return room.roomId;
	} catch (error) {
		mx.error = describe(error);
		return null;
	} finally {
		mx.busy = false;
	}
}

/** Pull a room id or alias out of whatever was pasted. */
export function parseRoomTarget(input: string): string | null {
	const text = input.trim();
	if (!text) return null;

	// matrix.to links, with the fragment URL-encoded.
	const link = text.match(/matrix\.to\/#\/([^?/]+)/);
	if (link) {
		const decoded = decodeURIComponent(link[1]);
		return decoded.startsWith("#") || decoded.startsWith("!") ? decoded : null;
	}
	// matrix: URIs — matrix:roomid/... or matrix:r/...
	const uri = text.match(/^matrix:(roomid|r)\/([^?]+)/);
	if (uri) return `${uri[1] === "r" ? "#" : "!"}${decodeURIComponent(uri[2])}`;

	if (text.startsWith("#") || text.startsWith("!")) return text;
	return null;
}

export interface DirectoryRoom {
	roomId: string;
	name: string;
	topic: string;
	alias: string;
	members: number;
	avatar: string | null;
	joined: boolean;
}

/** Browse or search the homeserver's public room list. */
export async function searchDirectory(
	term: string,
	server?: string
): Promise<DirectoryRoom[]> {
	if (!client) return [];
	try {
		const response = await client.publicRooms({
			limit: 40,
			server: server?.trim() || undefined,
			filter: term.trim() ? { generic_search_term: term.trim() } : undefined
		});
		return (response.chunk ?? []).map((entry) => ({
			roomId: entry.room_id,
			name: entry.name ?? entry.canonical_alias ?? entry.room_id,
			topic: entry.topic ?? "",
			alias: entry.canonical_alias ?? "",
			members: entry.num_joined_members ?? 0,
			avatar: entry.avatar_url ?? null,
			joined: Boolean(client?.getRoom(entry.room_id)?.getMyMembership() === "join")
		}));
	} catch (error) {
		mx.error = describe(error);
		return [];
	}
}

/**
 * Every version a message has had.
 *
 * Possible only because a Matrix edit is a *replacement event* rather than a
 * mutation: the original and each revision all still exist, so showing the
 * history is reading what is already there rather than keeping a private log.
 *
 * Newest first. Returns an empty array when nothing was ever edited.
 */
export function editHistory(eventId: string): { body: string; timestamp: number }[] {
	if (!client || !mx.activeRoomId) return [];
	const room = client.getRoom(mx.activeRoomId);
	const original = room?.findEventById(eventId);
	if (!room || !original) return [];

	const edits = room
		.getUnfilteredTimelineSet()
		.relations.getChildEventsForEvent(eventId, "m.replace", EventType.RoomMessage);
	const versions = edits?.getRelations() ?? [];
	if (!versions.length) return [];

	const out = versions
		.filter((event) => !event.isRedacted())
		.map((event) => {
			const content = event.getContent() as Record<string, unknown>;
			const replacement = (content["m.new_content"] ?? content) as { body?: unknown };
			return {
				body: String(replacement.body ?? "").replace(/^\* /, ""),
				timestamp: event.getTs()
			};
		});

	out.push({
		body: stripReplyFallback(String(original.getOriginalContent().body ?? "")),
		timestamp: original.getTs()
	});
	return out.sort((a, b) => b.timestamp - a.timestamp);
}

// ── Search ───────────────────────────────────────────────────────

export interface SearchHit {
	eventId: string;
	roomId: string;
	roomName: string;
	sender: string;
	body: string;
	timestamp: number;
}

/**
 * Search the history this client already has.
 *
 * Deliberately local. The server-side search API cannot see inside encrypted
 * rooms — the homeserver has only ciphertext — so a server search silently
 * skips exactly the conversations most worth finding. Searching what has been
 * decrypted here covers those, at the cost of only reaching as far back as
 * what has been synced. The UI says which it is rather than implying it
 * searched everything.
 */
export function searchLocal(term: string, roomId?: string): SearchHit[] {
	if (!client) return [];
	const needle = term.trim().toLowerCase();
	if (needle.length < 2) return [];

	const rooms = roomId
		? [client.getRoom(roomId)].filter(Boolean)
		: client.getRooms().filter((room) => room.getMyMembership() === "join");

	const hits: SearchHit[] = [];
	for (const room of rooms as Room[]) {
		for (const event of room.getLiveTimeline().getEvents()) {
			if (event.getType() !== EventType.RoomMessage) continue;
			if (event.isRedacted() || event.isDecryptionFailure()) continue;

			const body = String(event.getContent().body ?? "");
			if (!body.toLowerCase().includes(needle)) continue;

			const sender = event.getSender() ?? "";
			hits.push({
				eventId: event.getId() ?? "",
				roomId: room.roomId,
				roomName: room.name || room.roomId,
				sender: room.getMember(sender)?.name ?? sender,
				body: stripReplyFallback(body).replace(/\s+/g, " ").slice(0, 200),
				timestamp: event.getTs()
			});
			if (hits.length >= 200) break;
		}
	}
	return hits.sort((a, b) => b.timestamp - a.timestamp);
}

// ── Managing a room ──────────────────────────────────────────────
//
// Matrix semantics differ from Discord's in one way that matters, and the UI
// must not paper over it: nothing here deletes anything for anybody else.
// Leaving and forgetting removes a room from *your* account. The other side
// keeps their copy. Anything claiming otherwise would be a lie.

/** Rooms hidden from this device's sidebar. Local, and reversible. */
const HIDDEN_KEY = "greenhouse.hiddenRooms";

function readHidden(): string[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function writeHidden(ids: string[]): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
}

/**
 * Hide a room from the sidebar without leaving it.
 *
 * Deliberately local and deliberately not a Matrix operation: the room is
 * still joined, messages still arrive, and unhiding costs nothing. This is
 * the safe one of the three, and the one people reach for by mistake when
 * they mean "leave".
 */
export function hideRoom(roomId: string): void {
	const hidden = readHidden();
	if (!hidden.includes(roomId)) hidden.push(roomId);
	writeHidden(hidden);
	mx.hidden = hidden;
	if (mx.activeRoomId === roomId) openRoom(null);
	scheduleRoomRebuild();
}


export function unhideAll(): void {
	writeHidden([]);
	mx.hidden = [];
	scheduleRoomRebuild();
}

/**
 * Leave a room, and forget it so its history leaves this account too.
 *
 * This is as close to "delete" as Matrix offers a non-admin: the server drops
 * your copy of the history and the room disappears for you. Everyone else
 * still has theirs.
 */
export async function deleteRoom(roomId: string): Promise<void> {
	if (!client) return;
	mx.busy = true;
	try {
		await client.leave(roomId);
		// Forget can only be called once the leave has landed, and it is the
		// half that actually discards history — leaving alone keeps it.
		await client.forget(roomId, true);
		if (mx.activeRoomId === roomId) openRoom(null);
		scheduleRoomRebuild();
	} catch (error) {
		mx.error = describe(error);
		throw error;
	} finally {
		mx.busy = false;
	}
}

/** Leave without forgetting: the room goes, the history stays on the server. */
export async function leaveRoom(roomId: string): Promise<void> {
	if (!client) return;
	mx.busy = true;
	try {
		await client.leave(roomId);
		if (mx.activeRoomId === roomId) openRoom(null);
		scheduleRoomRebuild();
	} catch (error) {
		mx.error = describe(error);
		throw error;
	} finally {
		mx.busy = false;
	}
}

/**
 * Ignore a user account-wide, which is Matrix's block.
 *
 * It sets `m.ignored_user_list` in account data, so the homeserver stops
 * delivering their events to every device you sign in from — this is a real
 * server-side block, not a local filter. It does not stop them seeing your
 * messages in a room you share, and the UI says so rather than implying a
 * privacy guarantee that isn't there.
 */
export async function blockUser(userId: string): Promise<void> {
	if (!client) return;
	mx.busy = true;
	try {
		const next = [...new Set([...client.getIgnoredUsers(), userId])];
		await client.setIgnoredUsers(next);
		// Set from what we sent, not from getIgnoredUsers(): account data is
		// only authoritative once it comes back down /sync, so reading it
		// straight after the request returns the *old* list and the button
		// would stay saying "Block".
		mx.ignored = next;
		rebuildTimeline();
		scheduleRoomRebuild();
	} catch (error) {
		mx.error = describe(error);
		throw error;
	} finally {
		mx.busy = false;
	}
}

export async function unblockUser(userId: string): Promise<void> {
	if (!client) return;
	mx.busy = true;
	try {
		const next = client.getIgnoredUsers().filter((id) => id !== userId);
		await client.setIgnoredUsers(next);
		mx.ignored = next;
		rebuildTimeline();
		scheduleRoomRebuild();
	} catch (error) {
		mx.error = describe(error);
		throw error;
	} finally {
		mx.busy = false;
	}
}

/** Is this user blocked? Read by the menu so it can offer the opposite. */
export function isBlocked(userId: string): boolean {
	return mx.ignored.includes(userId);
}

/** The other person in a two-person room, for "block whoever this is". */
export function otherMemberOf(roomId: string): { userId: string; name: string } | null {
	if (!client) return null;
	const room = client.getRoom(roomId);
	if (!room) return null;
	const others = room
		.getJoinedMembers()
		.filter((member) => member.userId !== mx.userId);
	if (others.length !== 1) return null;
	return { userId: others[0].userId, name: others[0].name };
}

/** Is this room muted? Reads the account's push rules, not a local flag. */
export function roomMuted(roomId: string): boolean {
	return client ? isRoomMuted(client, roomId) : false;
}

export async function muteRoom(roomId: string, muted: boolean): Promise<void> {
	if (!client) return;
	try {
		await setRoomMuted(client, roomId, muted);
		scheduleRoomRebuild();
	} catch (error) {
		mx.error = describe(error);
	}
}

export function markRoomRead(roomId: string): void {
	markRead(roomId);
	scheduleRoomRebuild();
}

export function openRoom(roomId: string | null): void {
	// Views are per-room; keeping another room's cache would only be memory.
	viewCache.clear();
	threadView.rootId = null;
	threadView.messages = [];
	mx.activeRoomId = roomId;
	mx.timeline = [];
	mx.typing = [];
	mx.canLoadMore = true;
	if (roomId) {
		rebuildTimeline();
		rebuildMembers();
		markRead(roomId);
	}
}

/** Members of the active room, flattened for the UI. */
function rebuildMembers(): void {
	if (!client || !mx.activeRoomId) {
		mx.members = [];
		return;
	}
	const room = client.getRoom(mx.activeRoomId);
	if (!room) {
		mx.members = [];
		return;
	}

	const views: MemberView[] = [];
	for (const membership of ["join", "invite"] as const) {
		for (const member of room.getMembersWithMembership(membership as never)) {
			views.push({
				userId: member.userId,
				name: member.name,
				avatar: member.getMxcAvatarUrl() ?? null,
				power: member.powerLevel,
				membership,
				presence: presenceOf(member.userId)
			});
		}
	}
	mx.members = sortMembers(views);
}

function presenceOf(userId: string): MemberView["presence"] {
	const user = client?.getUser(userId);
	const value = user?.presence;
	if (value === "online" || value === "unavailable" || value === "offline") return value;
	return "unknown";
}

/**
 * Flattened views, reused across rebuilds.
 *
 * The whole timeline is rebuilt whenever anything in the room changes, and a
 * busy room rebuilds every frame. Re-allocating a view for a thousand
 * unchanged messages each time is pure waste — worse, every new object breaks
 * Svelte's keyed reconciliation and re-renders rows that did not change.
 *
 * The signature is everything that can alter how a message draws, and it is
 * cheap to compute: no relations lookup, no sorting.
 */
const viewCache = new Map<string, { signature: string; view: MessageView }>();

function signatureOf(event: MatrixEvent, room: Room): string {
	const id = event.getId() ?? "";
	const relations = room
		.getUnfilteredTimelineSet()
		.relations.getChildEventsForEvent(id, "m.annotation", "m.reaction");
	return [
		event.status ?? "",
		event.replacingEventId?.() ?? "",
		event.isRedacted() ? "r" : "",
		event.isDecryptionFailure() ? "d" : "",
		// The relation count changes on every add or remove, which is exactly
		// when the pills need redrawing.
		relations?.getRelations()?.length ?? 0
	].join("|");
}

function rebuildTimeline(): void {
	if (!client || !mx.activeRoomId) {
		mx.timeline = [];
		return;
	}
	const room = client.getRoom(mx.activeRoomId);
	if (!room) {
		mx.timeline = [];
		return;
	}

	const views: MessageView[] = [];
	const seen = new Set<string>();

	for (const event of room.getLiveTimeline().getEvents()) {
		const id = event.getId();
		if (!id) {
			const view = eventToView(event, room);
			if (view) views.push(view);
			continue;
		}

		seen.add(id);
		const signature = signatureOf(event, room);
		const cached = viewCache.get(id);
		if (cached && cached.signature === signature) {
			views.push(cached.view);
			continue;
		}

		const view = eventToView(event, room);
		if (!view) continue;
		viewCache.set(id, { signature, view });
		views.push(view);
	}

	// Drop anything no longer in the timeline, so switching rooms or
	// paginating away doesn't grow this forever.
	if (viewCache.size > seen.size * 2 + 64) {
		for (const key of viewCache.keys()) {
			if (!seen.has(key)) viewCache.delete(key);
		}
	}

	mx.timeline = markContinuations(views);
}

/** Returns null for events the timeline should not draw at all. */
function eventToView(event: MatrixEvent, room: Room): MessageView | null {
	const type = event.getType();
	if (type !== EventType.RoomMessage && type !== EventType.RoomMessageEncrypted) {
		return null;
	}

	const sender = event.getSender() ?? "";
	// The server stops sending new events from an ignored user, but anything
	// already synced stays in the timeline. Without this, blocking someone
	// appears to do nothing until the next restart — which reads as broken at
	// the exact moment somebody wants it to work.
	if (sender && mx.ignored.includes(sender)) return null;
	const member = room.getMember(sender);
	const content = event.getContent();
	const status = event.status; // null once the server has acknowledged it

	const decryptionFailed = event.isDecryptionFailure();
	const redacted = event.isRedacted();

	let kind: MessageView["kind"] = "text";
	if (redacted) kind = "redacted";
	else if (content.msgtype === MsgType.Emote) kind = "emote";
	else if (content.msgtype === MsgType.Notice) kind = "notice";
	else if (content.msgtype === MsgType.Image) kind = "image";
	else if (content.msgtype === MsgType.Video) kind = "video";
	else if (content.msgtype === MsgType.Audio) kind = "audio";
	else if (content.msgtype === MsgType.File) kind = "file";
	else if (content.msgtype !== MsgType.Text && content.msgtype !== undefined)
		kind = "unsupported";

	const info = (content.info ?? {}) as {
		mimetype?: string;
		size?: number;
		w?: number;
		h?: number;
	};

	return {
		id: event.getId() ?? `${sender}:${event.getTs()}`,
		roomId: room.roomId,
		sender,
		senderName: member?.name ?? sender,
		senderAvatar: member?.getMxcAvatarUrl() ?? null,
		timestamp: event.getTs(),
		kind,
		body: redacted
			? "message deleted"
			: decryptionFailed
				? "unable to decrypt this message"
				: typeof content.body === "string"
					? stripReplyFallback(content.body)
					: "",
		html:
			content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string"
				? content.formatted_body
				: null,
		mediaUrl: typeof content.url === "string" ? content.url : null,
		encryptedFile:
			content.file && typeof content.file === "object"
				? (content.file as Record<string, unknown>)
				: null,
		mimeType: info.mimetype ?? null,
		fileSize: typeof info.size === "number" ? info.size : null,
		mediaWidth: typeof info.w === "number" ? info.w : null,
		mediaHeight: typeof info.h === "number" ? info.h : null,
		decryptionFailed,
		pending: status === "sending" || status === "queued",
		failed: status === "not_sent",
		edited: Boolean(event.replacingEventId?.()),
		replyTo: content["m.relates_to"]?.["m.in_reply_to"]?.event_id ?? null,
		replyPreview: replyPreviewFor(content, room),
		reactions: reactionsFor(event, room),
		thread: threadFor(event, room),
		mine: sender === mx.userId,
		continuation: false
	};
}

/**
 * A one-line quote of what a reply is answering.
 *
 * Read from the local timeline, so it is only there if we already have the
 * event — no extra fetch per message. A reply to something scrolled out of
 * history shows without the quote rather than blocking the render on a
 * network round trip.
 */
function replyPreviewFor(
	content: Record<string, unknown>,
	room: Room
): { sender: string; body: string } | null {
	const relates = content["m.relates_to"] as
		| { "m.in_reply_to"?: { event_id?: string } }
		| undefined;
	const target = relates?.["m.in_reply_to"]?.event_id;
	if (!target) return null;

	const original = room.findEventById(target);
	if (!original) return null;

	const originalContent = original.getContent();
	const sender = original.getSender() ?? "";
	const body = original.isDecryptionFailure()
		? "encrypted message"
		: stripReplyFallback(String(originalContent.body ?? ""));
	return {
		sender: room.getMember(sender)?.name ?? sender,
		body: body.replace(/\s+/g, " ").slice(0, 160)
	};
}

/**
 * Remove the "> <@someone> ..." quote block Matrix puts at the top of a reply.
 *
 * It exists so clients that don't understand replies still show context, but
 * a client that renders the quote itself would otherwise show it twice.
 */
export function stripReplyFallback(body: string): string {
	if (!body.startsWith(">")) return body;
	const lines = body.split("\n");
	let index = 0;
	while (index < lines.length && lines[index].startsWith(">")) index += 1;
	while (index < lines.length && lines[index].trim() === "") index += 1;
	return lines.slice(index).join("\n");
}

/**
 * The thread hanging off a message, if any.
 *
 * A thread's replies live in their own timeline rather than the room's, so a
 * root shows a summary and the replies are only fetched when the panel opens.
 * That is also why the main timeline stays readable in a room where a long
 * thread is running: none of it is inline.
 */
function threadFor(event: MatrixEvent, room: Room): MessageView["thread"] {
	const id = event.getId();
	if (!id) return null;
	const thread = room.getThread(id);
	if (!thread || thread.length === 0) return null;
	return {
		replies: thread.length,
		lastActivity: thread.replyToEvent?.getTs() ?? event.getTs()
	};
}

/** Reactions on one event, grouped by emoji. */
function reactionsFor(event: MatrixEvent, room: Room): Reaction[] {
	const id = event.getId();
	if (!id) return [];

	const relations = room
		.getUnfilteredTimelineSet()
		.relations.getChildEventsForEvent(id, "m.annotation", "m.reaction");
	const grouped = relations?.getSortedAnnotationsByKey();
	if (!grouped) return [];

	const out: Reaction[] = [];
	for (const [key, events] of grouped) {
		const live = [...events].filter((entry) => !entry.isRedacted());
		if (!live.length) continue;

		const mineEvent = live.find((entry) => entry.getSender() === mx.userId);
		out.push({
			key,
			count: live.length,
			mine: Boolean(mineEvent),
			myEventId: mineEvent?.getId() ?? null,
			who: live
				.map((entry) => room.getMember(entry.getSender() ?? "")?.name ?? entry.getSender() ?? "")
				.filter(Boolean)
				.slice(0, 12)
		});
	}
	return out;
}

/**
 * Add or remove one of your reactions.
 *
 * Removing is a redaction of your own reaction event, which is why the event
 * id is carried in the view rather than looked up again here.
 */
export async function toggleReaction(
	eventId: string,
	key: string,
	existing: Reaction | undefined
): Promise<void> {
	if (!client || !mx.activeRoomId) return;
	const roomId = mx.activeRoomId;
	try {
		if (existing?.mine && existing.myEventId) {
			await client.redactEvent(roomId, existing.myEventId);
		} else {
			await client.sendEvent(roomId, "m.reaction" as never, {
				"m.relates_to": { rel_type: "m.annotation", event_id: eventId, key }
			} as never);
		}
		scheduleTimelineRebuild();
	} catch (error) {
		mx.error = describe(error);
	}
}

/** Send a reply to a specific message. */
export async function sendReply(body: string, replyToId: string): Promise<void> {
	const text = body.trim();
	if (!client || !mx.activeRoomId || !text) return;
	const room = client.getRoom(mx.activeRoomId);
	const original = room?.findEventById(replyToId);

	// The quoted fallback is part of the spec: clients that don't implement
	// replies still show what was being answered.
	let fallback = text;
	if (original) {
		const quoted = stripReplyFallback(String(original.getContent().body ?? ""))
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
		fallback = `> <${original.getSender()}> ${quoted.replace(/^> /, "")}\n\n${text}`;
	}

	await client.sendMessage(mx.activeRoomId, {
		msgtype: MsgType.Text,
		body: fallback,
		"m.relates_to": { "m.in_reply_to": { event_id: replyToId } }
	} as never);
	scheduleTimelineRebuild();
}

/**
 * Edit one of your own messages.
 *
 * Matrix edits are a new event that *replaces* the old one, rather than a
 * mutation — the original stays on the server, which is why "edited" can be
 * shown honestly and why edit history is possible later.
 *
 * `getContent()` on the SDK already returns the replacement's `m.new_content`
 * once the edit syncs, so nothing here has to merge anything by hand.
 */
export async function editMessage(eventId: string, body: string): Promise<void> {
	const text = body.trim();
	if (!client || !mx.activeRoomId || !text) return;
	const roomId = mx.activeRoomId;

	const room = client.getRoom(roomId);
	const original = room?.findEventById(eventId);
	if (original && original.getSender() !== mx.userId) {
		// The server would refuse anyway; refusing here keeps the UI honest.
		mx.error = "You can only edit your own messages.";
		return;
	}

	try {
		await client.sendMessage(roomId, {
			msgtype: MsgType.Text,
			// The leading "*" is the spec's fallback for clients that don't
			// understand edits — they show the new text marked as a correction.
			body: `* ${text}`,
			"m.new_content": { msgtype: MsgType.Text, body: text },
			"m.relates_to": { rel_type: "m.replace", event_id: eventId }
		} as never);
		scheduleTimelineRebuild();
	} catch (error) {
		mx.error = describe(error);
		throw error;
	}
}

/**
 * Delete one of your own messages.
 *
 * This is a redaction: the server strips the content but the event itself
 * remains, so everyone sees that something was removed. Matrix has no way to
 * make a message never have existed, and the UI should not imply otherwise.
 */
export async function deleteMessage(eventId: string): Promise<void> {
	if (!client || !mx.activeRoomId) return;
	try {
		await client.redactEvent(mx.activeRoomId, eventId);
		scheduleTimelineRebuild();
	} catch (error) {
		mx.error = describe(error);
		throw error;
	}
}

/** Messages in one thread, oldest first. */
export const threadView = $state({
	rootId: null as string | null,
	rootBody: "",
	messages: [] as MessageView[],
	loading: false
});

/**
 * Open a thread and load it.
 *
 * The replies are not in the room timeline, so they have to be fetched the
 * first time — `thread.length` on the root is a server-provided summary and
 * does not mean the events are here.
 */
export async function openThread(rootId: string | null): Promise<void> {
	threadView.rootId = rootId;
	threadView.messages = [];
	threadView.rootBody = "";
	if (!client || !mx.activeRoomId || !rootId) return;

	const room = client.getRoom(mx.activeRoomId);
	const thread = room?.getThread(rootId);
	if (!room || !thread) return;

	threadView.rootBody = stripReplyFallback(
		String(thread.rootEvent?.getContent()?.body ?? "")
	).slice(0, 200);

	threadView.loading = true;
	try {
		await client.paginateEventTimeline(thread.liveTimeline, { backwards: true, limit: 50 });
	} catch (error) {
		mx.error = describe(error);
	} finally {
		threadView.loading = false;
	}
	rebuildThread();
}

function rebuildThread(): void {
	if (!client || !mx.activeRoomId || !threadView.rootId) {
		threadView.messages = [];
		return;
	}
	const room = client.getRoom(mx.activeRoomId);
	const thread = room?.getThread(threadView.rootId);
	if (!room || !thread) {
		threadView.messages = [];
		return;
	}

	const views: MessageView[] = [];
	for (const event of thread.timeline) {
		// The root is shown as a header, not as the first reply.
		if (event.getId() === threadView.rootId) continue;
		const view = eventToView(event, room);
		if (view) views.push(view);
	}
	threadView.messages = markContinuations(views);
}

/** Send into the open thread rather than the room. */
export async function sendThreadMessage(body: string): Promise<void> {
	const text = body.trim();
	if (!client || !mx.activeRoomId || !threadView.rootId || !text) return;
	await client.sendMessage(mx.activeRoomId, threadView.rootId, {
		msgtype: MsgType.Text,
		body: text,
		...(hasMarkdown(text)
			? { format: "org.matrix.custom.html", formatted_body: renderMarkdown(text) }
			: {})
	} as never);
	rebuildThread();
}

/**
 * Send whatever is due.
 *
 * Only while synced: firing a queued message into a client that has not
 * finished its first sync risks sending into a room whose encryption state we
 * have not seen yet.
 */
async function flushScheduled(): Promise<void> {
	if (!client || mx.phase !== "ready") return;
	await flush(async (roomId, body) => {
		await sendToRoom(roomId, body);
	});
}

/** Send a plain or formatted message to a specific room. */
async function sendToRoom(roomId: string, body: string): Promise<void> {
	if (!client) throw new Error("Not connected.");
	if (hasMarkdown(body)) {
		await client.sendMessage(roomId, {
			msgtype: MsgType.Text,
			body,
			format: "org.matrix.custom.html",
			formatted_body: renderMarkdown(body)
		} as never);
	} else {
		await client.sendTextMessage(roomId, body);
	}
}

export async function sendMessage(body: string): Promise<void> {
	const text = body.trim();
	if (!client || !mx.activeRoomId || !text) return;

	// Sent optimistically: the SDK creates a local echo immediately, which is
	// why the timeline rebuild below shows it before the server replies.
	//
	// `body` stays plain text in every case — it is what clients without HTML
	// support display, so dropping the markdown source there would leave them
	// with nothing.
	if (hasMarkdown(text)) {
		await client.sendMessage(mx.activeRoomId, {
			msgtype: MsgType.Text,
			body: text,
			format: "org.matrix.custom.html",
			formatted_body: renderMarkdown(text)
		} as never);
	} else {
		await client.sendTextMessage(mx.activeRoomId, text);
	}
	scheduleTimelineRebuild();
}

/**
 * Send one or more files to the active room.
 *
 * Whether they are encrypted is taken from the room, not from a setting: a
 * file dropped into an encrypted room is encrypted, full stop.
 */
export async function sendFiles(files: File[]): Promise<void> {
	if (!client || !mx.activeRoomId || !files.length) return;
	const roomId = mx.activeRoomId;
	const encrypted = safeIsEncrypted(roomId);

	for (const file of files) {
		try {
			await sendFile(client, roomId, encrypted, file);
		} catch (error) {
			mx.error = describe(error);
		}
	}
	scheduleTimelineRebuild();
}

/** Fetch older messages. Safe to call repeatedly; it no-ops while running. */
export async function loadMore(): Promise<void> {
	if (!client || !mx.activeRoomId || mx.loadingMore || !mx.canLoadMore) return;
	const room = client.getRoom(mx.activeRoomId);
	if (!room) return;

	mx.loadingMore = true;
	try {
		const more = await client.paginateEventTimeline(room.getLiveTimeline(), {
			backwards: true,
			limit: 40
		});
		mx.canLoadMore = more;
		rebuildTimeline();
	} catch (error) {
		mx.error = describe(error);
	} finally {
		mx.loadingMore = false;
	}
}

/*
 * Read receipts, and choosing not to send them.
 *
 * Matrix has a private receipt (`m.read.private`): the server still records
 * where you have read to, so unread counts and the read marker keep working,
 * but it is not broadcast to the room. That is the honest way to do "read
 * without announcing it" — the alternative, sending nothing at all, breaks
 * your own unread badges as collateral.
 */
const RECEIPTS_KEY = "greenhouse.receipts";

function receiptPrefs(): { off: boolean; rooms: Record<string, boolean> } {
	if (typeof localStorage === "undefined") return { off: false, rooms: {} };
	try {
		const raw = JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "{}");
		return {
			off: raw?.off === true,
			rooms: raw?.rooms && typeof raw.rooms === "object" ? raw.rooms : {}
		};
	} catch {
		return { off: false, rooms: {} };
	}
}

function writeReceiptPrefs(prefs: { off: boolean; rooms: Record<string, boolean> }): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(RECEIPTS_KEY, JSON.stringify(prefs));
	mx.receiptsOff = prefs.off;
}

/** True when this room should use a private receipt. */
export function receiptsPrivate(roomId: string): boolean {
	const prefs = receiptPrefs();
	// A per-room choice wins over the global default, in both directions.
	if (roomId in prefs.rooms) return prefs.rooms[roomId];
	return prefs.off;
}

export function setGlobalReceipts(send: boolean): void {
	const prefs = receiptPrefs();
	prefs.off = !send;
	writeReceiptPrefs(prefs);
}

export function setRoomReceipts(roomId: string, send: boolean): void {
	const prefs = receiptPrefs();
	const globalSends = !prefs.off;
	if (send === globalSends) delete prefs.rooms[roomId];
	else prefs.rooms[roomId] = !send;
	writeReceiptPrefs(prefs);
}

function markRead(roomId: string): void {
	if (!client) return;
	const room = client.getRoom(roomId);
	if (!room) return;
	const events = room.getLiveTimeline().getEvents();
	const last = events[events.length - 1];
	if (!last) return;

	const type = receiptsPrivate(roomId)
		? ("m.read.private" as ReceiptType)
		: ("m.read" as ReceiptType);
	// Failing to send a read receipt is not worth telling anyone about, but it
	// is worth not pretending it succeeded.
	client
		.sendReadReceipt(last, type)
		.catch((error) => console.warn("read receipt failed", error));
}

/** Turn an `mxc://` URI into something an `<img>` can load. */
export function mediaUrl(
	mxc: string | null,
	width?: number,
	height?: number
): string | null {
	if (!mxc || !client) return null;
	if (width && height) {
		return client.mxcUrlToHttp(mxc, width, height, "crop", true, true, true);
	}
	return client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
}

// ── Errors ───────────────────────────────────────────────────────

/**
 * A message a person can act on.
 *
 * Matrix errors carry an `errcode` that is far more useful than the HTTP
 * status, and a raw `M_FORBIDDEN` in the UI helps nobody.
 */
export function describe(error: unknown): string {
	if (!error) return "Something went wrong.";

	const matrixError = error as { errcode?: string; data?: { error?: string }; message?: string };
	switch (matrixError.errcode) {
		case "M_FORBIDDEN":
			return "That username and password were not accepted.";
		case "M_USER_DEACTIVATED":
			return "That account has been deactivated.";
		case "M_UNKNOWN_TOKEN":
			return "This session is no longer valid — log in again.";
		case "M_LIMIT_EXCEEDED":
			return "The homeserver is rate-limiting. Wait a moment and try again.";
		case "M_UNAUTHORIZED":
			return "The homeserver refused this request.";
		case "M_NOT_FOUND":
			return "The homeserver did not recognise that endpoint. Is the address right?";
	}
	if (matrixError.data?.error) return matrixError.data.error;
	if (matrixError.message) return matrixError.message;
	return String(error);
}
