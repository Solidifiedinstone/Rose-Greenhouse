<script lang="ts">
	import { getClient } from "$lib/matrix/client.svelte";
	import { resolveMxc } from "$lib/matrix/upload.svelte";
	import { colourForId, initials } from "$lib/matrix/views";
	import { activeTheme } from "$lib/theme/theme.svelte";
	import { avatarPalette } from "$lib/theme/tokens";

	interface Props {
		id: string;
		name: string;
		mxc?: string | null;
		size?: number;
		/** Rooms are squircles, people are circles — overrides the theme. */
		square?: boolean;
	}

	let { id, name, mxc = null, size = 36, square = false }: Props = $props();

	/*
	 * Fetched rather than pointed at.
	 *
	 * With authenticated media the thumbnail URL needs an Authorization
	 * header, and an <img src> cannot send one — so a plain URL 401s and every
	 * avatar in the app silently falls back to initials. Resolving through a
	 * blob is what makes pictures appear at all.
	 */
	let url: string | null = $state(null);
	$effect(() => {
		const client = getClient();
		const source = mxc;
		const wanted = size * 2;
		url = null;
		broken = false;
		if (!client || !source) return;

		let cancelled = false;
		resolveMxc(client, source, wanted, wanted).then((resolved) => {
			if (cancelled) return;
			url = resolved;
			broken = resolved === null;
		});
		return () => {
			cancelled = true;
		};
	});

	/**
	 * Homeservers 404 thumbnails more often than you would hope — a media repo
	 * that has purged the file, or a remote server that will not federate it.
	 * Without this the webview draws its own broken-image glyph, which is how
	 * a blue question mark ends up sitting permanently in the UI. Falling back
	 * to initials is both nicer and honest: there is no picture.
	 */
	let broken = $state(false);
	const src = $derived(broken ? null : url);
</script>

<div
	class="avatar"
	style:width="{size}px"
	style:height="{size}px"
	style:border-radius={square ? "calc(var(--radius) * 0.9)" : "var(--avatar-rounding)"}
	style:background={src ? "transparent" : colourForId(id, avatarPalette(activeTheme()))}
	style:font-size="{Math.round(size * 0.38)}px"
	title={name}
>
	{#if src}
		<img {src} alt="" loading="lazy" onerror={() => (broken = true)} />
	{:else}
		<span>{initials(name)}</span>
	{/if}
</div>

<style>
	.avatar {
		flex: none;
		display: grid;
		place-items: center;
		overflow: hidden;
		color: #fff;
		font-weight: 700;
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.35);
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
</style>
