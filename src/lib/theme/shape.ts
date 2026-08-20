/**
 * The non-colour half of a theme: layout, type, and how round things are.
 *
 * These were the gap. A theme could recolour everything and change nothing
 * about how the app was *shaped* — so "customisable layout" wasn't true. Every
 * value here becomes a CSS custom property, and every component reads it,
 * which is what makes blocky-versus-rounded or dense-versus-airy a setting
 * rather than a rebuild.
 *
 * Anything added here needs three things or it is decoration: a default, a
 * clamp (these come from user-editable files), and at least one component
 * actually reading the variable.
 */

import {
	SYSTEM_MONO_STACK,
	SYSTEM_UI_STACK,
	availableFonts,
	type FontChoice
} from "./fonts";

export interface Shape {
	// ── Roundness ────────────────────────────────────────────────
	/** Corner radius on panels and inputs, px. 0 is fully blocky. */
	radius: number;
	/** Corner radius on buttons specifically, px. Pill at high values. */
	buttonRadius: number;
	/** Avatar rounding, %. 50 is a circle, 0 a square, 12 a squircle. */
	avatarRounding: number;
	/** Border thickness, px. 0 removes lines entirely for a flat look. */
	borderWidth: number;

	// ── Type ─────────────────────────────────────────────────────
	fontFamily: string;
	monoFamily: string;
	/** Base size, px. Everything else is relative. */
	fontSize: number;
	/** Body line height, unitless. */
	lineHeight: number;
	/** Weight used for names, headings and buttons. */
	boldWeight: number;

	// ── Density ──────────────────────────────────────────────────
	/** Vertical space between messages, px. */
	messageGap: number;
	/** Control height, px — how big buttons and inputs are. */
	controlHeight: number;
	/** Avatar diameter in the timeline, px. */
	avatarSize: number;

	// ── Layout ───────────────────────────────────────────────────
	/** Room list column width, px. */
	sidebarWidth: number;
	/** Spaces rail width, px. 0 hides it. */
	railWidth: number;
	/**
	 * Message layout.
	 *   cozy    — avatar beside each group, the familiar chat look
	 *   compact — one line per message, name inline, no avatars
	 */
	density: "cozy" | "compact";

	// ── Behaviour and extras ─────────────────────────────────────
	/** Draw each message on its own filled bubble. */
	bubbles: boolean;
	/** Clock format in the timeline, or hide timestamps entirely. */
	clock: "24h" | "12h" | "off";
	/** Show the last message under each room in the list. */
	roomPreviews: boolean;
	/** Animations and transitions. Off is genuinely faster on old hardware. */
	animations: boolean;
	/** Put the room list and rail on the right instead of the left. */
	sidebarSide: "left" | "right";
}

export const DEFAULT_SHAPE: Shape = {
	radius: 10,
	buttonRadius: 10,
	avatarRounding: 50,
	borderWidth: 1,

	// Generic stacks only. Naming a specific font here would be a default that
	// silently falls back on any machine without it.
	fontFamily: SYSTEM_UI_STACK(),
	monoFamily: SYSTEM_MONO_STACK(),
	fontSize: 15,
	lineHeight: 1.5,
	boldWeight: 700,

	messageGap: 14,
	controlHeight: 38,
	avatarSize: 38,

	sidebarWidth: 260,
	railWidth: 68,
	density: "cozy",

	bubbles: false,
	clock: "24h",
	roomPreviews: true,
	animations: true,
	sidebarSide: "left"
};

/** Editable ranges, used by the sliders and by validation. Single source. */
/** The numeric knobs only — everything with a slider. */
export type NumericShapeKey = {
	[K in keyof Shape]: Shape[K] extends number ? K : never;
}[keyof Shape];

export const SHAPE_LIMITS: Record<
	NumericShapeKey,
	{ min: number; max: number; step: number; label: string; unit: string }
> = {
	radius: { min: 0, max: 24, step: 1, label: "Corner rounding", unit: "px" },
	buttonRadius: { min: 0, max: 24, step: 1, label: "Button rounding", unit: "px" },
	avatarRounding: { min: 0, max: 50, step: 1, label: "Avatar rounding", unit: "%" },
	borderWidth: { min: 0, max: 3, step: 1, label: "Border thickness", unit: "px" },
	fontSize: { min: 11, max: 22, step: 1, label: "Text size", unit: "px" },
	lineHeight: { min: 1.2, max: 2, step: 0.05, label: "Line spacing", unit: "" },
	boldWeight: { min: 500, max: 900, step: 100, label: "Bold weight", unit: "" },
	messageGap: { min: 2, max: 32, step: 1, label: "Space between messages", unit: "px" },
	controlHeight: { min: 28, max: 52, step: 1, label: "Button size", unit: "px" },
	avatarSize: { min: 20, max: 56, step: 1, label: "Avatar size", unit: "px" },
	sidebarWidth: { min: 180, max: 420, step: 4, label: "Room list width", unit: "px" },
	railWidth: { min: 0, max: 96, step: 4, label: "Spaces rail width", unit: "px" }
};

/**
 * Fonts offered in the pickers.
 *
 * Detected at runtime — see `fonts.ts`. These were once a hand-written list
 * taken from one machine, which meant most entries matched nothing anywhere
 * else and the setting looked broken.
 */
export function uiFonts(): FontChoice[] {
	return availableFonts().ui;
}

