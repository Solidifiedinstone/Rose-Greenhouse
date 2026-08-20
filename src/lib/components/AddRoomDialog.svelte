<script lang="ts">
	import Avatar from "./Avatar.svelte";
	import {
		createRoom,
		joinRoom,
		mx,
		openRoom,
		searchDirectory,
		type DirectoryRoom
	} from "$lib/matrix/client.svelte";

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	type Tab = "create" | "join" | "browse";
	let tab = $state<Tab>("create");

	// ── Create ───────────────────────────────────────────────
	let name = $state("");
	let topic = $state("");
	let isPublic = $state(false);
	let alias = $state("");
	let encrypted = $state(true);
	let inviteText = $state("");

	const invites = $derived(
		inviteText
			.split(/[\s,]+/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.startsWith("@") && entry.includes(":"))
	);

	async function create() {
		const id = await createRoom({ name, topic, isPublic, alias, encrypted, invite: invites });
		if (id) onclose();
	}

	// ── Join ─────────────────────────────────────────────────
	let target = $state("");

	async function join() {
		const id = await joinRoom(target);
		if (id) onclose();
	}

	// ── Browse ───────────────────────────────────────────────
	let query = $state("");
	let server = $state("");
	let results: DirectoryRoom[] = $state([]);
	let searching = $state(false);
	let searched = $state(false);

	async function search() {
		searching = true;
		try {
			results = await searchDirectory(query, server);
			searched = true;
		} finally {
			searching = false;
		}
	}

	async function joinFromDirectory(room: DirectoryRoom) {
		if (room.joined) {
			openRoom(room.roomId);
			onclose();
			return;
		}
		// Prefer the alias: joining by id alone fails when your server has no
		// route to the room, whereas an alias tells it which server to ask.
		const id = await joinRoom(room.alias || room.roomId);
		if (id) onclose();
	}
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onclose()} />

<div class="scrim" role="presentation" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
		<div class="tabs">
			<button class="tab" class:on={tab === "create"} onclick={() => (tab = "create")}>
				New room
			</button>
			<button class="tab" class:on={tab === "join"} onclick={() => (tab = "join")}>
				Join by address
			</button>
			<button class="tab" class:on={tab === "browse"} onclick={() => (tab = "browse")}>
				Browse
			</button>
		</div>

		<div class="body">
			{#if tab === "create"}
				<label class="field">
					<span>Name</span>
					<input bind:value={name} placeholder="Kitchen table" maxlength="80" />
				</label>
				<label class="field">
					<span>Topic</span>
					<input bind:value={topic} placeholder="Optional" maxlength="200" />
				</label>

				<label class="check">
					<input type="checkbox" bind:checked={isPublic} />
					<span>Public — anyone can find and join it</span>
				</label>

				{#if isPublic}
					<label class="field">
						<span>Address</span>
						<span class="alias">
							<span class="hash">#</span>
							<input bind:value={alias} placeholder="kitchen-table" maxlength="60" />
							<span class="server">:{mx.userId.split(":").pop()}</span>
						</span>
					</label>
				{/if}

				<label class="check">
					<input type="checkbox" bind:checked={encrypted} disabled={isPublic} />
					<span>
						End-to-end encrypted
						{#if isPublic}<small>— not offered for public rooms</small>{/if}
					</span>
				</label>
				<p class="note">
					Encryption can only be set when a room is created. It cannot be turned
					on later for messages already sent, so this is the one choice here
					you can't revisit.
				</p>

				<label class="field top">
					<span>Invite</span>
					<textarea
						bind:value={inviteText}
						rows="2"
						placeholder="@someone:matrix.org  @another:example.org"
					></textarea>
				</label>
				{#if inviteText.trim() && !invites.length}
					<p class="note warn">
						No full Matrix IDs found — they look like <code>@name:server</code>.
					</p>
				{:else if invites.length}
					<p class="note">Inviting {invites.length}.</p>
				{/if}

				<div class="actions">
					<button class="button" onclick={onclose}>Cancel</button>
					<button class="button primary" onclick={create} disabled={mx.busy || !name.trim()}>
						{mx.busy ? "Creating…" : "Create room"}
					</button>
				</div>
			{:else if tab === "join"}
				<label class="field">
					<span>Address</span>
					<input
						bind:value={target}
						placeholder="#room:server.org, !id:server.org, or a matrix.to link"
						onkeydown={(event) => event.key === "Enter" && join()}
					/>
				</label>
				<p class="note">
					A matrix.to link pasted from anywhere works — the room part is pulled
					out of it.
				</p>
				<div class="actions">
					<button class="button" onclick={onclose}>Cancel</button>
					<button class="button primary" onclick={join} disabled={mx.busy || !target.trim()}>
						{mx.busy ? "Joining…" : "Join"}
					</button>
				</div>
			{:else}
				<div class="search-row">
					<input
						bind:value={query}
						placeholder="Search public rooms"
						onkeydown={(event) => event.key === "Enter" && search()}
					/>
					<input class="server-input" bind:value={server} placeholder="server (optional)" />
					<button class="button" onclick={search} disabled={searching}>
						{searching ? "…" : "Search"}
					</button>
				</div>

				<div class="results">
					{#each results as room (room.roomId)}
						<button class="result" onclick={() => joinFromDirectory(room)}>
							<Avatar id={room.roomId} name={room.name} mxc={room.avatar} size={32} square />
							<span class="result-text">
								<span class="result-name">{room.name}</span>
								{#if room.topic}<span class="result-topic">{room.topic}</span>{/if}
							</span>
							<span class="members">{room.members}</span>
							<span class="go">{room.joined ? "Open" : "Join"}</span>
						</button>
					{:else}
						<p class="note">
							{searched
								? "Nothing matched. Try another server — every homeserver keeps its own list."
								: "Search to see what this homeserver publishes."}
						</p>
					{/each}
				</div>
			{/if}

			{#if mx.error}<p class="error-text">{mx.error}</p>{/if}
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
		z-index: 77;
	}

	.panel {
		width: min(520px, 100%);
		max-height: 86vh;
		display: flex;
		flex-direction: column;
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.4);
		overflow: hidden;
	}

	.tabs {
		display: flex;
		flex: none;
		border-bottom: var(--border-width, 1px) solid var(--border);
	}

	.tab {
		flex: 1;
		padding: 11px 8px;
		font-size: 13px;
		color: var(--text-dim);
		border-bottom: 2px solid transparent;
	}

	.tab.on {
		color: var(--text);
		border-bottom-color: var(--accent);
	}

	.body {
		flex: 1;
		overflow-y: auto;
		padding: 16px 20px 18px;
	}

	.field {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 10px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.field.top {
		align-items: flex-start;
	}

	.field > span:first-child {
		min-width: 70px;
	}

	.alias {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.hash,
	.server {
		color: var(--text-faint);
		font-family: var(--mono-family);
		font-size: 12px;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 10px 0;
		font-size: 13px;
	}

	.check input {
		width: auto;
	}

	.check small {
		color: var(--text-faint);
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

	.search-row {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
	}

	.server-input {
		max-width: 150px;
	}

	.results {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.result {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 8px;
		border-radius: var(--radius);
		text-align: left;
		color: var(--text);
	}

	.result:hover {
		background: var(--raised);
	}

	.result-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.result-name {
		font-size: 13px;
		font-weight: var(--bold-weight, 700);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-topic {
		font-size: 11px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.members {
		flex: none;
		font-size: 11px;
		color: var(--text-faint);
	}

	.go {
		flex: none;
		font-size: 11px;
		color: var(--accent);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 14px;
	}
</style>
