<script lang="ts">
	import Avatar from "./Avatar.svelte";
	import { getClient, mx } from "$lib/matrix/client.svelte";
	import { resolveMxc } from "$lib/matrix/upload.svelte";
	import FillEditor from "./FillEditor.svelte";
	import ProfileCard from "./ProfileCard.svelte";
	import {
		PRESENCE_LABELS,
		PROFILE_FONTS,
		cloneExtras,
		sameExtras,
		clearAvatar,
		profile,
		saveAvatar,
		saveBanner,
		saveDisplayName,
		saveExtras,
		savePresence,
		type Extras,
		type Presence
	} from "$lib/matrix/profile.svelte";

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	let name = $state(profile.displayName);
	let status = $state(profile.statusMessage);
	let presence = $state<Presence>(profile.presence);

	// Deep copy. A shallow spread leaves `card` and `name` pointing at the
	// saved profile's own objects, so editing them would mutate what we are
	// meant to be comparing against.
	let extras = $state<Extras>(cloneExtras(profile.extras));

	/*
	 * Nothing below is sent until Save is pressed.
	 *
	 * Picking a file used to upload it and set it on the server immediately,
	 * which meant "choose a picture" was really "change your picture on every
	 * device, now, with no way back". A file picker is not consent to publish.
	 * So a choice is staged here with a local preview, and only Save writes.
	 */
	let pendingAvatar: File | null = $state(null);
	let pendingBanner: File | null = $state(null);
	let removingAvatar = $state(false);

	/** Object URLs for the staged previews, revoked when replaced or closed. */
	let avatarPreview: string | null = $state(null);
	let bannerPreview: string | null = $state(null);

	let busy = $state(false);
	let error = $state("");
	let saved = $state(false);
	let avatarPicker: HTMLInputElement | null = $state(null);
	let bannerPicker: HTMLInputElement | null = $state(null);

	/*
	 * Same authenticated-media problem as avatars — the banner has to be
	 * fetched with a header rather than handed to CSS as a URL.
	 *
	 * Requested at full size, deliberately. Asking for a 1200x400 *cropped*
	 * thumbnail made the server re-frame the picture, so what came back after
	 * saving was not the image you chose — it had been cut to a different
	 * shape than the preview. The original plus `background-size: cover` is
	 * the only way the saved banner matches what the preview showed.
	 */
	let savedBanner: string | null = $state(null);
	$effect(() => {
		const client = getClient();
		const source = extras.banner;
		savedBanner = null;
		if (!client || !source) return;
		let cancelled = false;
		resolveMxc(client, source).then((url) => {
			if (!cancelled) savedBanner = url;
		});
		return () => {
			cancelled = true;
		};
	});

	const shownBanner = $derived(bannerPreview ?? savedBanner);

	/*
	 * Every editable field must appear here.
	 *
	 * The Save button is disabled unless this is true, so anything missing
	 * from the list is silently unsaveable — which is exactly what happened to
	 * the colours, the gradients and the font: they were edited, the card
	 * updated live, and Save stayed greyed out with no explanation.
	 *
	 * `sameExtras` compares the whole object rather than listing fields one by
	 * one, so adding a field to `Extras` can never leave it out of here again.
	 */
	const dirty = $derived(
		pendingAvatar !== null ||
			pendingBanner !== null ||
			removingAvatar ||
			name.trim() !== profile.displayName ||
			status !== profile.statusMessage ||
			presence !== profile.presence ||
			!sameExtras(extras, profile.extras)
	);

	function stageAvatar(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		if (avatarPreview) URL.revokeObjectURL(avatarPreview);
		pendingAvatar = file;
		removingAvatar = false;
		avatarPreview = URL.createObjectURL(file);
		saved = false;
	}

	function stageBanner(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		if (bannerPreview) URL.revokeObjectURL(bannerPreview);
		pendingBanner = file;
		bannerPreview = URL.createObjectURL(file);
		saved = false;
	}

	function dropBanner() {
		if (bannerPreview) URL.revokeObjectURL(bannerPreview);
		bannerPreview = null;
		pendingBanner = null;
		extras.banner = null;
		saved = false;
	}

	function dropAvatar() {
		if (avatarPreview) URL.revokeObjectURL(avatarPreview);
		avatarPreview = null;
		pendingAvatar = null;
		removingAvatar = true;
		saved = false;
	}

	/**
	 * Save each part independently.
	 *
	 * This used to be one try block in a fixed order, which meant a failure
	 * anywhere threw away everything after it. Presence ran before the
	 * styling, and plenty of homeservers — matrix.org among them — have
	 * presence switched off, so `setPresence` rejected and the profile never
	 * got written at all. Nothing about "save my colours" should depend on
	 * whether the server does status.
	 *
	 * So: every step runs, failures are collected, and the dialog names what
	 * didn't land rather than reporting a blanket failure.
	 */
	async function save() {
		const client = getClient();
		if (!client) return;
		busy = true;
		error = "";
		saved = false;

		const failures: string[] = [];
		/** Runs a step, records any failure, and reports whether it worked. */
		const attempt = async (what: string, run: () => Promise<void>): Promise<boolean> => {
			try {
				await run();
				return true;
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				console.warn(`profile: ${what} failed`, err);
				failures.push(`${what} (${detail})`);
				return false;
			}
		};

		let avatarDone = true;
		let bannerDone = true;
		let bannerMxc = extras.banner;

		if (pendingAvatar) {
			const file = pendingAvatar;
			avatarDone = await attempt("picture", () => saveAvatar(client, file));
		} else if (removingAvatar) {
			avatarDone = await attempt("removing picture", () => clearAvatar(client));
		}

		if (pendingBanner) {
			const file = pendingBanner;
			bannerDone = await attempt("banner upload", async () => {
				bannerMxc = await saveBanner(client, file);
			});
		}

		await attempt("display name", () => saveDisplayName(client, name));
		await attempt("status", () => savePresence(client, presence, status));
		await attempt("profile details", () => saveExtras(client, { ...extras, banner: bannerMxc }));

		// Only clear what actually succeeded, so a failed piece stays staged
		// and can be retried without redoing the rest.
		extras.banner = bannerMxc;
		if (avatarDone) {
			pendingAvatar = null;
			removingAvatar = false;
			if (avatarPreview) URL.revokeObjectURL(avatarPreview);
			avatarPreview = null;
		}
		if (bannerDone) {
			pendingBanner = null;
			if (bannerPreview) URL.revokeObjectURL(bannerPreview);
			bannerPreview = null;
		}

		busy = false;
		if (failures.length) {
			error = `Couldn't save: ${failures.join("; ")}`;
		} else {
			saved = true;
		}
	}

	function close() {
		if (avatarPreview) URL.revokeObjectURL(avatarPreview);
		if (bannerPreview) URL.revokeObjectURL(bannerPreview);
		onclose();
	}
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && close()} />

