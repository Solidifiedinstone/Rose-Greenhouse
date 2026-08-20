<script lang="ts" module>
	/**
	 * A short list, not an emoji keyboard.
	 *
	 * Reactions are overwhelmingly a handful of the same glyphs, and a full
	 * picker is a large dependency plus a search box for something that is
	 * meant to take one click. The free-text box covers the rest.
	 */
	export const QUICK_REACTIONS = [
		"👍", "👎", "❤️", "😂", "😮", "😢", "🎉", "🔥",
		"👀", "✅", "❌", "🙏", "💯", "🤔", "😅", "🫡"
	];
</script>

<script lang="ts">
	interface Props {
		x: number;
		y: number;
		onpick: (emoji: string) => void;
		onclose: () => void;
	}

	let { x, y, onpick, onclose }: Props = $props();

	let custom = $state("");
	let panel: HTMLDivElement | null = $state(null);
	let measured = $state({ width: 232, height: 190 });

	$effect(() => {
		if (!panel) return;
		const box = panel.getBoundingClientRect();
		measured = { width: box.width, height: box.height };
	});

	const position = $derived({
		left: Math.max(8, Math.min(x, window.innerWidth - measured.width - 8)),
		top: Math.max(8, Math.min(y, window.innerHeight - measured.height - 8))
	});

	function submit() {
		const value = custom.trim();
		if (!value) return;
		// One grapheme is plenty — a reaction key is meant to be a glyph, and
		// a whole sentence as a "reaction" renders as a pill nobody can read.
		onpick([...value][0]);
	}
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onclose()} onresize={onclose} />

<div class="backdrop" role="presentation" onclick={onclose}></div>

<div class="panel" bind:this={panel} style:left="{position.left}px" style:top="{position.top}px">
	<div class="grid">
		{#each QUICK_REACTIONS as emoji (emoji)}
			<button class="emoji" onclick={() => onpick(emoji)} title={emoji}>{emoji}</button>
		{/each}
	</div>
	<form
		class="custom"
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<input bind:value={custom} placeholder="Or paste any emoji" maxlength="8" />
		<button class="button" type="submit" disabled={!custom.trim()}>Add</button>
	</form>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 66;
	}

	.panel {
		position: fixed;
		z-index: 67;
		width: 232px;
		padding: 8px;
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border-strong);
		border-radius: var(--radius);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 2px;
	}

	.emoji {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		font-size: 17px;
		border-radius: 6px;
	}

	.emoji:hover {
		background: var(--raised);
	}

	.custom {
		display: flex;
		gap: 6px;
		margin-top: 8px;
		padding-top: 8px;
		border-top: var(--border-width, 1px) solid var(--border);
	}

	.custom input {
		font-size: 12px;
	}

	.custom .button {
		min-height: 30px;
		font-size: 12px;
	}
</style>
