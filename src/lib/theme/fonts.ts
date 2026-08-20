/**
 * Which fonts this machine actually has.
 *
 * The font pickers used to be a hand-written list taken from one developer's
 * `fc-list`. On any other machine most of those names match nothing, the
 * browser silently falls back, and the setting appears broken: you pick a
 * font, nothing changes, and there is no way to tell why. A picker that lists
 * fonts you do not have is worse than a short one.
 *
 * So the candidates below are a wide cross-platform net, and every one is
 * measured at startup. Only the ones that genuinely render differently from
 * the generic fallback are offered. The generic families are always offered,
 * because they are guaranteed by the platform.
 */

export interface FontChoice {
	label: string;
	/** A full CSS stack, ending in a generic family. */
	value: string;
}

interface Candidate {
	label: string;
	family: string;
	generic: "sans-serif" | "serif" | "monospace";
}

/**
 * A deliberately broad list spanning Linux, Windows and macOS.
 *
 * Being absent is normal and costs nothing — detection removes it.
 */
const SANS: Candidate[] = [
	{ label: "Inter", family: "Inter", generic: "sans-serif" },
	{ label: "Roboto", family: "Roboto", generic: "sans-serif" },
	{ label: "Segoe UI", family: "Segoe UI", generic: "sans-serif" },
	{ label: "Helvetica Neue", family: "Helvetica Neue", generic: "sans-serif" },
	{ label: "Arial", family: "Arial", generic: "sans-serif" },
	{ label: "Noto Sans", family: "Noto Sans", generic: "sans-serif" },
	{ label: "Cantarell", family: "Cantarell", generic: "sans-serif" },
	{ label: "Adwaita Sans", family: "Adwaita Sans", generic: "sans-serif" },
	{ label: "Ubuntu", family: "Ubuntu", generic: "sans-serif" },
	{ label: "DejaVu Sans", family: "DejaVu Sans", generic: "sans-serif" },
	{ label: "Liberation Sans", family: "Liberation Sans", generic: "sans-serif" },
	{ label: "Open Sans", family: "Open Sans", generic: "sans-serif" },
	{ label: "Lato", family: "Lato", generic: "sans-serif" },
	{ label: "Rubik", family: "Rubik", generic: "sans-serif" },
	{ label: "Space Grotesk", family: "Space Grotesk", generic: "sans-serif" },
	{ label: "Uncut Sans", family: "Uncut Sans", generic: "sans-serif" },
	{ label: "Readex Pro", family: "Readex Pro", generic: "sans-serif" },
	{ label: "Nunito", family: "Nunito", generic: "sans-serif" },
	{ label: "Manrope", family: "Manrope", generic: "sans-serif" }
];

const SERIF: Candidate[] = [
	{ label: "Georgia", family: "Georgia", generic: "serif" },
	{ label: "Times New Roman", family: "Times New Roman", generic: "serif" },
	{ label: "Noto Serif", family: "Noto Serif", generic: "serif" },
	{ label: "DejaVu Serif", family: "DejaVu Serif", generic: "serif" },
	{ label: "Liberation Serif", family: "Liberation Serif", generic: "serif" },
	{ label: "FreeSerif", family: "FreeSerif", generic: "serif" }
];

const MONO: Candidate[] = [
	{ label: "JetBrains Mono", family: "JetBrains Mono", generic: "monospace" },
	{ label: "JetBrains Mono NF", family: "JetBrainsMono NFM", generic: "monospace" },
	{ label: "Fira Code", family: "Fira Code", generic: "monospace" },
	{ label: "Hack", family: "Hack", generic: "monospace" },
	{ label: "Source Code Pro", family: "Source Code Pro", generic: "monospace" },
	{ label: "Cascadia Code", family: "Cascadia Code", generic: "monospace" },
	{ label: "Consolas", family: "Consolas", generic: "monospace" },
	{ label: "Menlo", family: "Menlo", generic: "monospace" },
	{ label: "SF Mono", family: "SF Mono", generic: "monospace" },
	{ label: "DejaVu Sans Mono", family: "DejaVu Sans Mono", generic: "monospace" },
	{ label: "Liberation Mono", family: "Liberation Mono", generic: "monospace" },
	{ label: "Noto Sans Mono", family: "Noto Sans Mono", generic: "monospace" },
	{ label: "Space Mono", family: "Space Mono", generic: "monospace" },
	{ label: "Adwaita Mono", family: "Adwaita Mono", generic: "monospace" },
	{ label: "Courier New", family: "Courier New", generic: "monospace" }
];

/** Glyphs whose widths differ noticeably between typefaces. */
const PROBE = "mmmmmmmmmmlliWWWWWWWWWW@#%";

let context: CanvasRenderingContext2D | null = null;

function measure(stack: string): number {
	if (!context) {
		const canvas = document.createElement("canvas");
		context = canvas.getContext("2d");
	}
	if (!context) return 0;
	context.font = `72px ${stack}`;
	return context.measureText(PROBE).width;
}

/**
 * Is this family really installed?
 *
 * Measured rather than asked. `document.fonts.check()` answers about the
 * *loaded font set*, which is not the same question for system fonts, and it
 * reports true far too readily. Comparing the rendered width against the
 * generic fallback is the technique that actually works: if the family is
 * missing, the browser renders the fallback and the widths match exactly.
 */
function isInstalled(candidate: Candidate): boolean {
	const fallback = measure(candidate.generic);
	if (!fallback) return false;
	const withFamily = measure(`"${candidate.family}", ${candidate.generic}`);
	return Math.abs(withFamily - fallback) > 0.5;
}

function stackFor(candidate: Candidate): string {
	return `"${candidate.family}", ${candidate.generic}`;
}

/** Cached: measuring forty fonts is cheap but not free, and never changes. */
let cached: { ui: FontChoice[]; mono: FontChoice[] } | null = null;

export function availableFonts(): { ui: FontChoice[]; mono: FontChoice[] } {
	if (cached) return cached;

	// No DOM (tests, SSR): offer only what is guaranteed.
	if (typeof document === "undefined") {
		cached = { ui: [...GENERIC_UI], mono: [...GENERIC_MONO] };
		return cached;
	}

	const ui: FontChoice[] = [...GENERIC_UI];
	for (const candidate of [...SANS, ...SERIF]) {
		if (isInstalled(candidate)) ui.push({ label: candidate.label, value: stackFor(candidate) });
	}

	const mono: FontChoice[] = [...GENERIC_MONO];
	for (const candidate of MONO) {
		if (isInstalled(candidate)) mono.push({ label: candidate.label, value: stackFor(candidate) });
	}

	cached = { ui, mono };
	return cached;
}

/**
 * Always present, on every platform.
 *
 * `system-ui` is whatever the OS uses for its own interface, which is the
 * right default everywhere and needs no detection.
 */
export const GENERIC_UI: FontChoice[] = [
	{ label: "System default", value: SYSTEM_UI_STACK() },
	{ label: "Sans-serif", value: "sans-serif" },
	{ label: "Serif", value: "serif" },
	{ label: "Monospace", value: "monospace" }
];

export const GENERIC_MONO: FontChoice[] = [
	{ label: "System monospace", value: SYSTEM_MONO_STACK() },
	{ label: "Monospace", value: "monospace" }
];

export function SYSTEM_UI_STACK(): string {
	return 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
}

export function SYSTEM_MONO_STACK(): string {
	return 'ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace';
}
