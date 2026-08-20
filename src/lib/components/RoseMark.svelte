<script lang="ts" module>
	/**
	 * The R.O.S.E. rose, after Joan G. Stark's ASCII "rose (3/99)".
	 *
	 * Drawn as SVG rather than as a <pre> of live text, and that is the whole
	 * point of this file.
	 *
	 * As text, the drawing's proportions are at the mercy of whichever font
	 * the system happens to resolve: the advance width sets the column pitch,
	 * the line height sets the row pitch, and the ratio between them is the
	 * only thing that makes this read as a rose rather than as a smear. Two
	 * machines — or one machine and one webview — resolving different fonts
	 * get visibly different drawings, which is exactly what went wrong here
	 * repeatedly.
	 *
	 * Each line is placed at an exact coordinate and pinned to an exact width
	 * with `textLength` + `lengthAdjust="spacingAndGlyphs"`. The font supplies
	 * glyph shapes and nothing else; every position is fixed by the viewBox.
	 * The geometry is therefore identical everywhere, forever.
	 *
	 * Cell is 10 wide by 25 tall, giving the 0.4 column:row pitch measured
	 * off the canonical render.
	 */
	export const ROSE_VIEWBOX = "0 0 190 325";
</script>

<script lang="ts">
	interface Props {
		/** Rendered height in px. Width follows from the aspect ratio. */
		size?: number;
		colour?: string;
		label?: string;
	}

	let { size = 240, colour = "var(--accent)", label = "Rose" }: Props = $props();
</script>

<svg
	class="rose"
	viewBox={ROSE_VIEWBOX}
	height={size}
	role="img"
	aria-label={label}
	fill={colour}
	xmlns="http://www.w3.org/2000/svg"
>
		<text x="90" y="18.75" textLength="10" lengthAdjust="spacingAndGlyphs">_</text>
		<text x="60" y="43.75" textLength="80" lengthAdjust="spacingAndGlyphs">_.;_'-._</text>
		<text x="50" y="68.75" textLength="100" lengthAdjust="spacingAndGlyphs">&#123;`--.-'_,&#125;</text>
		<text x="40" y="93.75" textLength="120" lengthAdjust="spacingAndGlyphs">&#123;; \,__.-'/&#125;</text>
		<text x="40" y="118.75" textLength="110" lengthAdjust="spacingAndGlyphs">&#123;.'-`._;-';</text>
		<text x="50" y="143.75" textLength="90" lengthAdjust="spacingAndGlyphs">`'--._.-'</text>
		<text x="80" y="168.75" textLength="90" lengthAdjust="spacingAndGlyphs">.-\\,-"-.</text>
		<text x="80" y="193.75" textLength="110" lengthAdjust="spacingAndGlyphs">`- \( '-. \</text>
		<text x="120" y="218.75" textLength="70" lengthAdjust="spacingAndGlyphs">\;---,/</text>
		<text x="80" y="243.75" textLength="70" lengthAdjust="spacingAndGlyphs">.-""-;\</text>
		<text x="70" y="268.75" textLength="90" lengthAdjust="spacingAndGlyphs">/  .-' )\</text>
		<text x="70" y="293.75" textLength="100" lengthAdjust="spacingAndGlyphs">\,---'` \\</text>
		<text x="160" y="318.75" textLength="20" lengthAdjust="spacingAndGlyphs">\|</text>
</svg>

<style>
	.rose {
		display: block;
		/* Width is implied by the viewBox; never let a flex parent squash it. */
		flex: none;
		font-family: "Hack", "DejaVu Sans Mono", "Liberation Mono", monospace;
		font-size: 20px;
		font-variant-ligatures: none;
		font-feature-settings: "liga" 0, "clig" 0, "calt" 0;
		white-space: pre;
	}
</style>
