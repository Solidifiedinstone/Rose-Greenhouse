<script lang="ts">
	import { getClient } from "$lib/matrix/client.svelte";
	import {
		PRESENCE_COLOURS,
		PRESENCE_HINTS,
		PRESENCE_LABELS,
		profile,
		savePresence,
		type Presence
	} from "$lib/matrix/profile.svelte";

	interface Props {
		/** Where the rail button is, so the menu opens beside it. */
		x: number;
		y: number;
		onclose: () => void;
		onview: () => void;
	}

	let { x, y, onclose, onview }: Props = $props();

	let menu: HTMLDivElement | null = $state(null);
	let measured = $state({ width: 240, height: 260 });
	let message = $state(profile.statusMessage);
	let busy = $state(false);

	$effect(() => {
		if (!menu) return;
		const box = menu.getBoundingClientRect();
		measured = { width: box.width, height: box.height };
	});

	// Kept on screen: the rail button sits near the top-left, but a tall menu
	// from a short window would still run off the bottom.
	const position = $derived({
		left: Math.min(x, window.innerWidth - measured.width - 8),
		top: Math.max(8, Math.min(y, window.innerHeight - measured.height - 8))
	});

	/**
	 * Presence applies on click, unlike the profile editor's Save.
	 *
	 * That difference is deliberate: this is one explicit click on the exact
	 * thing being changed, and it's trivially reversible. Staging it behind a
	 * Save button would make a two-second toggle a three-step task.
	 */
	async function choose(presence: Presence) {
		const client = getClient();
		if (!client || busy) return;
		busy = true;
		try {
			await savePresence(client, presence, message);
		} finally {
			busy = false;
		}
	}

	async function applyMessage() {
		const client = getClient();
		if (!client || message === profile.statusMessage) return;
		busy = true;
		try {
			await savePresence(client, profile.presence, message);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onclose()} onresize={onclose} />

<div class="backdrop" role="presentation" onclick={onclose}></div>

<div
	class="menu"
	bind:this={menu}
	style:left="{position.left}px"
	style:top="{position.top}px"
	role="menu"
	tabindex="-1"
>
	<div class="head">
		<strong>{profile.displayName || "You"}</strong>
		<code>{profile.extrasShared ? "public profile" : "private extras"}</code>
	</div>

	<div class="options">
		{#each Object.entries(PRESENCE_LABELS) as [value, label] (value)}
			<button
				class="option"
				class:active={profile.presence === value}
				disabled={busy}
				onclick={() => choose(value as Presence)}
			>
				<i class="dot" style:background={PRESENCE_COLOURS[value as Presence]}></i>
				<span class="option-text">
					{label}
					{#if PRESENCE_HINTS[value as Presence]}
						<small>{PRESENCE_HINTS[value as Presence]}</small>
					{/if}
				</span>
				{#if profile.presence === value}<span class="tick">✓</span>{/if}
			</button>
		{/each}
	</div>

	<label class="message">
		<span>Status message</span>
		<input
			bind:value={message}
			maxlength="120"
			placeholder="What you're up to"
			onblur={applyMessage}
			onkeydown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					void applyMessage();
				}
			}}
		/>
	</label>

	<div class="foot">
		<button class="button view" onclick={onview}>View profile</button>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 74;
	}

	.menu {
		position: fixed;
		z-index: 75;
		width: 244px;
		padding: 8px;
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border-strong);
		border-radius: var(--radius);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
	}

	.head {
		padding: 4px 8px 8px;
		border-bottom: var(--border-width, 1px) solid var(--border);
		margin-bottom: 6px;
	}

	.head strong {
		display: block;
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.head code {
		font-size: 10px;
		background: none;
		padding: 0;
		color: var(--text-faint);
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 7px 8px;
		border-radius: calc(var(--radius) * 0.7);
		font-size: 13px;
		color: var(--text);
		text-align: left;
	}

	.option:hover:not(:disabled) {
		background: var(--raised);
	}

	.option.active {
		background: var(--raised);
	}

	.dot {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 50%;
	}

	.option-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}

	.option-text small {
		font-size: 10px;
		color: var(--text-faint);
	}

	.tick {
		color: var(--accent);
		font-size: 11px;
	}

	.message {
		display: block;
		padding: 8px 8px 4px;
		font-size: 10px;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.message input {
		margin-top: 4px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
	}

	.foot {
		padding: 6px 4px 2px;
		border-top: var(--border-width, 1px) solid var(--border);
		margin-top: 6px;
	}

	.view {
		width: 100%;
	}
</style>
