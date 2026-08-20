/**
 * Device verification — the thing standing between you and your own history.
 *
 * A fresh login gets its own device key, which nobody has met before. Until
 * another of your sessions vouches for it, the homeserver will not hand it
 * the room keys, so every encrypted message that predates the login shows as
 * "encrypted message" or fails to decrypt. That is not a bug in the client;
 * it is the encryption working, and the fix is to verify.
 *
 * The flow implemented here is SAS — short authentication string, the emoji
 * comparison. Both directions work: this client can ask another session to
 * verify it, and it answers a request started from Element or any other
 * client.
 *
 * Deliberately NOT implemented, and said plainly rather than stubbed:
 * recovery-key restore for people with no second session. If this is your
 * only signed-in device, verification here cannot help you and the UI says
 * so instead of spinning.
 */

// The crypto API is not re-exported from the package root in this version,
// so these come from the subpath. Checked against the installed build rather
// than assumed — the root export has none of these at runtime.
import {
	CryptoEvent,
	VerificationPhase,
	VerificationRequestEvent,
	VerifierEvent,
	type EmojiMapping,
	type ShowSasCallbacks,
	type VerificationRequest
} from "matrix-js-sdk/lib/crypto-api";
import type { MatrixClient } from "matrix-js-sdk";

export type VerifyStage =
	| "idle"
	| "requesting" // waiting for the other session to accept
	| "ready" // accepted; picking a method
	| "comparing" // emoji on screen, waiting for both sides
	| "waiting" // we confirmed; waiting for them
	| "done"
	| "cancelled"
	| "error";

export const verify = $state({
	/** Is this device signed by our own cross-signing identity? */
	deviceVerified: false,
	crossSigningReady: false,
	keyBackup: false,
	/** How many other sessions could do the verifying. */
	otherDevices: 0,
	/** True once we have actually asked the crypto stack, so the UI can wait. */
	checked: false,

	stage: "idle" as VerifyStage,
	/** The seven emoji, as [emoji, name] pairs. */
	emoji: [] as EmojiMapping[],
	otherDeviceId: "",
	error: "",
	/** Set when the other side started it, so the UI can offer to accept. */
	incoming: false,
	/**
	 * A short record of what happened, shown when something fails.
	 *
	 * This exists because verification cannot be reproduced without two real
	 * signed-in sessions, so a failure that only says "it failed" leaves
	 * nothing to work from. Phases, codes and errors in order are enough to
	 * tell a cancelled exchange from a protocol ordering mistake.
	 */
	trace: [] as string[]
});

function note(line: string): void {
	verify.trace = [...verify.trace, line].slice(-20);
}

let request: VerificationRequest | null = null;
let sas: ShowSasCallbacks | null = null;

/** Read the real state out of the crypto stack. Safe to call often. */
export async function refreshStatus(client: MatrixClient | null): Promise<void> {
	const crypto = client?.getCrypto();
	if (!client || !crypto) {
		verify.checked = true;
		return;
	}
	try {
		const userId = client.getUserId();
		const deviceId = client.getDeviceId();
		if (userId && deviceId) {
			const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
			// crossSigningVerified is the one that matters: "signed by an identity
			// I trust", not merely "locally marked as fine".
			verify.deviceVerified = Boolean(status?.crossSigningVerified);
			/*
			 * `downloadUncached: true` matters.
			 *
			 * Without it this returns only devices already in the local cache,
			 * which on a fresh login is just this one — so the count came back
			 * zero, the dialog decided there was nothing to verify against, and
			 * refused to start. Asking the server is the whole point here.
			 */
			const devices = await crypto.getUserDeviceInfo([userId], true);
			const mine = devices.get(userId);
			verify.otherDevices = mine ? Math.max(0, mine.size - 1) : 0;
		}
		verify.crossSigningReady = await crypto.isCrossSigningReady();
		verify.keyBackup = Boolean(await crypto.getActiveSessionBackupVersion());
	} catch (error) {
		console.warn("could not read encryption status", error);
	} finally {
		verify.checked = true;
	}
}

/** Listen for verification started from another client. Call once, on connect. */
export function watchForRequests(client: MatrixClient): () => void {
	const onRequest = (incoming: VerificationRequest) => {
		// Ignore anything already finished, and don't stomp one in progress.
		if (incoming.phase === VerificationPhase.Done) return;
		if (request && request.phase !== VerificationPhase.Done) return;
		request = incoming;
		verify.incoming = true;
		verify.stage = "requesting";
		verify.otherDeviceId = incoming.otherDeviceId ?? "";
		verify.error = "";
		attach(incoming);
	};

	client.on(CryptoEvent.VerificationRequestReceived, onRequest);
	return () => client.off(CryptoEvent.VerificationRequestReceived, onRequest);
}

/** Ask another of your sessions to verify this one. */
export async function start(client: MatrixClient | null): Promise<void> {
	const crypto = client?.getCrypto();
	if (!crypto) {
		verify.stage = "error";
		verify.error = "Encryption isn't running, so there is nothing to verify.";
		return;
	}
	reset();
	verify.stage = "requesting";
	note("requesting");
	try {
		request = await crypto.requestOwnUserVerification();
		verify.otherDeviceId = request.otherDeviceId ?? "";
		attach(request);
	} catch (error) {
		verify.stage = "error";
		verify.error = message(error);
	}
}

/** Accept a request another session started. */
export async function accept(): Promise<void> {
	if (!request) return;
	try {
		await request.accept();
	} catch (error) {
		verify.stage = "error";
		verify.error = message(error);
	}
}

