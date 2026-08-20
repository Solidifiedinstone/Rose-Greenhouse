<script lang="ts">
	import ProfileCard from "./ProfileCard.svelte";
	import { mx } from "$lib/matrix/client.svelte";
	import { PRESENCE_COLOURS, PRESENCE_LABELS, profile } from "$lib/matrix/profile.svelte";

	interface Props {
		onclose: () => void;
		onedit: () => void;
	}

	let { onclose, onedit }: Props = $props();
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onclose()} />

<div class="scrim" role="presentation" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
		<!--
			Deliberately the same component another person's client renders, so
			this is what they see rather than an approximation of it.
		-->
		<ProfileCard
			userId={mx.userId}
			displayName={profile.displayName || mx.userId}
			avatar={profile.avatar}
			extras={profile.extras}
		/>

		<div class="status">
			<i class="dot" style:background={PRESENCE_COLOURS[profile.presence]}></i>
			<span>{profile.statusMessage || PRESENCE_LABELS[profile.presence]}</span>
		</div>

		{#if !profile.extrasShared}
			<p class="note">
				Your homeserver doesn't publish extended profiles, so the banner, about
				me and styling above are visible only to you.
			</p>
		{:else}
			<p class="note">This is how you appear to other Greenhouse users.</p>
		{/if}

		<div class="actions">
			<button class="button" onclick={onclose}>Close</button>
			<button class="button primary" onclick={onedit}>Edit profile</button>
		</div>
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
		z-index: 76;
	}

	.panel {
		width: min(400px, 100%);
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.4);
		padding: 10px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 10px 8px 2px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
	}

	.note {
		margin: 6px 8px 10px;
		font-size: 11px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 0 4px 4px;
	}
</style>
