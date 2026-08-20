/**
 * Sending files, and reading them back.
 *
 * The important part of this file is the encryption branch. Matrix does not
 * encrypt attachments as part of the room's E2EE: the *event* is encrypted,
 * but the media sits in the homeserver's repository, and unless the client
 * encrypts it first it is a plaintext file on someone else's disk that anyone
 * with the URL can read. Element does this client-side, and so does this.
 *
 * So: encrypted room means encrypt the bytes, upload the ciphertext, and put
 * the key in the (encrypted) event as `file`. Unencrypted room means a plain
 * `url`. There is no third path, and never a "just upload it anyway" fallback
 * — that would silently downgrade the room's privacy at the moment somebody
 * is trusting it most.
 */

import { encryptAttachment, decryptAttachment } from "matrix-encrypt-attachment";
import { MsgType, type MatrixClient } from "matrix-js-sdk";

/** The `file` block of an encrypted attachment event. */
export interface EncryptedFile {
	url: string;
	key: unknown;
	iv: string;
	hashes: Record<string, string>;
	v: string;
}

export interface Upload {
	id: string;
	name: string;
	size: number;
	/** 0..1, or null while the size is unknown. */
	progress: number | null;
	error: string;
}

export const uploads = $state({
	active: [] as Upload[]
});

let counter = 0;

/** Anything bigger than the server will take is rejected before we start. */
async function serverLimit(client: MatrixClient): Promise<number | null> {
	try {
		const config = await client.getMediaConfig();
		const limit = config?.["m.upload.size"];
		return typeof limit === "number" ? limit : null;
	} catch {
		// A server that won't say has no limit we can check. Let the upload try
		// and report whatever it says — better than inventing a cap.
		return null;
	}
}

function kindFor(mime: string): MsgType {
	if (mime.startsWith("image/")) return MsgType.Image;
	if (mime.startsWith("video/")) return MsgType.Video;
	if (mime.startsWith("audio/")) return MsgType.Audio;
	return MsgType.File;
}

/** Pixel dimensions, so the timeline can reserve space before it loads. */
async function imageSize(file: File): Promise<{ w: number; h: number } | null> {
	if (!file.type.startsWith("image/")) return null;
	try {
		const bitmap = await createImageBitmap(file);
		const size = { w: bitmap.width, h: bitmap.height };
		bitmap.close();
		return size;
	} catch {
		return null;
	}
}

/**
 * Upload and send one file. Resolves when the event is sent.
 *
 * `encrypted` decides the whole shape of what goes out, and is taken from the
 * room rather than guessed.
 */
export async function sendFile(
	client: MatrixClient,
	roomId: string,
	encrypted: boolean,
	file: File
): Promise<void> {
	const id = `up-${(counter += 1)}`;
	const entry: Upload = { id, name: file.name, size: file.size, progress: 0, error: "" };
	uploads.active.push(entry);

	const track = (index: number, patch: Partial<Upload>) => {
		const found = uploads.active.find((u) => u.id === id);
		if (found) Object.assign(found, patch);
		void index;
	};

	try {
		const limit = await serverLimit(client);
		if (limit !== null && file.size > limit) {
			throw new Error(
				`${file.name} is ${Math.round(file.size / 1024 / 1024)} MB, and this ` +
					`homeserver accepts at most ${Math.round(limit / 1024 / 1024)} MB.`
			);
		}

		const dimensions = await imageSize(file);
		const info: Record<string, unknown> = {
			mimetype: file.type || "application/octet-stream",
			size: file.size
		};
		if (dimensions) {
			info.w = dimensions.w;
			info.h = dimensions.h;
		}

		const content: Record<string, unknown> = {
			msgtype: kindFor(file.type),
			body: file.name,
			info
		};

		if (encrypted) {
			const plaintext = await file.arrayBuffer();
			const result = await encryptAttachment(plaintext);
			const uploaded = await client.uploadContent(new Blob([result.data]), {
				// The filename would otherwise be sent in the clear to the media
				// repo, which rather defeats encrypting the contents.
				includeFilename: false,
				type: "application/octet-stream",
				progressHandler: (state) => {
					track(0, { progress: state.total ? state.loaded / state.total : null });
				}
			});
			content.file = { ...result.info, url: uploaded.content_uri };
		} else {
			const uploaded = await client.uploadContent(file, {
				name: file.name,
				type: file.type || "application/octet-stream",
				progressHandler: (state) => {
					track(0, { progress: state.total ? state.loaded / state.total : null });
				}
			});
			content.url = uploaded.content_uri;
		}

		await client.sendMessage(roomId, content as never);
	} catch (error) {
		track(0, { error: error instanceof Error ? error.message : String(error) });
		// Left in the list so the failure is visible rather than vanishing.
		setTimeout(() => remove(id), 8000);
		throw error;
	}
	remove(id);
}

function remove(id: string): void {
	uploads.active = uploads.active.filter((u) => u.id !== id);
}

// ── Reading attachments back ─────────────────────────────────────

