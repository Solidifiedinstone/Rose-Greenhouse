<script lang="ts">
	import { editHistory } from "$lib/matrix/client.svelte";
	import { formatTimestamp } from "$lib/matrix/views";

	interface Props {
		eventId: string;
		onclose: () => void;
	}

	let { eventId, onclose }: Props = $props();

	const versions = $derived(editHistory(eventId));
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onclose()} />

<div class="scrim" role="presentation" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
		<h2>Edit history</h2>
		<div class="list">
			{#each versions as version, index (version.timestamp)}
				<div class="version" class:current={index === 0}>
					<span class="when">
						{formatTimestamp(version.timestamp)}
						{#if index === 0}<em>current</em>
						{:else if index === versions.length - 1}<em>original</em>{/if}
					</span>
					<p class="text selectable">{version.body}</p>
				</div>
			{:else}
				<p class="note">This message hasn't been edited.</p>
			{/each}
		</div>
		<p class="footnote">
			Readable because a Matrix edit is a new event that replaces the old one —
			every version is still on the server, not kept in a log here.
		</p>
		<div class="actions">
			<button class="button primary" onclick={onclose}>Close</button>
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
		z-index: 78;
	}

	.panel {
		width: min(460px, 100%);
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.4);
		padding: 18px 20px 14px;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 16px;
	}

	.list {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.version {
		padding: 8px 10px;
		border-radius: var(--radius);
		background: var(--raised);
		border-left: 2px solid var(--border);
	}

	.version.current {
		border-left-color: var(--accent);
	}

	.when {
		display: block;
		font-size: 10px;
		color: var(--text-faint);
	}

	.when em {
		font-style: normal;
		color: var(--accent);
		margin-left: 5px;
	}

	.text {
		margin: 3px 0 0;
		font-size: 13px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.note {
		font-size: 12px;
		color: var(--text-faint);
	}

	.footnote {
		flex: none;
		margin: 12px 0 8px;
		font-size: 10px;
		line-height: 1.5;
		color: var(--text-faint);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
	}
</style>