export function monoFonts(): FontChoice[] {
	return availableFonts().mono;
}

/** Ready-made shapes, so "make it blocky" is one click and not twelve. */
export const SHAPE_PRESETS: { id: string; name: string; hint: string; shape: Partial<Shape> }[] = [
	{
		id: "rounded",
		name: "Rounded",
		hint: "Soft corners, circular avatars",
		shape: { radius: 12, buttonRadius: 14, avatarRounding: 50, borderWidth: 1 }
	},
	{
		id: "pill",
		name: "Pill",
		hint: "Very round buttons",
		shape: { radius: 16, buttonRadius: 24, avatarRounding: 50, borderWidth: 1 }
	},
	{
		id: "blocky",
		name: "Blocky",
		hint: "Square everything",
		shape: { radius: 0, buttonRadius: 0, avatarRounding: 0, borderWidth: 1 }
	},
	{
		id: "soft-square",
		name: "Soft square",
		hint: "Squircles, like a phone home screen",
		shape: { radius: 6, buttonRadius: 6, avatarRounding: 14, borderWidth: 1 }
	},
	{
		id: "flat",
		name: "Flat",
		hint: "No borders at all",
		shape: { radius: 8, buttonRadius: 8, avatarRounding: 50, borderWidth: 0 }
	}
];

/** Density presets, which change several values at once. */
export const DENSITY_PRESETS: { id: string; name: string; hint: string; shape: Partial<Shape> }[] = [
	{
		id: "comfortable",
		name: "Comfortable",
		hint: "Roomy, avatars beside each group",
		shape: { density: "cozy", messageGap: 18, avatarSize: 40, fontSize: 15, lineHeight: 1.55 }
	},
	{
		id: "cozy",
		name: "Cozy",
		hint: "The default",
		shape: { density: "cozy", messageGap: 14, avatarSize: 38, fontSize: 15, lineHeight: 1.5 }
	},
	{
		id: "compact",
		name: "Compact",
		hint: "One line per message, no avatars — fits far more on screen",
		shape: { density: "compact", messageGap: 4, avatarSize: 22, fontSize: 14, lineHeight: 1.35 }
	},
	{
		id: "tiny",
		name: "Tiny",
		hint: "As much text as the screen will take",
		shape: { density: "compact", messageGap: 2, avatarSize: 18, fontSize: 12, lineHeight: 1.25 }
	}
];

export function clampShape(input: Partial<Shape> | undefined, base: Shape = DEFAULT_SHAPE): Shape {
	const raw = input ?? {};
	const out = { ...base } as Shape;

	for (const [key, limit] of Object.entries(SHAPE_LIMITS)) {
		const value = (raw as Record<string, unknown>)[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			(out as unknown as Record<string, number>)[key] = Math.min(
				limit.max,
				Math.max(limit.min, value)
			);
		}
	}

	if (typeof raw.fontFamily === "string" && raw.fontFamily.trim() && isSafeFont(raw.fontFamily)) {
		out.fontFamily = raw.fontFamily;
	}
	if (typeof raw.monoFamily === "string" && raw.monoFamily.trim() && isSafeFont(raw.monoFamily)) {
		out.monoFamily = raw.monoFamily;
	}
	out.density = raw.density === "compact" ? "compact" : "cozy";
	out.bubbles = raw.bubbles === true;
	out.clock = raw.clock === "12h" || raw.clock === "off" ? raw.clock : "24h";
	out.roomPreviews = raw.roomPreviews !== false;
	out.animations = raw.animations !== false;
	out.sidebarSide = raw.sidebarSide === "right" ? "right" : "left";
	return out;
}

/**
 * A font stack goes straight into a CSS property, so it is untrusted input in
 * the same way a colour is. Allow the characters a font list legitimately
 * needs and nothing that could close the declaration.
 */
function isSafeFont(value: string): boolean {
	return value.length < 200 && /^[\w\s,"'()-]+$/.test(value);
}

/** Push a shape onto the document as custom properties. */
export function applyShape(shape: Shape, root: HTMLElement): void {
	const set = (name: string, value: string) => root.style.setProperty(name, value);

	set("--radius", `${shape.radius}px`);
	set("--button-radius", `${shape.buttonRadius}px`);
	set("--avatar-rounding", `${shape.avatarRounding}%`);
	set("--border-width", `${shape.borderWidth}px`);

	set("--font-family", shape.fontFamily);
	set("--mono-family", shape.monoFamily);
	set("--font-size", `${shape.fontSize}px`);
	set("--line-height", `${shape.lineHeight}`);
	set("--bold-weight", `${shape.boldWeight}`);

	set("--message-gap", `${shape.messageGap}px`);
	set("--control-height", `${shape.controlHeight}px`);
	set("--control-pad", `${Math.round(shape.controlHeight * 0.36)}px`);
	set("--avatar-size", `${shape.avatarSize}px`);

	set("--sidebar-width", `${shape.sidebarWidth}px`);
	set("--rail-width", `${shape.railWidth}px`);
	root.dataset.density = shape.density;
	root.dataset.bubbles = shape.bubbles ? "on" : "off";
	root.dataset.side = shape.sidebarSide;
	// Read by a media-query-free rule in app.css, so turning animations off
	// actually removes the work rather than just shortening it.
	root.dataset.animations = shape.animations ? "on" : "off";
}
