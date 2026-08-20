<script lang="ts">
	import { mx, openRoom, searchLocal, type SearchHit } from "$lib/matrix/client.svelte";
	import { formatTimestamp } from "$lib/matrix/views";

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	let term = $state("");
	let thisRoomOnly = $state(false);

	const hits = $derived<SearchHit[]>(
		term.trim().length >= 2
			? searchLocal(term, thisRoomOnly ? (mx.activeRoomId ?? undefined) : undefined)
			: []
	);

	function open(hit: SearchHit) {
		openRoom(hit.roomId);
		onclose();
	}
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onclose()} />

<div class="scrim" role="presentation" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
		<div class="top">
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={term} placeholder="Search your messages" autofocus spellcheck="false" />
			<label class="scope">
				<input type="checkbox" bind:checked={thisRoomOnly} disabled={!mx.activeRoomId} />
				<span>This room only</span>
			</label>
		</div>

		<div class="results">
			{#each hits as hit (hit.eventId)}
				<button class="hit" onclick={() => open(hit)}>
					<span class="hit-top">
						<span class="hit-room">{hit.roomName}</span>
						<span class="hit-when">{formatTimestamp(hit.timestamp)}</span>
					</span>
					<span class="hit-body"><b>{hit.sender}:</b> {hit.body}</span>
				</button>
			{:else}
				<p class="note">
					{term.trim().length >= 2
						? "Nothing found in what's loaded."
						: "Type at least two characters."}
				</p>
			{/each}
		</div>

		<p class="footnote">
			Searches messages this device has already loaded, including encrypted
			ones. The server can't search encrypted rooms at all — it only holds
			ciphertext — so this reaches further into private conversations and less
			far back through history. Scroll a room to load more of it.
		</p>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.6);
		display: grid;
		place-items: start center;
		padding: 60px 24px 24px;
		z-index: 79;
	}

	.panel {
		width: min(620px, 100%);
		max-height: 76vh;
		display: flex;
		flex-direction: column;
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.4);
		overflow: hidden;
	}

	.top {
		flex: none;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-bottom: var(--border-width, 1px) solid var(--border);
	}

	.scope {
		flex: none;
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--text-faint);
		white-space: nowrap;
	}

	.scope input {
		width: auto;
	}

	.results {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
		min-height: 0;
	}

	.hit {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 8px 10px;
		border-radius: var(--radius);
		text-align: left;
		color: var(--text-dim);
	}

	.hit:hover {
		background: var(--raised);
		color: var(--text);
	}

	.hit-top {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 11px;
	}

	.hit-room {
		color: var(--accent);
		font-weight: var(--bold-weight, 700);
	}

	.hit-when {
		color: var(--text-faint);
	}

	.hit-body {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.note {
		margin: 16px 12px;
		font-size: 12px;
		color: var(--text-faint);
	}

	.footnote {
		flex: none;
		margin: 0;
		padding: 9px 14px;
		border-top: var(--border-width, 1px) solid var(--border);
		font-size: 10px;
		line-height: 1.5;
		color: var(--text-faint);
	}
</style>
