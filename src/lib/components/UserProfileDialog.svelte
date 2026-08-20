<script lang="ts">
	import ProfileCard from "./ProfileCard.svelte";
	import { getClient } from "$lib/matrix/client.svelte";
	import { loadUserProfile, type OtherProfile } from "$lib/matrix/profile.svelte";
	import { blockUser, isBlocked, unblockUser } from "$lib/matrix/client.svelte";

	interface Props {
		userId: string;
		onclose: () => void;
	}

	let { userId, onclose }: Props = $props();

	let loaded: OtherProfile | null = $state(null);
	let failed = $state(false);

	$effect(() => {
		const client = getClient();
		const target = userId;
		loaded = null;
		failed = false;
		if (!client) return;

		let cancelled = false;
		loadUserProfile(client, target)
			.then((result) => {
				if (!cancelled) loaded = result;
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onclose()} />

<div class="scrim" role="presentation" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
		{#if loaded}
			<ProfileCard
				userId={loaded.userId}
				displayName={loaded.displayName}
				avatar={loaded.avatar}
				extras={loaded.extras}
			/>
			{#if !loaded.styled}
				<p class="note">
					Their homeserver doesn't publish extended profiles, so there's no
					banner, about me or styling to show — only the name and picture
					every Matrix client shares.
				</p>
			{/if}
			<div class="actions">
				{#if isBlocked(loaded.userId)}
					<button class="button" onclick={() => void unblockUser(loaded!.userId)}>
						Unblock
					</button>
				{:else}
					<button class="button danger" onclick={() => void blockUser(loaded!.userId)}>
						Block
					</button>
				{/if}
				<button class="button primary" onclick={onclose}>Close</button>
			</div>
		{:else if failed}
			<p class="note">Couldn't load that profile.</p>
			<div class="actions">
				<button class="button primary" onclick={onclose}>Close</button>
			</div>
		{:else}
			<p class="note">Loading…</p>
		{/if}
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
		z-index: 78;
	}

	.panel {
		width: min(400px, 100%);
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.4);
		padding: 10px;
	}

	.note {
		margin: 12px 8px;
		font-size: 12px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 4px 4px 4px;
	}

	.button.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