<div class="scrim" role="presentation" onclick={close}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
		<header class="head">
			<div class="banner" style:background-image={shownBanner ? `url(${shownBanner})` : undefined}>
				<div class="banner-tools">
					<button class="chip" onclick={() => bannerPicker?.click()} disabled={busy}>
						{shownBanner ? "Change banner" : "Add banner"}
					</button>
					{#if shownBanner}
						<button class="chip" onclick={dropBanner} disabled={busy}>Remove</button>
					{/if}
				</div>
			</div>

			<div class="identity">
				<div class="avatar-slot">
					{#if avatarPreview}
						<img class="staged" src={avatarPreview} alt="" />
					{:else}
						<Avatar
							id={mx.userId}
							name={name || mx.userId}
							mxc={removingAvatar ? null : profile.avatar}
							size={76}
						/>
					{/if}
					<button
						class="camera"
						onclick={() => avatarPicker?.click()}
						disabled={busy}
						title="Change picture"
						aria-label="Change picture"
					>✎</button>
				</div>

				<div class="who">
					<strong>{name || mx.userId}</strong>
					<code>{mx.userId}</code>
					{#if profile.avatar && !removingAvatar}
						<button class="link-button" onclick={dropAvatar} disabled={busy}>
							Remove picture
						</button>
					{:else if removingAvatar}
						<span class="pending-note">Picture will be removed on save</span>
					{/if}
				</div>
			</div>
		</header>

		<input type="file" accept="image/*" bind:this={avatarPicker} onchange={stageAvatar} hidden tabindex="-1" />
		<input type="file" accept="image/*" bind:this={bannerPicker} onchange={stageBanner} hidden tabindex="-1" />

		<div class="body">
			<label class="field">
				<span>Display name</span>
				<input bind:value={name} maxlength="80" />
			</label>

			<label class="field">
				<span>Status</span>
				<select bind:value={presence}>
					{#each Object.entries(PRESENCE_LABELS) as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>Status message</span>
				<input bind:value={status} maxlength="120" placeholder="What you're up to" />
			</label>

			<p class="note">Those are standard Matrix — everyone sees them, in Element too.</p>

			<label class="field">
				<span>Pronouns</span>
				<input bind:value={extras.pronouns} maxlength="40" placeholder="they/them" />
			</label>

			<label class="field top">
				<span>About me</span>
				<textarea bind:value={extras.about} rows="4" maxlength="1000" placeholder="A bit about you"></textarea>
			</label>

			<h4>Profile style</h4>
			<p class="note">
				This is exactly how your card appears to other Greenhouse users — the
				preview below is the same component their client draws.
			</p>

			<div class="preview">
				<ProfileCard
					userId={mx.userId}
					displayName={name || mx.userId}
					avatar={removingAvatar ? null : profile.avatar}
					extras={extras}
					bannerOverride={bannerPreview}
					avatarOverride={avatarPreview}
					compact
				/>
			</div>

			<label class="field">
				<span>Profile font</span>
				<select bind:value={extras.font}>
					{#each PROFILE_FONTS as font (font.id)}
						<option value={font.id}>{font.label}</option>
					{/each}
				</select>
			</label>

			<FillEditor
				label="Card background"
				hint="Behind your whole profile card"
				fill={extras.card}
				onchange={(fill) => (extras.card = fill)}
			/>

			<FillEditor
				label="Name text"
				hint="Your display name — gradients are clipped to the letters"
				fill={extras.name}
				onchange={(fill) => (extras.name = fill)}
			/>

			<div class="field">
				<span>Body text</span>
				<div class="colours">
					<label class="colour">
						<input
							type="color"
							value={extras.text || "#ecebf0"}
							oninput={(event) => (extras.text = event.currentTarget.value)}
						/>
						<span>Colour</span>
					</label>
					<button class="link-button" onclick={() => (extras.text = "")}>
						Use theme colour
					</button>
				</div>
			</div>

			{#if profile.extrasFellBack}
				<p class="note warn">
					This homeserver advertised extended profiles but refused to store
					them, so your banner, about me and pronouns were saved privately
					instead — they're kept, but only you can see them.
				</p>
			{:else if profile.extrasShared}
				<p class="note">
					Banner, about me and pronouns aren't standard Matrix, but this homeserver
					supports extended profiles, so they're saved as part of your public
					profile.
				</p>
			{:else}
				<p class="note warn">
					Banner, about me and pronouns aren't part of Matrix, and this homeserver
					doesn't support extended profiles — so they're stored privately and
					<strong>only you can see them</strong>.
				</p>
			{/if}
		</div>

		{#if error}<p class="error-text pad">{error}</p>{/if}
		{#if profile.extrasError}
			<p class="error-text pad">{profile.extrasError}</p>
		{/if}

		<footer class="actions">
			<span class="state">
				{#if busy}Saving…{:else if saved}Saved.{:else if dirty}Unsaved changes{/if}
			</span>
			<button class="button" onclick={close} disabled={busy}>Close</button>
			<button class="button primary" onclick={save} disabled={busy || !dirty}>Save</button>
		</footer>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.6);
		display: grid;
		place-items: center;
		padding: 24px;
		z-index: 75;
	}

	.panel {
		width: min(520px, 100%);
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.4);
		overflow: hidden;
	}

	.head {
		flex: none;
	}

	.banner {
		position: relative;
		height: 128px;
		background-color: var(--accent-muted);
		background-size: cover;
		background-position: center;
	}

	.banner-tools {
		position: absolute;
		right: 10px;
		top: 10px;
		display: flex;
		gap: 6px;
	}

	.chip {
		padding: 5px 10px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text);
		background: rgb(0 0 0 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.18);
		border-radius: 999px;
		backdrop-filter: blur(4px);
	}

	.chip:hover:not(:disabled) {
		background: rgb(0 0 0 / 0.75);
	}

	/*
	 * Only the avatar overlaps the banner. Pulling the whole row up put the
	 * name on top of the artwork, where it was unreadable against anything
	 * busy — so the text sits in normal flow below the banner edge and the
	 * avatar alone is lifted into it.
	 */
	.identity {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		padding: 10px 22px 14px;
	}

	.avatar-slot {
		margin-top: -46px;
	}

	.avatar-slot {
		position: relative;
		flex: none;
		border-radius: var(--avatar-rounding, 50%);
		border: 3px solid var(--overlay);
		background: var(--overlay);
		line-height: 0;
	}

	.staged {
		width: 76px;
		height: 76px;
		object-fit: cover;
		border-radius: var(--avatar-rounding, 50%);
		display: block;
	}

	/* A small badge rather than a word laid over the face — the overlay label
	   covered the avatar exactly when you were trying to look at it. */
	.camera {
		position: absolute;
		right: -2px;
		bottom: -2px;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-text);
		border: 2px solid var(--overlay);
		font-size: 12px;
		line-height: 1;
	}

	.who {
		flex: 1;
		min-width: 0;
		padding-top: 2px;
	}

	.who strong {
		display: block;
		font-size: 17px;
		line-height: 1.25;
	}

	.who code {
		display: block;
		font-size: 11px;
		background: none;
		padding: 0;
		color: var(--text-faint);
		overflow-wrap: anywhere;
	}

	.link-button {
		margin-top: 4px;
		font-size: 11px;
		color: var(--text-faint);
		text-decoration: underline;
	}

	.link-button:hover {
		color: var(--danger);
	}

	.pending-note {
		display: block;
		margin-top: 4px;
		font-size: 11px;
		color: var(--warning);
	}

	.body {
		flex: 1;
		overflow-y: auto;
		padding: 4px 22px 6px;
		border-top: var(--border-width, 1px) solid var(--border);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 10px 0;
		font-size: 12px;
		color: var(--text-dim);
	}

	.field.top {
		align-items: flex-start;
	}

	.field span {
		min-width: 108px;
	}

	select {
		flex: 1;
		background: var(--raised);
		color: var(--text);
		border: var(--border-width, 1px) solid var(--border);
		border-radius: var(--radius);
		padding: 8px 9px;
		font: inherit;
	}

	textarea {
		resize: vertical;
	}

	.note {
		margin: 4px 0 12px;
		font-size: 11px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.note.warn {
		color: var(--warning);
	}

	h4 {
		margin: 18px 0 6px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.preview {
		margin: 0 0 14px;
	}

	.colours {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}

	.colour {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
	}

	.colour input {
		width: 26px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: none;
		cursor: pointer;
	}

	.pad {
		padding: 0 22px;
	}

	.actions {
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 22px;
		border-top: var(--border-width, 1px) solid var(--border);
	}

	.state {
		flex: 1;
		font-size: 11px;
		color: var(--text-faint);
	}
</style>
