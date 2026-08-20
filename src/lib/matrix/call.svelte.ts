/**
 * Voice and video calls.
 *
 * One-to-one only, using Matrix's original VoIP — which is what the SDK
 * implements and what every other Matrix client can answer. Group calls are a
 * different protocol (MatrixRTC) needing a media server to mix the streams,
 * so they are not here and are not pretended to be.
 *
 * The media itself never touches a homeserver: WebRTC negotiates a direct
 * peer connection and the homeserver only carries the signalling. That is why
 * resolution is not capped by anything we control — the two ends agree it
 * between themselves.
 *
 * Two honest caveats, surfaced rather than buried:
 *
 *  * **Without a TURN server, a call may not connect at all** when both ends
 *    are behind awkward NAT. Most homeservers provide one; some don't.
 *  * **Screen sharing depends on the webview**, not on us. `getDisplayMedia`
 *    is missing or partial in some builds of WebKitGTK, so it is offered only
 *    when the browser actually has it.
 */

import {
	CallErrorCode,
	CallEvent,
	CallState,
	CallType,
	type MatrixCall
} from "matrix-js-sdk/lib/webrtc/call";
import { CallEventHandlerEvent } from "matrix-js-sdk/lib/webrtc/callEventHandler";
import type { MatrixClient } from "matrix-js-sdk";

export type CallPhase =
	| "idle"
	| "ringing" // someone is calling us
	| "dialling" // we are calling them
	| "connecting"
	| "active"
	| "ended";

export const call = $state({
	phase: "idle" as CallPhase,
	/** Room the call belongs to. */
	roomId: "",
	roomName: "",
	/** Who we are talking to, when we can tell. */
	withWhom: "",
	video: false,
	incoming: false,
	muted: false,
	cameraOff: false,
	screensharing: false,
	/** Seconds, once connected. */
	seconds: 0,
	error: "",
	/** False when the webview has no getDisplayMedia. */
	canScreenshare: false
});

let active: MatrixCall | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

/** Streams for the UI to attach to <video>/<audio> elements. */
export const streams = $state({
	local: null as MediaStream | null,
	remote: null as MediaStream | null
});

export function callSupported(client: MatrixClient | null): boolean {
	return Boolean(client?.supportsVoip());
}

export function screenshareSupported(): boolean {
	return (
		typeof navigator !== "undefined" &&
		typeof navigator.mediaDevices?.getDisplayMedia === "function"
	);
}

/** Listen for incoming calls. Returns a detacher. */
export function watchForCalls(client: MatrixClient): () => void {
	const onIncoming = (incoming: MatrixCall) => {
		// One call at a time: answering a second while the first is up would
		// mean two audio streams and no way to tell which is which.
		if (active && call.phase !== "idle" && call.phase !== "ended") {
			incoming.reject();
			return;
		}
		adopt(client, incoming, true);
	};

	client.on(CallEventHandlerEvent.Incoming, onIncoming as never);
	return () => client.off(CallEventHandlerEvent.Incoming, onIncoming as never);
}

export async function placeCall(
	client: MatrixClient | null,
	roomId: string,
	roomName: string,
	video: boolean
): Promise<void> {
	if (!client) return;
	if (active) return;

	const created = client.createCall(roomId);
	if (!created) {
		call.error =
			"This room can't take a call. One-to-one calls only work in a room with " +
			"exactly two people in it.";
		call.phase = "ended";
		return;
	}

	call.roomName = roomName;
	adopt(client, created, false);
	try {
		if (video) await created.placeVideoCall();
		else await created.placeVoiceCall();
	} catch (error) {
		call.error = describeCallError(error);
		hangUp();
	}
}

export async function answerCall(video: boolean): Promise<void> {
	if (!active) return;
	try {
		await active.answer(true, video);
	} catch (error) {
		call.error = describeCallError(error);
		hangUp();
	}
}

export function rejectCall(): void {
	active?.reject();
	teardown();
}

