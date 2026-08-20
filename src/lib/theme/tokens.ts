/**
 * Colours.
 *
 * Every colour the interface uses is a named token, and a theme is a full set
 * of them plus a `Shape` (see `shape.ts`) describing layout, type and how
 * round things are. Components never write a literal colour — they read
 * `var(--surface)` and friends — so a theme is data, not code, and a theme
 * made in the editor is exactly as powerful as a built-in one.
 */

import { DEFAULT_SHAPE, applyShape, clampShape, type Shape } from "./shape";

export { DEFAULT_SHAPE, applyShape, clampShape, type Shape };

/** Token names, fixed so a theme can be validated rather than hoped about. */
export const TOKENS = [
	// Structure, back to front.
	"backdrop",
	"rail",
	"sidebar",
	"surface",
	"raised",
	"overlay",

	// Lines and separators.
	"border",
	"border-strong",

	// Text, most to least prominent.
	"text",
	"text-dim",
	"text-faint",
	"text-inverse",

	// The accent, and what sits on it.
	"accent",
	"accent-hover",
	"accent-text",
	"accent-muted",

	// Meaning.
	"success",
	"warning",
	"danger",
	"info",

	// Chat specifics.
	"mention",
	"unread",
	"link",
	"code-bg",
	"scrollbar"
] as const;

export type TokenName = (typeof TOKENS)[number];
export type Tokens = Record<TokenName, string>;

/** Tokens grouped for the editor, so it isn't one wall of 25 swatches. */
export const TOKEN_GROUPS: { name: string; tokens: TokenName[] }[] = [
	{ name: "Surfaces", tokens: ["backdrop", "rail", "sidebar", "surface", "raised", "overlay"] },
	{ name: "Lines", tokens: ["border", "border-strong", "scrollbar"] },
	{ name: "Text", tokens: ["text", "text-dim", "text-faint", "text-inverse"] },
	{ name: "Accent", tokens: ["accent", "accent-hover", "accent-text", "accent-muted"] },
	{ name: "Meaning", tokens: ["success", "warning", "danger", "info"] },
	{ name: "Chat", tokens: ["mention", "unread", "link", "code-bg"] }
];

/** Surfaces that can carry a gradient instead of a flat colour. */
export const GRADIENT_TARGETS = [
	"backdrop",
	"rail",
	"sidebar",
	"surface",
	"raised",
	"overlay",
	"accent"
] as const;

export type GradientTarget = (typeof GRADIENT_TARGETS)[number];

export interface Gradient {
	from: string;
	to: string;
	angle: number;
}

export interface Theme {
	id: string;
	name: string;
	/** Tells the webview which scrollbars and form controls to draw. */
	scheme: "dark" | "light";
	tokens: Tokens;
	shape: Shape;
	/**
	 * Fallback avatar colours, for everyone without a picture. Part of the
	 * theme because a room list is mostly avatars, and a palette fixed
	 * independently of the theme fights every theme somebody writes.
	 */
	avatars?: string[];
	/**
	 * Optional gradients, per surface.
	 *
	 * Kept separate from `tokens` rather than letting a token hold a gradient
	 * string, because a token is also used for borders and text where a
	 * gradient is meaningless. Every surface therefore has both: a flat colour
	 * that always works, and an optional fill layered on top of it.
	 */
	gradients?: Partial<Record<GradientTarget, Gradient>>;
	/** True for themes that ship with the app and cannot be deleted. */
	builtin?: boolean;
}

/** A gradient as CSS, or "" when there isn't one. */
export function gradientCss(gradient: Gradient | undefined): string {
	if (!gradient?.from || !gradient?.to) return "";
	const angle = Number.isFinite(gradient.angle) ? gradient.angle : 160;
	return `linear-gradient(${angle}deg, ${gradient.from}, ${gradient.to})`;
}

function cleanGradient(value: unknown): Gradient | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Partial<Gradient>;
	const hex = (candidate: unknown) =>
		typeof candidate === "string" && isColour(candidate) ? candidate : "";
	const from = hex(raw.from);
	const to = hex(raw.to);
	if (!from || !to) return null;
	const angle = Number(raw.angle);
	return { from, to, angle: Number.isFinite(angle) ? Math.min(360, Math.max(0, angle)) : 160 };
}

