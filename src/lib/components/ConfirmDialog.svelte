<script lang="ts">
	interface Props {
		title: string;
		body: string;
		/** What the confirming button says. "Yes" tells nobody anything. */
		confirmLabel: string;
		danger?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let { title, body, confirmLabel, danger = false, onconfirm, oncancel }: Props = $props();
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && oncancel()} />

<div class="scrim" role="presentation" onclick={oncancel}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
		<h2>{title}</h2>
		<p>{body}</p>
		<div class="actions">
			<button class="button" onclick={oncancel}>Cancel</button>
			<button class="button" class:danger class:primary={!danger} onclick={onconfirm}>
				{confirmLabel}
			</button>
		</div>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.55);
		display: grid;
		place-items: center;
		padding: 24px;
		z-index: 70;
	}

	.panel {
		width: min(420px, 100%);
		padding: 22px 24px 18px;
		background: var(--overlay);
		border: 1px solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.4);
	}

	h2 {
		margin: 0 0 8px;
		font-size: 17px;
	}

	p {
		margin: 0 0 18px;
		font-size: 13px;
		color: var(--text-dim);
		line-height: 1.5;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.button.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