export function hangUp(): void {
	active?.hangup(CallErrorCode.UserHangup, false);
	teardown();
}

export function toggleMute(): void {
	if (!active) return;
	call.muted = !call.muted;
	active.setMicrophoneMuted(call.muted);
}

export function toggleCamera(): void {
	if (!active || !call.video) return;
	call.cameraOff = !call.cameraOff;
	active.setLocalVideoMuted(call.cameraOff);
}

export async function toggleScreenshare(): Promise<void> {
	if (!active || !screenshareSupported()) return;
	try {
		const wanted = !call.screensharing;
		const ok = await active.setScreensharingEnabled(wanted);
		call.screensharing = ok ? wanted : call.screensharing;
		if (!ok && wanted) {
			call.error = "The system wouldn't hand over a screen to share.";
		}
	} catch (error) {
		call.error = describeCallError(error);
	}
}

// ── Internals ────────────────────────────────────────────────────

function adopt(client: MatrixClient, incoming: MatrixCall, isIncoming: boolean): void {
	active = incoming;
	call.roomId = incoming.roomId ?? "";
	call.incoming = isIncoming;
	call.video = incoming.type === CallType.Video;
	call.muted = false;
	call.cameraOff = false;
	call.screensharing = false;
	call.seconds = 0;
	call.error = "";
	call.canScreenshare = screenshareSupported();
	call.phase = isIncoming ? "ringing" : "dialling";

	if (!call.roomName && call.roomId) {
		call.roomName = client.getRoom(call.roomId)?.name ?? call.roomId;
	}
	const room = client.getRoom(call.roomId);
	const other = room?.getJoinedMembers().find((m) => m.userId !== client.getUserId());
	call.withWhom = other?.name ?? "";

	incoming.on(CallEvent.State, onState as never);
	incoming.on(CallEvent.Hangup, teardown as never);
	incoming.on(CallEvent.Error, ((error: unknown) => {
		call.error = describeCallError(error);
	}) as never);
	incoming.on(CallEvent.FeedsChanged, updateFeeds as never);
	updateFeeds();
}

function onState(state: CallState): void {
	switch (state) {
		case CallState.Connecting:
			call.phase = "connecting";
			break;
		case CallState.Connected:
			call.phase = "active";
			startTicking();
			break;
		case CallState.Ended:
			teardown();
			break;
	}
}

function updateFeeds(): void {
	if (!active) return;
	// The SDK hands feeds rather than streams; the UI wants the streams.
	streams.local = active.getLocalFeeds()[0]?.stream ?? null;
	streams.remote = active.getRemoteFeeds()[0]?.stream ?? null;
}

function startTicking(): void {
	if (ticker) return;
	ticker = setInterval(() => {
		call.seconds += 1;
	}, 1000);
}

function teardown(): void {
	if (ticker) {
		clearInterval(ticker);
		ticker = null;
	}
	if (active) {
		active.removeAllListeners();
		active = null;
	}
	streams.local = null;
	streams.remote = null;
	call.phase = "ended";
	call.screensharing = false;

	// Cleared shortly after, so a hangup is visible for a moment rather than
	// the panel just vanishing.
	setTimeout(() => {
		if (call.phase === "ended") {
			call.phase = "idle";
			call.roomId = "";
			call.roomName = "";
			call.withWhom = "";
			call.seconds = 0;
		}
	}, 2500);
}

/** Turn a WebRTC or SDK failure into something worth reading. */
export function describeCallError(error: unknown): string {
	const name = (error as { name?: string } | undefined)?.name;
	if (name === "NotAllowedError") {
		return "Permission for the microphone or camera was refused.";
	}
	if (name === "NotFoundError") {
		return "No microphone or camera was found.";
	}
	if (name === "NotReadableError") {
		return "The microphone or camera is already in use by something else.";
	}
	const message = (error as { message?: string } | undefined)?.message;
	return message ?? "The call failed.";
}

/** mm:ss for the timer. */
export function callDuration(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return `${minutes}:${String(rest).padStart(2, "0")}`;
}