/** A palette derived from a theme, used when it doesn't supply its own. */
export function derivedAvatars(scheme: "dark" | "light"): string[] {
	const saturation = scheme === "light" ? 52 : 42;
	const lightness = scheme === "light" ? 52 : 44;
	return Array.from({ length: 8 }, (_, index) =>
		`hsl(${Math.round((index * 360) / 8 + 15)} ${saturation}% ${lightness}%)`
	);
}

export function avatarPalette(theme: Theme): string[] {
	return theme.avatars?.length ? theme.avatars : derivedAvatars(theme.scheme);
}

export const BUILTIN_THEMES: Theme[] = [
{
	id: "rose-dark",
	name: "Rose Dark",
	scheme: "dark",
	builtin: true,
	shape: clampShape({}),
	tokens: {
		backdrop: "#0b0b0f",
		rail: "#0e0e13",
		sidebar: "#131319",
		surface: "#17171f",
		raised: "#1e1e28",
		overlay: "#22222d",
		border: "#26262f",
		"border-strong": "#33333f",
		text: "#ecebf0",
		"text-dim": "#a8a5b4",
		"text-faint": "#6f6c7d",
		"text-inverse": "#0b0b0f",
		accent: "#e86f9a",
		"accent-hover": "#f08bae",
		"accent-text": "#1a0a11",
		"accent-muted": "#4a2233",
		success: "#3fa860",
		warning: "#d9a441",
		danger: "#e05561",
		info: "#5b9dd9",
		mention: "#2a1f2b",
		unread: "#e86f9a",
		link: "#8ab4f8",
		"code-bg": "#101016",
		scrollbar: "#33333f"
	},
	avatars: ["#b5527a", "#7a5bb0", "#4a7fb5", "#3f9a8c", "#5f9a4a", "#b58b3f", "#b5654a", "#8a5f9a"]
},
{
	id: "rose-oled",
	name: "Rose OLED",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ borderWidth: 1 }),
	tokens: {
		backdrop: "#000000",
		rail: "#000000",
		sidebar: "#060608",
		surface: "#000000",
		raised: "#0d0d12",
		overlay: "#14141a",
		border: "#1b1b22",
		"border-strong": "#2a2a33",
		text: "#ecebf0",
		"text-dim": "#9c99a8",
		"text-faint": "#66636f",
		"text-inverse": "#000000",
		accent: "#e86f9a",
		"accent-hover": "#f08bae",
		"accent-text": "#12060b",
		"accent-muted": "#3d1b29",
		success: "#3fa860",
		warning: "#d9a441",
		danger: "#e05561",
		info: "#5b9dd9",
		mention: "#1c1420",
		unread: "#e86f9a",
		link: "#8ab4f8",
		"code-bg": "#08080b",
		scrollbar: "#2a2a33"
	},
	avatars: ["#8e3f5f", "#5f458a", "#3a628c", "#2f7a6f", "#4a7a3a", "#8c6c30", "#8c4e39", "#6b4a78"]
},
{
	id: "greenhouse",
	name: "Greenhouse",
	scheme: "dark",
	builtin: true,
	shape: clampShape({}),
	tokens: {
		backdrop: "#080c0a",
		rail: "#0a100c",
		sidebar: "#0e1611",
		surface: "#111a14",
		raised: "#17241b",
		overlay: "#1c2c21",
		border: "#1f3126",
		"border-strong": "#2b4433",
		text: "#e6efe8",
		"text-dim": "#9db3a4",
		"text-faint": "#68806f",
		"text-inverse": "#04120a",
		accent: "#3fa860",
		"accent-hover": "#4cc274",
		"accent-text": "#04120a",
		"accent-muted": "#1c3d28",
		success: "#4cc274",
		warning: "#d9a441",
		danger: "#e05561",
		info: "#5b9dd9",
		mention: "#16281c",
		unread: "#3fa860",
		link: "#6fc9a0",
		"code-bg": "#0a120d",
		scrollbar: "#2b4433"
	},
	avatars: ["#3f9a60", "#2f8a7a", "#4a8f45", "#5f9a3f", "#3a7f8c", "#7a9a3f", "#2f7a5a", "#6b8f55"]
},
{
	id: "midnight",
	name: "Midnight",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ radius: 14, buttonRadius: 16 }),
	tokens: {
		backdrop: "#080b14",
		rail: "#0a0e1a",
		sidebar: "#0e1322",
		surface: "#121829",
		raised: "#1a2136",
		overlay: "#212942",
		border: "#232c45",
		"border-strong": "#334063",
		text: "#e4e8f5",
		"text-dim": "#9aa3c0",
		"text-faint": "#666f8c",
		"text-inverse": "#080b14",
		accent: "#6f8fe8",
		"accent-hover": "#89a5f0",
		"accent-text": "#070c1a",
		"accent-muted": "#25325c",
		success: "#4cc274",
		warning: "#e0b050",
		danger: "#e0616e",
		info: "#61a8e0",
		mention: "#1d2340",
		unread: "#6f8fe8",
		link: "#8ab4f8",
		"code-bg": "#0b0f1c",
		scrollbar: "#334063"
	},
	avatars: ["#4f6bbf", "#6a53a8", "#3f7fa8", "#2f8a86", "#4a8f5a", "#a8863f", "#a85a4f", "#7a5f9e"]
},
{
	id: "ember",
	name: "Ember",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ radius: 6, buttonRadius: 6 }),
	tokens: {
		backdrop: "#120b08",
		rail: "#170e0a",
		sidebar: "#1c120c",
		surface: "#221610",
		raised: "#2c1d15",
		overlay: "#35241a",
		border: "#3a271c",
		"border-strong": "#54382a",
		text: "#f2e5db",
		"text-dim": "#c0a08c",
		"text-faint": "#8a6a58",
		"text-inverse": "#120b08",
		accent: "#e07a3f",
		"accent-hover": "#f0954f",
		"accent-text": "#1a0c04",
		"accent-muted": "#4d2c14",
		success: "#8fae4a",
		warning: "#e0b050",
		danger: "#e05561",
		info: "#5b9dd9",
		mention: "#2e1c10",
		unread: "#e07a3f",
		link: "#e8a76a",
		"code-bg": "#170e09",
		scrollbar: "#54382a"
	},
	avatars: ["#b5654a", "#a8863f", "#8f7a3f", "#a85a4f", "#7a5f4a", "#9e6b3f", "#8a5a35", "#b07a55"]
},
{
	id: "abyss",
	name: "Abyss",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ radius: 2, buttonRadius: 2, avatarRounding: 4 }),
	tokens: {
		backdrop: "#05070a",
		rail: "#070a0e",
		sidebar: "#0a0e13",
		surface: "#0d1218",
		raised: "#141b24",
		overlay: "#1a222d",
		border: "#182029",
		"border-strong": "#26323f",
		text: "#dbe4ec",
		"text-dim": "#8fa0b0",
		"text-faint": "#5d6b78",
		"text-inverse": "#05070a",
		accent: "#3fb5c2",
		"accent-hover": "#55ccd9",
		"accent-text": "#031214",
		"accent-muted": "#15383d",
		success: "#3fa860",
		warning: "#d9a441",
		danger: "#e05561",
		info: "#4f9fd4",
		mention: "#12222a",
		unread: "#3fb5c2",
		link: "#6fc9d9",
		"code-bg": "#070c11",
		scrollbar: "#26323f"
	},
	avatars: ["#2f7a8a", "#3f6b9e", "#5f5f9e", "#2f8a7a", "#4a8f5a", "#8a7a3f", "#9e5f4f", "#6b5f8a"]
},
{
	id: "frost",
	name: "Frost",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ radius: 8, buttonRadius: 8 }),
	tokens: {
		backdrop: "#20242d",
		rail: "#242932",
		sidebar: "#2a2f3a",
		surface: "#2f3542",
		raised: "#3a4150",
		overlay: "#434b5c",
		border: "#3b4351",
		"border-strong": "#4c5668",
		text: "#e5e9f0",
		"text-dim": "#b3bcca",
		"text-faint": "#7d8899",
		"text-inverse": "#20242d",
		accent: "#88c0d0",
		"accent-hover": "#9fd2e0",
		"accent-text": "#16202a",
		"accent-muted": "#33505c",
		success: "#a3be8c",
		warning: "#ebcb8b",
		danger: "#bf616a",
		info: "#81a1c1",
		mention: "#3b4657",
		unread: "#88c0d0",
		link: "#81a1c1",
		"code-bg": "#262b34",
		scrollbar: "#4c5668"
	},
	avatars: ["#5e81ac", "#b48ead", "#88c0d0", "#8fbcbb", "#a3be8c", "#ebcb8b", "#bf616a", "#d08770"]
},
{
	id: "nightshade",
	name: "Nightshade",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ radius: 12, buttonRadius: 12 }),
	tokens: {
		backdrop: "#1a1626",
		rail: "#1f1a2e",
		sidebar: "#241e35",
		surface: "#2a2340",
		raised: "#342c4e",
		overlay: "#3d345a",
		border: "#37304f",
		"border-strong": "#4a4067",
		text: "#eae4f5",
		"text-dim": "#b6abcf",
		"text-faint": "#7f759b",
		"text-inverse": "#1a1626",
		accent: "#bd93f9",
		"accent-hover": "#cfaefb",
		"accent-text": "#180e28",
		"accent-muted": "#3f2f5e",
		success: "#50fa7b",
		warning: "#f1fa8c",
		danger: "#ff5555",
		info: "#8be9fd",
		mention: "#332a4d",
		unread: "#bd93f9",
		link: "#8be9fd",
		"code-bg": "#1e1930",
		scrollbar: "#4a4067"
	},
	avatars: ["#8b5fbf", "#6272a4", "#4fa8c5", "#3fa88c", "#5fa84f", "#bfa03f", "#bf5f7a", "#a05fbf"]
},
{
	id: "moss",
	name: "Moss",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ radius: 4, buttonRadius: 4, avatarRounding: 8 }),
	tokens: {
		backdrop: "#1d2021",
		rail: "#22262a",
		sidebar: "#282c30",
		surface: "#2d3238",
		raised: "#373d44",
		overlay: "#414850",
		border: "#3b4148",
		"border-strong": "#4d545c",
		text: "#e6ded4",
		"text-dim": "#b3aa9c",
		"text-faint": "#7f776c",
		"text-inverse": "#1d2021",
		accent: "#8ec07c",
		"accent-hover": "#a5d194",
		"accent-text": "#14180f",
		"accent-muted": "#3a4a33",
		success: "#b8bb26",
		warning: "#fabd2f",
		danger: "#fb4934",
		info: "#83a598",
		mention: "#3a3f36",
		unread: "#8ec07c",
		link: "#83a598",
		"code-bg": "#232729",
		scrollbar: "#4d545c"
	},
	avatars: ["#689d6a", "#458588", "#d79921", "#cc241d", "#b16286", "#98971a", "#d65d0e", "#7c6f64"]
},
{
	id: "terminal",
	name: "Terminal",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ radius: 0, buttonRadius: 0, avatarRounding: 0, borderWidth: 1, fontFamily: '"Hack", ui-monospace, monospace', density: "compact", messageGap: 3, avatarSize: 20, fontSize: 13 }),
	tokens: {
		backdrop: "#000000",
		rail: "#000000",
		sidebar: "#020402",
		surface: "#000000",
		raised: "#0a0f0a",
		overlay: "#0f160f",
		border: "#153015",
		"border-strong": "#1f4a1f",
		text: "#33ff66",
		"text-dim": "#22bb44",
		"text-faint": "#177a2e",
		"text-inverse": "#000000",
		accent: "#33ff66",
		"accent-hover": "#66ff99",
		"accent-text": "#001a08",
		"accent-muted": "#0d3319",
		success: "#33ff66",
		warning: "#ffcc33",
		danger: "#ff4444",
		info: "#33ccff",
		mention: "#0d260d",
		unread: "#33ff66",
		link: "#66ffcc",
		"code-bg": "#020602",
		scrollbar: "#1f4a1f"
	},
	avatars: ["#1f7a3d", "#2f8a5a", "#3f7a2f", "#2f6b6b", "#5a7a2f", "#7a6b2f", "#7a3f2f", "#4a5f7a"]
},
{
	id: "carbon",
	name: "Carbon",
	scheme: "dark",
	builtin: true,
	shape: clampShape({ radius: 3, buttonRadius: 3, avatarRounding: 6, borderWidth: 1 }),
	tokens: {
		backdrop: "#161616",
		rail: "#1c1c1c",
		sidebar: "#212121",
		surface: "#262626",
		raised: "#303030",
		overlay: "#393939",
		border: "#333333",
		"border-strong": "#474747",
		text: "#f4f4f4",
		"text-dim": "#a8a8a8",
		"text-faint": "#6f6f6f",
		"text-inverse": "#161616",
		accent: "#4589ff",
		"accent-hover": "#6ba3ff",
		"accent-text": "#001141",
		"accent-muted": "#1c3b6e",
		success: "#42be65",
		warning: "#f1c21b",
		danger: "#fa4d56",
		info: "#4589ff",
		mention: "#2b2b33",
		unread: "#4589ff",
		link: "#78a9ff",
		"code-bg": "#1b1b1b",
		scrollbar: "#474747"
	},
	avatars: ["#4589ff", "#8a3ffc", "#007d79", "#198038", "#b28600", "#d12771", "#9f1853", "#005d5d"]
},
{
	id: "daylight",
	name: "Daylight",
	scheme: "light",
	builtin: true,
	shape: clampShape({}),
	tokens: {
		backdrop: "#eceaf0",
		rail: "#e2e0e8",
		sidebar: "#f0eef4",
		surface: "#fbfafd",
		raised: "#ffffff",
		overlay: "#ffffff",
		border: "#dedbe6",
		"border-strong": "#c9c5d4",
		text: "#1c1a22",
		"text-dim": "#5c5868",
		"text-faint": "#8b8798",
		"text-inverse": "#ffffff",
		accent: "#c2456f",
		"accent-hover": "#a93860",
		"accent-text": "#ffffff",
		"accent-muted": "#f4d7e2",
		success: "#2f8b4c",
		warning: "#a9741f",
		danger: "#c0392f",
		info: "#3a72ad",
		mention: "#fdf2d9",
		unread: "#c2456f",
		link: "#2b5fb8",
		"code-bg": "#f2f0f6",
		scrollbar: "#c9c5d4"
	},
	avatars: ["#a83e63", "#6b4a9e", "#38659e", "#2f7f72", "#4a7f35", "#9e7226", "#a2503a", "#764a86"]
},
{
	id: "paper",
	name: "Paper",
	scheme: "light",
	builtin: true,
	shape: clampShape({ radius: 2, buttonRadius: 2, avatarRounding: 4, fontFamily: '"FreeSerif", Georgia, serif' }),
	tokens: {
		backdrop: "#f4f1ea",
		rail: "#eae6dc",
		sidebar: "#f0ece2",
		surface: "#faf8f3",
		raised: "#ffffff",
		overlay: "#ffffff",
		border: "#ded8ca",
		"border-strong": "#c4bcaa",
		text: "#26231c",
		"text-dim": "#5e594c",
		"text-faint": "#8d8778",
		"text-inverse": "#faf8f3",
		accent: "#8a6d3b",
		"accent-hover": "#6f572c",
		"accent-text": "#ffffff",
		"accent-muted": "#e6dcc4",
		success: "#4a7f35",
		warning: "#a9741f",
		danger: "#a8402f",
		info: "#3a6a9e",
		mention: "#f5ecd2",
		unread: "#8a6d3b",
		link: "#2f5f9e",
		"code-bg": "#efeade",
		scrollbar: "#c4bcaa"
	},
	avatars: ["#8a6d3b", "#6b5a8a", "#3a6a9e", "#2f7f6a", "#4a7f35", "#9e7226", "#a2503a", "#6a5f4a"]
},
{
	id: "linen",
	name: "Linen",
	scheme: "light",
	builtin: true,
	shape: clampShape({ radius: 16, buttonRadius: 20 }),
	tokens: {
		backdrop: "#f7f5f8",
		rail: "#efedf2",
		sidebar: "#f4f2f7",
		surface: "#ffffff",
		raised: "#faf9fc",
		overlay: "#ffffff",
		border: "#e6e3ec",
		"border-strong": "#d0ccd9",
		text: "#221f2a",
		"text-dim": "#605b6e",
		"text-faint": "#928da0",
		"text-inverse": "#ffffff",
		accent: "#7a5bb0",
		"accent-hover": "#674a99",
		"accent-text": "#ffffff",
		"accent-muted": "#e4dbf2",
		success: "#2f8b4c",
		warning: "#a9741f",
		danger: "#c0392f",
		info: "#3a72ad",
		mention: "#f0e8fb",
		unread: "#7a5bb0",
		link: "#5b4bb8",
		"code-bg": "#f4f2f8",
		scrollbar: "#d0ccd9"
	},
	avatars: ["#7a5bb0", "#b0568a", "#3a72ad", "#2f8b7a", "#4a8b3a", "#a8862f", "#b05a4a", "#6a5aa8"]
}
];

