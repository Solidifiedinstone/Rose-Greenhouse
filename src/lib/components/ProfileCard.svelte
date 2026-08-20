<script lang="ts">
	import Avatar from "./Avatar.svelte";
	import { getClient } from "$lib/matrix/client.svelte";
	import { resolveMxc } from "$lib/matrix/upload.svelte";
	import { fillBackground, fontStack, type Extras } from "$lib/matrix/profile.svelte";
	import { activityLabel, decodeActivity } from "$lib/matrix/activity.svelte";

	interface Props {
		userId: string;
		displayName: string;
		avatar: string | null;
		extras: Extras;
		/** A local preview URL, used while editing before anything is uploaded. */
		bannerOverride?: string | null;
		avatarOverride?: string | null;
		compact?: boolean;
	}

	let {
		userId,
		displayName,
		avatar,
		extras,
		bannerOverride = null,
		avatarOverride = null,
		compact = false
	}: Props = $props();

	/*
	 * One component draws both your own preview and other people's cards.
	 *
	 * That is the point: whatever you see while editing is literally the same
	 * renderer everyone else's client uses, so the preview cannot drift from
	 * what other people actually get.
	 */
	let bannerUrl: string | null = $state(null);
	$effect(() => {
		const client = getClient();
		const source = extras.banner;
		bannerUrl = null;
		if (!client || !source) return;
		let cancelled = false;
		resolveMxc(client, source).then((url) => {
			if (!cancelled) bannerUrl = url;
		});
		return () => {
			cancelled = true;
		};
	});

	const banner = $derived(bannerOverride ?? bannerUrl);

	/*
	 * Every value is validated on the way in — see `sanitise`. A fill of
	 * "none" means "use the viewer's theme", so an unstyled profile looks
	 * native instead of forcing a default nobody chose.
	 */
	const cardBackground = $derived(fillBackground(extras.card, "var(--raised)"));
	const text = $derived(extras.text || "var(--text)");
	const accent = $derived(extras.name.from || extras.card.from || "var(--accent)");
	const family = $derived(fontStack(extras.font));

	/** The name can be a gradient, which needs clipping to the glyphs. */
	const nameStyle = $derived.by(() => {
		const fill = extras.name;
		if (fill.kind === "gradient" && fill.from) {
			const to = fill.to || fill.from;
			return (
				`background-image: linear-gradient(${fill.angle}deg, ${fill.from}, ${to});` +
				"background-clip: text; -webkit-background-clip: text; color: transparent;"
			);
		}
		if (fill.kind === "glass" && fill.from) {
			return `color: ${fill.from}; text-shadow: 0 1px 10px ${fill.from}80;`;
		}
		if (fill.kind === "outline" && fill.from) {
			return `color: transparent; -webkit-text-stroke: 1px ${fill.from};`;
		}
		if (fill.kind === "flat" && fill.from) return `color: ${fill.from};`;
		return `color: ${accent};`;
	});
</script>

<article
	class="card {extras.card.kind}"
	class:compact
	style:background={cardBackground}
	style:color={text}
	style:font-family={family}
	style:--card-accent={accent}
	style:--card-text={text}
>
	<div class="banner" style:background-image={banner ? `url(${banner})` : undefined}></div>

	<div class="identity">
		<div class="avatar-slot">
			{#if avatarOverride}
				<img class="staged" src={avatarOverride} alt="" />
			{:else}
				<Avatar id={userId} name={displayName} mxc={avatar} size={compact ? 56 : 70} />
			{/if}
		</div>
		<div class="who">
			<strong style={nameStyle}>{displayName}</strong>
			<code>{userId}</code>
			{#if extras.pronouns}
				<span class="pronouns">{extras.pronouns}</span>
			{/if}
			{#if activityLabel(decodeActivity(extras.activity))}
				<span class="activity">{activityLabel(decodeActivity(extras.activity))}</span>
			{/if}
		</div>
	</div>

	{#if extras.about}
		<p class="about selectable">{extras.about}</p>
	{/if}
</article>

<style>
	.card {
		border-radius: calc(var(--radius) * 1.2);
		overflow: hidden;
		border: var(--border-width, 1px) solid var(--border);
	}

	.card.outline {
		border: 2px solid var(--card-accent);
	}

	.card.glass {
		backdrop-filter: blur(10px);
		border: 1px solid rgb(255 255 255 / 0.18);
	}

	.banner {
		height: 104px;
		background-color: var(--card-accent);
		background-size: cover;
		background-position: center;
	}

	.compact .banner {
		height: 74px;
	}

	.identity {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 10px 16px 0;
	}

	.avatar-slot {
		flex: none;
		margin-top: -40px;
		border-radius: var(--avatar-rounding, 50%);
		border: 3px solid currentColor;
		line-height: 0;
	}

	.compact .avatar-slot {
		margin-top: -32px;
	}

	.staged {
		width: 70px;
		height: 70px;
		object-fit: cover;
		border-radius: var(--avatar-rounding, 50%);
		display: block;
	}

	.who {
		flex: 1;
		min-width: 0;
		padding-top: 2px;
	}

	.who strong {
		display: block;
		font-size: 17px;
		line-height: 1.3;
	}

	.who code {
		display: block;
		font-size: 11px;
		background: none;
		padding: 0;
		opacity: 0.65;
		overflow-wrap: anywhere;
		font-family: var(--mono-family);
	}

	.pronouns {
		display: inline-block;
		margin-top: 4px;
		padding: 1px 7px;
		font-size: 11px;
		border-radius: 999px;
		border: 1px solid currentColor;
		opacity: 0.75;
	}

	.activity {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		opacity: 0.85;
	}

	.about {
		margin: 10px 16px 14px;
		font-size: 13px;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		opacity: 0.9;
	}
</style>
