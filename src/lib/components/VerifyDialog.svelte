<script lang="ts">
	import { getClient } from "$lib/matrix/client.svelte";
	import {
		accept,
		cancel,
		confirmMatch,
		refreshStatus,
		reportMismatch,
		reset,
		start,
		verify
	} from "$lib/matrix/verification.svelte";

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	function close() {
		if (verify.stage !== "done") void cancel();
		else reset();
		onclose();
	}

	async function finish() {
		await refreshStatus(getClient());
		reset();
		onclose();
	}
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && close()} />

<div class="scrim" role="presentation" onclick={close}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
		{#if verify.stage === "done"}
			<h2>This device is verified</h2>
			<p>
				Your other session vouched for this one. Room keys will now be shared
				with it, so encrypted history becomes readable — older messages may
				take a moment to catch up.
			</p>
			<div class="actions">
				<button class="button primary" onclick={finish}>Done</button>
			</div>
		{:else if verify.stage === "comparing"}
			<h2>Do these match?</h2>
			<p>
				Compare with your other session
				{#if verify.otherDeviceId}(<code>{verify.otherDeviceId}</code>){/if}.
				They should be in the same order.
			</p>
			<div class="emoji">
				{#each verify.emoji as [glyph, name] (name + glyph)}
					<div class="tile">
						<span class="glyph">{glyph}</span>
						<span class="name">{name}</span>
					</div>
				{/each}
			</div>
			<div class="actions">
				<button class="button danger" onclick={reportMismatch}>They don't match</button>
				<button class="button primary" onclick={confirmMatch}>They match</button>
			</div>
		{:else if verify.stage === "waiting"}
			<h2>Waiting for the other session</h2>
			<p>Confirm the same emoji there to finish.</p>
			<div class="actions">
				<button class="button" onclick={close}>Cancel</button>
			</div>
		{:else if verify.stage === "requesting" || verify.stage === "ready"}
			<h2>{verify.incoming ? "Verification requested" : "Waiting to be accepted"}</h2>
			{#if verify.incoming}
				<p>
					Another of your sessions
					{#if verify.otherDeviceId}(<code>{verify.otherDeviceId}</code>){/if}
					wants to verify. Accept, then compare the emoji.
				</p>
				<div class="actions">
					<button class="button" onclick={close}>Ignore</button>
					<button class="button primary" onclick={accept}>Accept</button>
				</div>
			{:else}
				<p>
					Open another signed-in session — Element on your phone, or another
					client — and accept the verification request there.
				</p>
				<div class="actions">
					<button class="button" onclick={close}>Cancel</button>
				</div>
			{/if}
		{:else if verify.stage === "cancelled" || verify.stage === "error"}
			<h2>{verify.stage === "error" ? "Verification failed" : "Verification stopped"}</h2>
			<p class="bad">{verify.error || "It was cancelled."}</p>
			{#if verify.trace.length}
				<details class="trace">
					<summary>What happened</summary>
					<ol>
						{#each verify.trace as line, index (index)}
							<li>{line}</li>
						{/each}
					</ol>
					<p class="hint">
						Send this if it keeps failing — it says whether the exchange was
						cancelled, timed out, or went out of order.
					</p>
				</details>
			{/if}
			<div class="actions">
				<button class="button" onclick={close}>Close</button>
				<button class="button primary" onclick={() => start(getClient())}>Try again</button>
			</div>
		{:else}
			<h2>Verify this device</h2>
			<p>
				This session has its own encryption key that none of your other
				sessions have met, so the server won't give it the keys to your
				encrypted rooms. That's why messages sent before you signed in here
				show as <em>encrypted message</em>.
			</p>
			{#if verify.otherDevices === 0}
				<p class="bad">
					I can't see another signed-in session for your account, and
					verification needs one to compare against. If you do have another
					client open, start it anyway — the request will simply wait for it.
					Restoring from a recovery key instead isn't built yet.
				</p>
				<div class="actions">
					<button class="button" onclick={close}>Close</button>
					<button class="button primary" onclick={() => start(getClient())}>
						Start anyway
					</button>
				</div>
			{:else}
				<p class="dim">
					You'll compare seven emoji against another session. Nothing secret is
					sent; matching emoji prove nobody is sitting in the middle.
				</p>
				<div class="actions">
					<button class="button" onclick={close}>Not now</button>
					<button class="button primary" onclick={() => start(getClient())}>
						Start verification
					</button>
				</div>
			{/if}
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
		z-index: 80;
	}

	.panel {
		width: min(480px, 100%);
		padding: 24px 26px 20px;
		background: var(--overlay);
		border: 1px solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.4);
	}

	h2 {
		margin: 0 0 10px;
		font-size: 18px;
	}

	p {
		margin: 0 0 14px;
		font-size: 13px;
		color: var(--text-dim);
		line-height: 1.55;
	}

	p.bad {
		color: var(--warning);
	}

	.emoji {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
		margin: 4px 0 18px;
	}

	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 10px 4px;
		background: var(--raised);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.glyph {
		font-size: 26px;
		line-height: 1.1;
	}

	.name {
		font-size: 10px;
		color: var(--text-faint);
		text-align: center;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.trace {
		margin-bottom: 14px;
		font-size: 11px;
		color: var(--text-faint);
	}

	.trace summary {
		cursor: pointer;
		color: var(--text-dim);
	}

	.trace ol {
		margin: 8px 0 6px;
		padding-left: 20px;
		font-family: var(--mono-family);
		line-height: 1.6;
	}

	.trace .hint {
		margin: 0;
		font-size: 10px;
		color: var(--text-faint);
	}

	.button.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