export const DEFAULT_THEME_ID = "rose-dark";

/**
 * Push a theme onto the document as CSS custom properties.
 *
 * Everything visual goes through here. There is no second path, which is why
 * a theme change is instant and needs no component to re-render.
 */
export function applyTheme(theme: Theme, root: HTMLElement): void {
	for (const token of TOKENS) {
		root.style.setProperty(`--${token}`, theme.tokens[token]);
	}

	/*
	 * Each surface also gets a `--x-fill`, which is the gradient when there is
	 * one and the flat colour otherwise. Components use the fill, so a theme
	 * without gradients renders exactly as before and one with them needs no
	 * component changes.
	 */
	for (const target of GRADIENT_TARGETS) {
		const gradient = gradientCss(theme.gradients?.[target]);
		root.style.setProperty(`--${target}-fill`, gradient || `var(--${target})`);
	}

	applyShape(theme.shape, root);
	root.style.colorScheme = theme.scheme;
}

/**
 * Accept a theme from outside without trusting it.
 *
 * Every token must be present and must look like a colour: a theme missing
 * one would render a single element with an inherited colour, which is the
 * kind of bug people report as "the app is broken".
 */
export function parseTheme(input: unknown): { theme: Theme } | { error: string } {
	if (typeof input !== "object" || input === null) {
		return { error: "A theme must be a JSON object." };
	}
	const raw = input as Record<string, unknown>;
	if (typeof raw.id !== "string" || !raw.id.trim()) return { error: "A theme needs an id." };
	if (typeof raw.name !== "string" || !raw.name.trim()) return { error: "A theme needs a name." };

	const rawTokens = raw.tokens;
	if (typeof rawTokens !== "object" || rawTokens === null) {
		return { error: "A theme needs a tokens object." };
	}
	const source = rawTokens as Record<string, unknown>;

	const tokens = {} as Tokens;
	const missing: string[] = [];
	for (const token of TOKENS) {
		const value = source[token];
		if (typeof value !== "string" || !isColour(value)) {
			missing.push(token);
			continue;
		}
		tokens[token] = value;
	}
	if (missing.length) {
		return {
			error: `Missing or invalid colours: ${missing.slice(0, 6).join(", ")}${
				missing.length > 6 ? `, and ${missing.length - 6} more` : ""
			}`
		};
	}

	let avatars: string[] | undefined;
	if (Array.isArray(raw.avatars)) {
		const clean = raw.avatars.filter(
			(entry): entry is string => typeof entry === "string" && isColour(entry)
		);
		if (clean.length) avatars = clean;
	}

	let gradients: Theme["gradients"];
	if (raw.gradients && typeof raw.gradients === "object") {
		const source = raw.gradients as Record<string, unknown>;
		const clean: Partial<Record<GradientTarget, Gradient>> = {};
		for (const target of GRADIENT_TARGETS) {
			const gradient = cleanGradient(source[target]);
			if (gradient) clean[target] = gradient;
		}
		if (Object.keys(clean).length) gradients = clean;
	}

	return {
		theme: {
			id: raw.id,
			name: raw.name,
			scheme: raw.scheme === "light" ? "light" : "dark",
			tokens,
			shape: clampShape(raw.shape as Partial<Shape> | undefined),
			avatars,
			gradients
		}
	};
}

/**
 * Colours are validated by shape rather than parsed. Hex, rgb/hsl and the few
 * names people actually type. Anything cleverer is a CSS injection question,
 * and the answer to that is a narrow allowlist, not a clever regex.
 */
function isColour(value: string): boolean {
	const text = value.trim().toLowerCase();
	if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text)) return true;
	if (/^rgba?\(\s*[\d.\s,%/]+\)$/.test(text)) return true;
	if (/^hsla?\(\s*[\d.\s,%/deg]+\)$/.test(text)) return true;
	return ["transparent", "black", "white"].includes(text);
}
