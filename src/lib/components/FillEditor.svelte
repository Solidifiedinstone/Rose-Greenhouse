<script lang="ts">
	import { FILL_KINDS, type Fill, type FillKind } from "$lib/matrix/profile.svelte";

	interface Props {
		label: string;
		fill: Fill;
		/** Called with the new fill; the parent owns the state. */
		onchange: (fill: Fill) => void;
		/** Shown under the label to say what this element is. */
		hint?: string;
	}

	let { label, fill, onchange, hint = "" }: Props = $props();

	// "none" has no colours to pick, and a gradient is the only kind with a
	// second colour and an angle — showing them otherwise implies they do
	// something.
	const hasColour = $derived(fill.kind !== "none");
	const hasSecond = $derived(fill.kind === "gradient");

	function patch(part: Partial<Fill>) {
		onchange({ ...fill, ...part });
	}
</script>

<div class="fill">
	<div class="row">
		<span class="label">
			{label}
			{#if hint}<small>{hint}</small>{/if}
		</span>
		<select
			value={fill.kind}
			onchange={(event) => patch({ kind: event.currentTarget.value as FillKind })}
		>
			{#each FILL_KINDS as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
	</div>

	{#if hasColour}
		<div class="row colours">
			<label class="swatch">
				<input
					type="color"
					value={fill.from || "#e86f9a"}
					oninput={(event) => patch({ from: event.currentTarget.value })}
				/>
				<span>{hasSecond ? "From" : "Colour"}</span>
			</label>

			{#if hasSecond}
				<label class="swatch">
					<input
						type="color"
						value={fill.to || fill.from || "#7a5bb0"}
						oninput={(event) => patch({ to: event.currentTarget.value })}
					/>
					<span>To</span>
				</label>
				<label class="angle">
					<span>{fill.angle}°</span>
					<input
						type="range"
						min="0"
						max="360"
						step="5"
						value={fill.angle}
						oninput={(event) => patch({ angle: Number(event.currentTarget.value) })}
					/>
				</label>
			{/if}
		</div>
	{/if}
</div>

<style>
	.fill {
		margin-bottom: 12px;
		padding-bottom: 10px;
		border-bottom: var(--border-width, 1px) solid var(--border);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.label {
		flex: 1;
		display: flex;
		flex-direction: column;
		font-size: 12px;
		color: var(--text-dim);
		line-height: 1.3;
	}

	.label small {
		font-size: 10px;
		color: var(--text-faint);
	}

	select {
		width: 140px;
		background: var(--raised);
		color: var(--text);
		border: var(--border-width, 1px) solid var(--border);
		border-radius: var(--radius);
		padding: 6px 8px;
		font: inherit;
		font-size: 12px;
	}

	.colours {
		margin-top: 8px;
		flex-wrap: wrap;
	}

	.swatch {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--text-faint);
	}

	.swatch input {
		width: 26px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: none;
		cursor: pointer;
	}

	.angle {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		color: var(--text-faint);
	}

	.angle input {
		flex: 1;
		padding: 0;
		accent-color: var(--accent);
	}

	.angle span {
		min-width: 34px;
	}
</style>