/** Both sides show the same emoji — say so. */
export async function confirmMatch(): Promise<void> {
	if (!sas) return;
	verify.stage = "waiting";
	try {
		await sas.confirm();
	} catch (error) {
		/*
		 * Confirming only queues our half. The exchange is not finished until
		 * the other side confirms too, and `verifier.verify()` is what reports
		 * that — so a failure here is reported with what it actually was
		 * rather than a bare "verification failed".
		 */
		note(`confirm failed: ${message(error)}`);
		verify.stage = "error";
		verify.error = `Sending your confirmation failed: ${message(error)}`;
	}
}

/**
 * The emoji differ. This is the one branch that actually matters for
 * security: a mismatch means something is sitting between the two sessions,
 * so it must cancel loudly rather than quietly retry.
 */
export function reportMismatch(): void {
	if (!sas) return;
	sas.mismatch();
	verify.stage = "cancelled";
	verify.error =
		"You said the emoji didn't match, so the verification was stopped. " +
		"If they really differ, something is intercepting the exchange — do " +
		"not verify, and check the other session.";
}

export async function cancel(): Promise<void> {
	try {
		await request?.cancel();
	} catch {
		// Cancelling a request that has already gone is not worth reporting.
	}
	reset();
}

export function reset(): void {
	request = null;
	sas = null;
	sasStarted = false;
	drivenVerifier = null;
	verify.stage = "idle";
	verify.emoji = [];
	verify.error = "";
	verify.incoming = false;
	verify.otherDeviceId = "";
	verify.trace = [];
}

// ── Wiring one request through to the emoji ──────────────────────

/**
 * One request in flight, and the guards that keep it that way.
 *
 * `VerificationRequestEvent.Change` fires for every update, not once per
 * phase, so everything reached from it has to be idempotent. Without these
 * flags the code below re-entered on each change: it sent a second
 * `m.key.verification.start`, attached a second `ShowSas` listener, and called
 * `verifier.verify()` again on a verifier that was already running — which
 * cancels the exchange. That is why verification failed partway through.
 */
let sasStarted = false;
let drivenVerifier: unknown = null;

function attach(current: VerificationRequest): void {
	sasStarted = false;
	drivenVerifier = null;

	const onChange = () => {
		if (current !== request) return;
		verify.otherDeviceId = current.otherDeviceId ?? verify.otherDeviceId;

		note(`phase ${VerificationPhase[current.phase] ?? current.phase}`);

		switch (current.phase) {
			case VerificationPhase.Ready:
				verify.stage = "ready";
				/*
				 * Only the side that sent the request sends the start.
				 *
				 * The spec puts `m.key.verification.start` on the initiator. If
				 * both ends send one, the two race and the loser's exchange is
				 * cancelled — which looked exactly like "verification is
				 * broken", because it was.
				 */
				if (current.initiatedByMe) void beginSas(current);
				else hookVerifier(current);
				break;
			case VerificationPhase.Started:
				hookVerifier(current);
				break;
			case VerificationPhase.Done:
				verify.stage = "done";
				verify.emoji = [];
				break;
			case VerificationPhase.Cancelled:
				verify.stage = "cancelled";
				if (!verify.error) {
					verify.error = current.cancellationCode
						? `Cancelled (${current.cancellationCode}).`
						: "The other session cancelled.";
				}
				break;
		}
	};

	current.on(VerificationRequestEvent.Change, onChange);
	onChange();
}

async function beginSas(current: VerificationRequest): Promise<void> {
	if (sasStarted) return;
	if (current.verifier) {
		hookVerifier(current);
		return;
	}

	sasStarted = true;
	note("sending start");
	try {
		await current.startVerification("m.sas.v1");
		hookVerifier(current);
	} catch (error) {
		// If the other side started at the same moment, the request still ends
		// up with a verifier and the exchange can continue from it.
		if (current.verifier) {
			hookVerifier(current);
			return;
		}
		sasStarted = false;
		verify.stage = "error";
		verify.error = message(error);
	}
}

function hookVerifier(current: VerificationRequest): void {
	const verifier = current.verifier;
	if (!verifier) return;

	// Driving the same verifier twice cancels it. This is reached from several
	// phase changes, so the guard is the point.
	if (drivenVerifier === verifier) return;
	drivenVerifier = verifier;
	note("driving verifier");

	/*
	 * A new verifier means the old callbacks are dead.
	 *
	 * `confirm()` calls straight into the Rust verifier it came from, so
	 * holding callbacks belonging to a verifier that has been replaced makes
	 * "they match" throw the instant it is pressed — before the other side has
	 * done anything. Clearing here is what stops a retried or superseded
	 * exchange failing on the first click.
	 */
	sas = null;
	verify.emoji = [];

	verifier.on(VerifierEvent.ShowSas, show);
	// Same object the event carries, so this is only a head start, not a
	// different set of callbacks.
	const existing = verifier.getShowSasCallbacks();
	if (existing) show(existing);
	// The verifier only produces the SAS once it is driven, and this resolves
	// when the whole exchange finishes.
	verifier.verify().catch((error: unknown) => {
		if (verify.stage === "done" || verify.stage === "cancelled") return;
		verify.stage = "error";
		// The cancellation code is the useful part — "m.user" means somebody
		// pressed cancel, "m.mismatched_sas" means the emoji differed, and
		// "m.timeout" means nobody answered. A bare message hides all of that.
		const code = request?.cancellationCode;
		verify.error = code ? `${message(error)} (${code})` : message(error);
	});
}

function show(callbacks: ShowSasCallbacks): void {
	note("emoji shown");
	sas = callbacks;
	// The emoji live on the generated SAS, not on the callbacks themselves.
	verify.emoji = callbacks.sas.emoji ?? [];
	verify.stage = "comparing";
}

function message(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error ?? "Something went wrong.");
}