/**
 * Blob URLs for media we've fetched, so the same picture isn't downloaded
 * once per render. Keyed by mxc URI plus requested size.
 */
const decrypted = new Map<string, string>();
const fetched = new Map<string, string>();

/**
 * How many blobs to keep.
 *
 * Every cached entry is an object URL holding its bytes in memory until it is
 * revoked. Unbounded, a long session across busy rooms will hold every avatar
 * and image it has ever seen — which on the low-end hardware this targets is
 * the difference between running and swapping. Map preserves insertion order,
 * so evicting the oldest key is an LRU with no bookkeeping.
 */
const MEDIA_CACHE_LIMIT = 240;

function remember(cache: Map<string, string>, key: string, url: string): void {
	cache.set(key, url);
	while (cache.size > MEDIA_CACHE_LIMIT) {
		const oldest = cache.keys().next().value as string | undefined;
		if (oldest === undefined) break;
		const stale = cache.get(oldest);
		if (stale) URL.revokeObjectURL(stale);
		cache.delete(oldest);
	}
}

/** Move a hit to the newest position, so it survives eviction. */
function touch(cache: Map<string, string>, key: string): string | undefined {
	const url = cache.get(key);
	if (url === undefined) return undefined;
	cache.delete(key);
	cache.set(key, url);
	return url;
}

/**
 * Turn an `mxc://` into something an `<img>` can actually display.
 *
 * This exists because of authenticated media (MSC3916), which current
 * homeservers default to: the download URL requires an `Authorization`
 * header, and **an `<img src>` cannot send one**. Handing that URL straight
 * to an `<img>` gets a 401 and a broken-image glyph, which is why avatars and
 * pictures silently never appeared — including your own, right after
 * uploading it.
 *
 * So the bytes are fetched with the header and handed over as a blob URL.
 */
export async function resolveMxc(
	client: MatrixClient,
	mxc: string | null,
	width?: number,
	height?: number
): Promise<string | null> {
	if (!mxc) return null;
	const key = `${mxc}|${width ?? 0}|${height ?? 0}`;
	const cached = touch(fetched, key);
	if (cached) return cached;

	let http =
		width && height
			? client.mxcUrlToHttp(mxc, width, height, "crop", false, true, true)
			: client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
	if (!http) return null;

	/*
	 * Thumbnails are flattened to a still frame unless you ask otherwise, so
	 * an animated avatar arrives as a single motionless picture. The media
	 * spec has an `animated` flag for exactly this; the SDK's URL builder
	 * doesn't expose it, so it goes on here.
	 *
	 * A server that doesn't understand the parameter ignores it and returns
	 * the still thumbnail as before, so this cannot make anything worse.
	 */
	if (http.includes("/thumbnail/")) {
		http += `${http.includes("?") ? "&" : "?"}animated=true`;
	}

	try {
		const response = await fetch(http, { headers: authHeaders(client) });
		if (!response.ok) return null;
		const url = URL.createObjectURL(await response.blob());
		remember(fetched, key, url);
		return url;
	} catch {
		return null;
	}
}

/**
 * Resolve an attachment to something an <img> or <a> can use.
 *
 * Plain attachments are just an HTTP URL. Encrypted ones have to be fetched
 * as ciphertext and decrypted in the client — the homeserver cannot do it and
 * must never be able to.
 */
export async function resolveAttachment(
	client: MatrixClient,
	mxc: string | null,
	file: EncryptedFile | null
): Promise<string | null> {
	if (file?.url) {
		const cached = touch(decrypted, file.url);
		if (cached) return cached;

		const http = client.mxcUrlToHttp(file.url, undefined, undefined, undefined, false, true, true);
		if (!http) return null;
		try {
			const response = await fetch(http, {
				headers: authHeaders(client)
			});
			if (!response.ok) return null;
			const ciphertext = await response.arrayBuffer();
			const plaintext = await decryptAttachment(ciphertext, file as never);
			const url = URL.createObjectURL(new Blob([plaintext]));
			remember(decrypted, file.url, url);
			return url;
		} catch {
			return null;
		}
	}

	return resolveMxc(client, mxc);
}

/**
 * Authenticated media (MSC3916) is the default on current homeservers, so a
 * bare fetch of a download URL gets a 401.
 */
function authHeaders(client: MatrixClient): Record<string, string> {
	const token = client.getAccessToken();
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Drop every cached blob. Called on logout so nothing outlives the session. */
export function forgetAttachments(): void {
	for (const url of decrypted.values()) URL.revokeObjectURL(url);
	for (const url of fetched.values()) URL.revokeObjectURL(url);
	decrypted.clear();
	fetched.clear();
	uploads.active = [];
}

/** Drop one entry, so a changed avatar isn't served from the old blob. */
export function forgetMxc(mxc: string): void {
	for (const key of [...fetched.keys()]) {
		if (!key.startsWith(`${mxc}|`)) continue;
		const url = fetched.get(key);
		if (url) URL.revokeObjectURL(url);
		fetched.delete(key);
	}
}
