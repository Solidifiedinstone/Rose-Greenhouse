<script lang="ts" module>
	export interface MenuItem {
		/** Absent only on a separator. */
		label?: string;
		/** Shown under the label, for anything whose consequences aren't obvious. */
		detail?: string;
		danger?: boolean;
		disabled?: boolean;
		/** A divider is an item with no action. */
		separator?: boolean;
		run?: () => void;
	}
</script>

<script lang="ts">
	interface Props {
		x: number;
		y: number;
		items: MenuItem[];
		onclose: () => void;
	}

	let { x, y, items, onclose }: Props = $props();

	let menu: HTMLDivElement | null = $state(null);

	/**
	 * Keep the menu on screen.
	 *
	 * Right-clicking the last room in a long list is exactly where a menu
	 * opens past the bottom edge and becomes unusable, so it flips rather
	 * than overflows.
	 */
	let measured = $state({ width: 0, height: 0 });
	$effect(() => {
		if (!menu) return;
		const box = menu.getBoundingClientRect();
		measured = { width: box.width, height: box.height };
	});

	const position = $derived({
		left: Math.max(8, Math.min(x, window.innerWidth - measured.width - 8)),
		top: Math.max(8, Math.min(y, window.innerHeight - measured.height - 8))
	});

	function choose(item: MenuItem) {
		if (item.disabled || item.separator || !item.run) return;
		onclose();
		item.run();
	}
</script>

<svelte:window
	onkeydown={(event) => event.key === "Escape" && onclose()}
	onresize={onclose}
/>

<!--
	The backdrop closes the menu on any click, including a right-click
	elsewhere — a context menu that survives the next click is a context menu
	you have to hunt for a way out of.
-->
<div
	class="backdrop"
	role="presentation"
	onclick={onclose}
	oncontextmenu={(event) => {
		event.preventDefault();
		onclose();
	}}
></div>

<div
	class="menu"
	bind:this={menu}
	style:left="{position.left}px"
	style:top="{position.top}px"
	role="menu"
	tabindex="-1"
>
	{#each items as item, index (index)}
		{#if item.separator}
			<div class="separator"></div>
		{:else}
			<button
				class="item"
				class:danger={item.danger}
				disabled={item.disabled}
				role="menuitem"
				onclick={() => choose(item)}
			>
				<span class="label">{item.label}</span>
				{#if item.detail}
					<span class="detail">{item.detail}</span>
				{/if}
			</button>
		{/if}
	{/each}
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
	}

	.menu {
		position: fixed;
		z-index: 61;
		min-width: 220px;
		max-width: 300px;
		padding: 6px;
		background: var(--overlay);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
	}

	.item {
		display: flex;
		flex-direction: column;
		gap: 1px;
		width: 100%;
		padding: 7px 10px;
		border-radius: calc(var(--radius) * 0.7);
		text-align: left;
		color: var(--text);
	}

	.item:hover:not(:disabled) {
		background: var(--raised);
	}

	.item:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.item.danger .label {
		color: var(--danger);
	}

	.label {
		font-size: 13px;
		font-weight: 600;
	}

	.detail {
		font-size: 11px;
		color: var(--text-faint);
		line-height: 1.35;
	}

	.separator {
		height: 1px;
		margin: 5px 6px;
		background: var(--border);
	}
</style>
