<script lang="ts">
	import {
		activeTheme,
		allThemes,
		beginEdit,
		borrowColours,
		borrowShape,
		discardDraft,
		removeCustomTheme,
		saveDraft,
		setDraftName,
		setScheme,
		setShape,
		setGradient,
		setTheme,
		setToken,
		themeState
	} from "$lib/theme/theme.svelte";
	import {
		DENSITY_PRESETS,
		MONO_FONTS,
		SHAPE_LIMITS,
		SHAPE_PRESETS,
		UI_FONTS
	} from "$lib/theme/shape";
	import {
		GRADIENT_TARGETS,
		TOKEN_GROUPS,
		type GradientTarget,
		type TokenName
	} from "$lib/theme/tokens";

	let error = $state("");
	const theme = $derived(activeTheme());
	const draft = $derived(themeState.draft);

	/**
	 * `<input type="color">` only accepts `#rrggbb`. A theme may legitimately
	 * hold rgb()/hsl()/8-digit hex, so the swatch shows the nearest thing it
	 * can and the text field beside it stays authoritative.
	 */
	function asHex(value: string): string {
		const text = value.trim();
		if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
		if (/^#[0-9a-fA-F]{3}$/.test(text)) {
			return "#" + text.slice(1).split("").map((c) => c + c).join("");
		}
		if (/^#[0-9a-fA-F]{8}$/.test(text)) return text.slice(0, 7);
		return "#000000";
	}

	const numericKeys = Object.keys(SHAPE_LIMITS) as (keyof typeof SHAPE_LIMITS)[];

	function save() {
		const problem = saveDraft();
		error = problem ?? "";
	}
</script>

<section>
	<h3>Theme</h3>

	{#if !draft}
		<div class="grid">
			{#each allThemes() as entry (entry.id)}
				<button
					class="swatch"
					class:selected={entry.id === themeState.activeId}
					onclick={() => setTheme(entry.id)}
					title={entry.name}
				>
					<span class="chips">
						<i style:background={entry.tokens.sidebar}></i>
						<i style:background={entry.tokens.surface}></i>
						<i style:background={entry.tokens.accent}></i>
						<i style:background={entry.tokens.text}></i>
					</span>
					<span class="label">{entry.name}</span>
					{#if !entry.builtin}
						<span
							class="remove"
							role="button"
							tabindex="0"
							title="Delete this theme"
							onclick={(event) => {
								event.stopPropagation();
								removeCustomTheme(entry.id);
							}}
							onkeydown={(event) => event.key === "Enter" && removeCustomTheme(entry.id)}
						>×</span>
					{/if}
				</button>
			{/each}
		</div>
		<div class="row">
			<button class="button primary" onclick={beginEdit}>
				Customise this theme
			</button>
			<span class="dim tiny">
				Editing starts from {theme.name} and saves as a copy — built-ins are
				never overwritten.
			</span>
		</div>
	{:else}
		<div class="editing-head">
			<input
				class="name"
				value={draft.name}
				oninput={(event) => setDraftName(event.currentTarget.value)}
				placeholder="Theme name"
			/>
			<button class="button" onclick={discardDraft}>Discard</button>
			<button class="button primary" onclick={save}>Save</button>
		</div>
		{#if error}<p class="error-text">{error}</p>{/if}
		<p class="dim tiny">Changes apply as you make them, so you're seeing the real thing.</p>

		<h4>Shape</h4>
		<div class="chip-row">
			{#each SHAPE_PRESETS as preset (preset.id)}
				<button class="chip" onclick={() => setShape(preset.shape)} title={preset.hint}>
					{preset.name}
				</button>
			{/each}
		</div>

		<h4>Density</h4>
		<div class="chip-row">
			{#each DENSITY_PRESETS as preset (preset.id)}
				<button class="chip" onclick={() => setShape(preset.shape)} title={preset.hint}>
					{preset.name}
				</button>
			{/each}
		</div>

		<h4>Fonts</h4>
		<label class="field">
			<span>Interface</span>
			<select
				value={draft.shape.fontFamily}
				onchange={(event) => setShape({ fontFamily: event.currentTarget.value })}
			>
				{#each UI_FONTS as font (font.label)}
					<option value={font.value}>{font.label}</option>
				{/each}
				{#if !UI_FONTS.some((f) => f.value === draft.shape.fontFamily)}
					<option value={draft.shape.fontFamily}>Custom</option>
				{/if}
			</select>
		</label>
		<label class="field">
			<span>Code</span>
			<select
				value={draft.shape.monoFamily}
				onchange={(event) => setShape({ monoFamily: event.currentTarget.value })}
			>
				{#each MONO_FONTS as font (font.label)}
					<option value={font.value}>{font.label}</option>
				{/each}
				{#if !MONO_FONTS.some((f) => f.value === draft.shape.monoFamily)}
					<option value={draft.shape.monoFamily}>Custom</option>
				{/if}
			</select>
		</label>

		<h4>Sizes</h4>
		{#each numericKeys as key (key)}
			{@const limit = SHAPE_LIMITS[key]}
			<label class="slider">
				<span class="slider-label">{limit.label}</span>
				<input
					type="range"
					min={limit.min}
					max={limit.max}
					step={limit.step}
					value={draft.shape[key]}
					oninput={(event) => setShape({ [key]: Number(event.currentTarget.value) } as never)}
				/>
				<span class="slider-value">{draft.shape[key]}{limit.unit}</span>
			</label>
		{/each}

		<h4>Behaviour</h4>
		<label class="field">
			<span>Message style</span>
			<select
				value={draft.shape.bubbles ? "bubbles" : "plain"}
				onchange={(event) => setShape({ bubbles: event.currentTarget.value === "bubbles" })}
			>
				<option value="plain">Plain</option>
				<option value="bubbles">Bubbles</option>
			</select>
		</label>
		<label class="field">
			<span>Timestamps</span>
			<select
				value={draft.shape.clock}
				onchange={(event) =>
					setShape({ clock: event.currentTarget.value as "24h" | "12h" | "off" })}
			>
				<option value="24h">24-hour</option>
				<option value="12h">12-hour</option>
				<option value="off">Hidden</option>
			</select>
		</label>
		<label class="field">
			<span>Sidebar side</span>
			<select
				value={draft.shape.sidebarSide}
				onchange={(event) =>
					setShape({ sidebarSide: event.currentTarget.value as "left" | "right" })}
			>
				<option value="left">Left</option>
				<option value="right">Right</option>
			</select>
		</label>
		<label class="check">
			<input
				type="checkbox"
				checked={draft.shape.roomPreviews}
				onchange={(event) => setShape({ roomPreviews: event.currentTarget.checked })}
			/>
			<span>Show last message under each room</span>
		</label>
		<label class="check">
			<input
				type="checkbox"
				checked={draft.shape.animations}
				onchange={(event) => setShape({ animations: event.currentTarget.checked })}
			/>
			<span>Animations <small>— off is genuinely faster on old hardware</small></span>
		</label>

		<h4>Gradients</h4>
		<p class="dim tiny">
			Each surface can carry a gradient instead of a flat colour. Leave one off
			and it uses the plain colour below.
		</p>
		{#each GRADIENT_TARGETS as target (target)}
			{@const gradient = draft.gradients?.[target as GradientTarget] ?? null}
			<div class="gradient">
				<label class="check">
					<input
						type="checkbox"
						checked={gradient !== null}
						onchange={(event) =>
							setGradient(
								target as GradientTarget,
								event.currentTarget.checked
									? {
											from: draft.tokens[target as TokenName] ?? "#000000",
											to: draft.tokens.accent,
											angle: 160
										}
									: null
							)}
					/>
					<span>{target}</span>
				</label>
				{#if gradient}
					<span class="grad-controls">
						<input
							type="color"
							value={gradient.from}
							oninput={(event) =>
								setGradient(target as GradientTarget, {
									...gradient,
									from: event.currentTarget.value
								})}
						/>
						<input
							type="color"
							value={gradient.to}
							oninput={(event) =>
								setGradient(target as GradientTarget, {
									...gradient,
									to: event.currentTarget.value
								})}
						/>
						<input
							class="angle"
							type="range"
							min="0"
							max="360"
							step="5"
							value={gradient.angle}
							oninput={(event) =>
								setGradient(target as GradientTarget, {
									...gradient,
									angle: Number(event.currentTarget.value)
								})}
						/>
						<em>{gradient.angle}°</em>
					</span>
				{/if}
			</div>
		{/each}

		<h4>Colours</h4>
		<div class="chip-row">
			<span class="dim tiny">Copy colours from:</span>
			{#each allThemes() as entry (entry.id)}
				<button class="chip" onclick={() => borrowColours(entry.id)}>{entry.name}</button>
			{/each}
		</div>
		<div class="chip-row">
			<span class="dim tiny">Copy shape from:</span>
			{#each allThemes() as entry (entry.id)}
				<button class="chip" onclick={() => borrowShape(entry.id)}>{entry.name}</button>
			{/each}
		</div>
		<label class="field">
			<span>Controls</span>
			<select
				value={draft.scheme}
				onchange={(event) => setScheme(event.currentTarget.value as "dark" | "light")}
			>
				<option value="dark">Dark form controls</option>
				<option value="light">Light form controls</option>
			</select>
		</label>

		{#each TOKEN_GROUPS as group (group.name)}
			<h5>{group.name}</h5>
			<div class="tokens">
				{#each group.tokens as token (token)}
					<label class="token">
						<input
							type="color"
							value={asHex(draft.tokens[token as TokenName])}
							oninput={(event) => setToken(token as TokenName, event.currentTarget.value)}
						/>
						<span class="token-name">{token}</span>
					</label>
				{/each}
			</div>
		{/each}
	{/if}
</section>

<style>
	section {
		padding: 18px 0;
		border-top: 1px solid var(--border);
	}

	h3 {
		margin: 0 0 10px;
		font-size: 12px;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	h4 {
		margin: 18px 0 8px;
		font-size: 12px;
		color: var(--text-dim);
	}

	h5 {
		margin: 14px 0 6px;
		font-size: 11px;
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: 0.6px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
		gap: 8px;
	}

	.swatch {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 9px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--raised);
		text-align: left;
	}

	.swatch.selected {
		border-color: var(--accent);
	}

	.chips {
		display: flex;
		gap: 3px;
	}

	.chips i {
		width: 20px;
		height: 20px;
		border-radius: 4px;
		border: 1px solid var(--border);
	}

	.label {
		font-size: 12px;
		font-weight: 600;
	}

	.remove {
		position: absolute;
		top: 3px;
		right: 7px;
		color: var(--text-faint);
		font-size: 15px;
		line-height: 1;
	}

	.remove:hover {
		color: var(--danger);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
		flex-wrap: wrap;
	}

	.tiny {
		font-size: 11px;
	}

	.editing-head {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.name {
		flex: 1;
		font-weight: 600;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}

	.chip {
		padding: 4px 10px;
		font-size: 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--raised);
	}

	.chip:hover {
		border-color: var(--accent);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.field span {
		min-width: 90px;
	}

	select {
		flex: 1;
		background: var(--raised);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 7px 9px;
		font: inherit;
	}

	.slider {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 5px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.slider-label {
		min-width: 150px;
	}

	.slider input {
		flex: 1;
		padding: 0;
		accent-color: var(--accent);
	}

	.slider-value {
		min-width: 46px;
		text-align: right;
		font-family: var(--mono-family);
		font-size: 11px;
	}

	.tokens {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		gap: 6px;
	}

	.token {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 11px;
		color: var(--text-dim);
	}

	.token input {
		width: 26px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: none;
		cursor: pointer;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.check input {
		width: auto;
		padding: 0;
	}

	.check small {
		color: var(--text-faint);
	}

	.gradient {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 4px;
	}

	.gradient .check {
		flex: 1;
		margin: 0;
		text-transform: capitalize;
	}

	.grad-controls {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.grad-controls input[type="color"] {
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: none;
		cursor: pointer;
	}

	.grad-controls .angle {
		width: 80px;
		padding: 0;
		accent-color: var(--accent);
	}

	.grad-controls em {
		font-size: 10px;
		color: var(--text-faint);
		font-style: normal;
		min-width: 30px;
	}

	.token-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
