/**
 * Which theme is on, and editing one without touching a text editor.
 *
 * The editor works on a live draft: every change is applied to the document
 * immediately, so you are always looking at the real thing rather than a
 * preview that might differ. Nothing is saved until you say so, and
 * `discard()` puts back whatever was active before.
 */

import {
	BUILTIN_THEMES,
	DEFAULT_THEME_ID,
	applyTheme,
	clampShape,
	parseTheme,
	type Shape,
	type Gradient,
	type GradientTarget,
	type Theme,
	type TokenName
} from "./tokens";

const STORAGE_KEY = "greenhouse.theme";
const CUSTOM_KEY = "greenhouse.customThemes";

export const themeState = $state({
	activeId: DEFAULT_THEME_ID,
	custom: [] as Theme[],
	/** Non-null while the editor is open. Applied live, saved on demand. */
	draft: null as Theme | null
});

export function allThemes(): Theme[] {
	return [...BUILTIN_THEMES, ...themeState.custom];
}

export function activeTheme(): Theme {
	if (themeState.draft) return themeState.draft;
	return allThemes().find((theme) => theme.id === themeState.activeId) ?? BUILTIN_THEMES[0];
}

export function initTheme(): void {
	if (typeof localStorage !== "undefined") {
		try {
			const stored = localStorage.getItem(CUSTOM_KEY);
			if (stored) {
				const parsed: unknown = JSON.parse(stored);
				if (Array.isArray(parsed)) {
					// Re-validated on the way in, not trusted because we wrote it:
					// the store is user-editable and that is the point.
					themeState.custom = parsed
						.map((entry) => parseTheme(entry))
						.filter((result): result is { theme: Theme } => "theme" in result)
						.map((result) => result.theme);
				}
			}
		} catch (error) {
			console.warn("could not read custom themes", error);
		}

		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved && allThemes().some((theme) => theme.id === saved)) {
			themeState.activeId = saved;
		}
	}
	paint();
}

export function setTheme(id: string): void {
	if (!allThemes().some((theme) => theme.id === id)) return;
	themeState.draft = null;
	themeState.activeId = id;
	if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, id);
	paint();
}

// ── Editing ──────────────────────────────────────────────────────

/** Start editing, seeded from whatever is currently active. */
export function beginEdit(): void {
	const base = activeTheme();
	themeState.draft = {
		...base,
		// A built-in must never be mutated in place: it is the fallback for
		// everything, and a bad edit would have nowhere to fall back to.
		id: base.builtin ? uniqueId(base.id) : base.id,
		name: base.builtin ? `${base.name} (mine)` : base.name,
		builtin: false,
		tokens: { ...base.tokens },
		shape: { ...base.shape },
		gradients: base.gradients ? structuredClone(base.gradients) : undefined,
		avatars: base.avatars ? [...base.avatars] : undefined
	};
	paint();
}

export function editing(): boolean {
	return themeState.draft !== null;
}

export function setToken(token: TokenName, value: string): void {
	if (!themeState.draft) return;
	themeState.draft.tokens[token] = value;
	paint();
}

export function setShape(patch: Partial<Shape>): void {
	if (!themeState.draft) return;
	themeState.draft.shape = clampShape({ ...themeState.draft.shape, ...patch });
	paint();
}

/** Set or clear one surface's gradient. Null removes it. */
export function setGradient(target: GradientTarget, gradient: Gradient | null): void {
	if (!themeState.draft) return;
	const current = { ...(themeState.draft.gradients ?? {}) };
	if (gradient) current[target] = gradient;
	else delete current[target];
	themeState.draft.gradients = Object.keys(current).length ? current : undefined;
	paint();
}


export function setDraftName(name: string): void {
	if (themeState.draft) themeState.draft.name = name;
}

export function setScheme(scheme: "dark" | "light"): void {
	if (!themeState.draft) return;
	themeState.draft.scheme = scheme;
	paint();
}

/** Replace the draft's colours with another theme's, keeping the shape. */
export function borrowColours(fromId: string): void {
	const source = allThemes().find((theme) => theme.id === fromId);
	if (!source || !themeState.draft) return;
	themeState.draft.tokens = { ...source.tokens };
	themeState.draft.avatars = source.avatars ? [...source.avatars] : undefined;
	themeState.draft.scheme = source.scheme;
	paint();
}

/** Replace the draft's shape, keeping the colours. */
export function borrowShape(fromId: string): void {
	const source = allThemes().find((theme) => theme.id === fromId);
	if (!source || !themeState.draft) return;
	themeState.draft.shape = { ...source.shape };
	paint();
}

export function saveDraft(): string | null {
	const draft = themeState.draft;
	if (!draft) return null;
	if (!draft.name.trim()) return "Give it a name first.";

	const index = themeState.custom.findIndex((theme) => theme.id === draft.id);
	const saved: Theme = { ...draft, builtin: false };
	if (index >= 0) themeState.custom[index] = saved;
	else themeState.custom.push(saved);

	persistCustom();
	themeState.draft = null;
	setTheme(saved.id);
	return null;
}

export function discardDraft(): void {
	themeState.draft = null;
	paint();
}

export function addCustomTheme(input: unknown): string | null {
	const result = parseTheme(input);
	if ("error" in result) return result.error;

	const theme = result.theme;
	if (BUILTIN_THEMES.some((builtin) => builtin.id === theme.id)) {
		return `"${theme.id}" is the id of a built-in theme — pick another.`;
	}
	const index = themeState.custom.findIndex((existing) => existing.id === theme.id);
	if (index >= 0) themeState.custom[index] = theme;
	else themeState.custom.push(theme);
	persistCustom();
	return null;
}

export function removeCustomTheme(id: string): void {
	themeState.custom = themeState.custom.filter((theme) => theme.id !== id);
	persistCustom();
	if (themeState.activeId === id) setTheme(DEFAULT_THEME_ID);
}

function uniqueId(base: string): string {
	let candidate = `${base}-mine`;
	let n = 2;
	while (allThemes().some((theme) => theme.id === candidate)) {
		candidate = `${base}-mine-${n}`;
		n += 1;
	}
	return candidate;
}

function persistCustom(): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(CUSTOM_KEY, JSON.stringify(themeState.custom));
}

function paint(): void {
	if (typeof document === "undefined") return;
	applyTheme(activeTheme(), document.documentElement);
}
