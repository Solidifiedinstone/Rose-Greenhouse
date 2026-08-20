/**
 * The pure logic, tested without a homeserver.
 *
 * Everything here is deliberately separable from the SDK: message grouping,
 * room ordering and theme validation are the rules most likely to be changed
 * for taste, and they should be provable without an account, a network, or a
 * running client.
 */

import { describe, expect, it } from "vitest";

import { hasMarkdown, renderMarkdown } from "../src/lib/matrix/markdown";
import { cryptoPrefix, sessionKey } from "../src/lib/matrix/session";
import {
	GROUPING_WINDOW_MS,
	powerLabel,
	sortMembers,
	type MemberView,
	colourForId,
	formatSize,
	initials,
	markContinuations,
	sortRooms,
	type MessageView,
	type RoomView
} from "../src/lib/matrix/views";
import {
	BUILTIN_THEMES,
	DEFAULT_SHAPE,
	TOKENS,
	avatarPalette,
	clampShape,
	gradientCss,
	parseTheme
} from "../src/lib/theme/tokens";
import { SHAPE_LIMITS } from "../src/lib/theme/shape";
import { PRESENCE_COLOURS, PRESENCE_LABELS } from "../src/lib/matrix/profile.svelte";
import { formatMinutes, inQuietHours, previewFor } from "../src/lib/matrix/notify.svelte";
import { parseRoomTarget, stripReplyFallback } from "../src/lib/matrix/client.svelte";
import {
	EMPTY_EXTRAS,
	cloneExtras,
	decodeFill,
	encodeFill,
	fillBackground,
	sameExtras
} from "../src/lib/matrix/profile.svelte";

function message(partial: Partial<MessageView> & { id: string }): MessageView {
	return {
		roomId: "!room:example.org",
		sender: "@a:example.org",
		senderName: "A",
		senderAvatar: null,
		timestamp: 1_000,
		kind: "text",
		body: "hello",
		html: null,
		mediaUrl: null,
		encryptedFile: null,
		mimeType: null,
		fileSize: null,
		mediaWidth: null,
		mediaHeight: null,
		decryptionFailed: false,
		pending: false,
		failed: false,
		edited: false,
		replyTo: null,
		replyPreview: null,
		reactions: [],
		mine: false,
		continuation: false,
		...partial
	};
}

function room(partial: Partial<RoomView> & { id: string }): RoomView {
	return {
		name: partial.id,
		avatarUrl: null,
		topic: "",
		isDirect: false,
		isSpace: false,
		isEncrypted: false,
		unread: 0,
		highlights: 0,
		lastActivity: 0,
		preview: "",
		spaceIds: [],
		membership: "join",
		...partial
	};
}

describe("message grouping", () => {
	it("tucks a quick follow-up under the message above it", () => {
		const result = markContinuations([
			message({ id: "1", timestamp: 1000 }),
			message({ id: "2", timestamp: 2000 })
		]);
		expect(result[0].continuation).toBe(false);
		expect(result[1].continuation).toBe(true);
	});

	it("starts a new group when someone else speaks", () => {
		const result = markContinuations([
			message({ id: "1", timestamp: 1000 }),
			message({ id: "2", timestamp: 2000, sender: "@b:example.org" })
		]);
		expect(result[1].continuation).toBe(false);
	});

	it("starts a new group after a long gap", () => {
		const result = markContinuations([
			message({ id: "1", timestamp: 1000 }),
			message({ id: "2", timestamp: 1000 + GROUPING_WINDOW_MS + 1 })
		]);
		expect(result[1].continuation).toBe(false);
	});

	it("never groups an emote, because it reads as a sentence about someone", () => {
		const result = markContinuations([
			message({ id: "1", timestamp: 1000 }),
			message({ id: "2", timestamp: 1500, kind: "emote" })
		]);
		expect(result[1].continuation).toBe(false);
	});

	it("leaves already-correct messages untouched, so keyed lists don't churn", () => {
		const input = [message({ id: "1" }), message({ id: "2", timestamp: 2000 })];
		const once = markContinuations(input);
		const twice = markContinuations(once);
		expect(twice[0]).toBe(once[0]);
		expect(twice[1]).toBe(once[1]);
	});
});

describe("room ordering", () => {
	it("puts invites first, however quiet they are", () => {
		const sorted = sortRooms([
			room({ id: "!busy", lastActivity: 9_000, unread: 40 }),
			room({ id: "!invite", membership: "invite", lastActivity: 1 })
		]);
		expect(sorted[0].id).toBe("!invite");
	});

	it("puts a mention above a merely unread room", () => {
		const sorted = sortRooms([
			room({ id: "!unread", unread: 30, lastActivity: 9_000 }),
			room({ id: "!mention", unread: 1, highlights: 1, lastActivity: 10 })
		]);
		expect(sorted[0].id).toBe("!mention");
	});

	it("falls back to recency", () => {
		const sorted = sortRooms([
			room({ id: "!old", lastActivity: 10 }),
			room({ id: "!new", lastActivity: 500 })
		]);
		expect(sorted.map((entry) => entry.id)).toEqual(["!new", "!old"]);
	});

	it("does not mutate what it was given", () => {
		const input = [room({ id: "!a", lastActivity: 1 }), room({ id: "!b", lastActivity: 2 })];
		sortRooms(input);
		expect(input.map((entry) => entry.id)).toEqual(["!a", "!b"]);
	});
});

describe("display helpers", () => {
	it("makes initials from the parts of a name", () => {
		expect(initials("Gavin Rose")).toBe("GR");
		expect(initials("@gavin:example.org")).toBe("GA");
		expect(initials("")).toBe("?");
	});

	it("gives a user the same colour every time, from the theme's palette", () => {
		const palette = avatarPalette(BUILTIN_THEMES[0]);
		expect(colourForId("@a:example.org", palette)).toBe(
			colourForId("@a:example.org", palette)
		);
		expect(palette).toContain(colourForId("@a:example.org", palette));
	});

	it("follows the theme, so avatars never fight the palette", () => {
		const dark = avatarPalette(BUILTIN_THEMES[0]);
		const green = avatarPalette(BUILTIN_THEMES[2]);
		expect(dark).not.toEqual(green);
		expect(green).toContain(colourForId("@a:example.org", green));
	});

	it("derives a palette for a theme that supplies none", () => {
		const derived = avatarPalette({ ...BUILTIN_THEMES[0], avatars: undefined });
		expect(derived.length).toBeGreaterThan(3);
		expect(derived.every((colour) => colour.startsWith("hsl("))).toBe(true);
	});

	it("never divides by an empty palette", () => {
		expect(colourForId("@a:example.org", [])).toBeTruthy();
	});

	it("formats file sizes the way a person reads them", () => {
		expect(formatSize(512)).toBe("512 B");
		expect(formatSize(1536)).toBe("1.5 KB");
		expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
	});
});

describe("notifications", () => {
	it("has a distinct colour and label for every presence, DND included", () => {
		for (const key of ["online", "dnd", "unavailable", "offline"] as const) {
			expect(PRESENCE_LABELS[key]).toBeTruthy();
			expect(PRESENCE_COLOURS[key]).toBeTruthy();
		}
		// DND has to be visually distinct from away, or the whole point is lost.
		expect(PRESENCE_COLOURS.dnd).not.toBe(PRESENCE_COLOURS.unavailable);
		expect(PRESENCE_COLOURS.dnd).toContain("danger");
	});

	it("summarises a message without leaking an encrypted one", () => {
		expect(
			previewFor({
				isDecryptionFailure: () => true,
				isRedacted: () => false,
				getContent: () => ({ body: "secret" })
			} as never)
		).toBe("Encrypted message");
	});

	it("describes attachments rather than printing a filename alone", () => {
		const image = previewFor({
			isDecryptionFailure: () => false,
			isRedacted: () => false,
			getContent: () => ({ msgtype: "m.image", body: "cat.png" })
		} as never);
		expect(image).toContain("cat.png");
	});

	it("truncates a long message instead of filling the screen", () => {
		const long = previewFor({
			isDecryptionFailure: () => false,
			isRedacted: () => false,
			getContent: () => ({ body: "x".repeat(400) })
		} as never);
		expect(long.length).toBeLessThanOrEqual(140);
	});
});

describe("quiet hours", () => {
	const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);

	it("is off unless enabled", () => {
		expect(inQuietHours({ enabled: false, from: 0, to: 24 * 60 - 1 }, at(3))).toBe(false);
	});

	it("handles a window inside one day", () => {
		const quiet = { enabled: true, from: 9 * 60, to: 17 * 60 };
		expect(inQuietHours(quiet, at(12))).toBe(true);
		expect(inQuietHours(quiet, at(8))).toBe(false);
		expect(inQuietHours(quiet, at(17))).toBe(false);
	});

	it("handles a window that wraps past midnight, which is the usual case", () => {
		const quiet = { enabled: true, from: 23 * 60, to: 7 * 60 };
		expect(inQuietHours(quiet, at(23, 30))).toBe(true);
		expect(inQuietHours(quiet, at(2))).toBe(true);
		expect(inQuietHours(quiet, at(6, 59))).toBe(true);
		expect(inQuietHours(quiet, at(7))).toBe(false);
		expect(inQuietHours(quiet, at(12))).toBe(false);
	});

	it("treats an empty window as off rather than as all day", () => {
		expect(inQuietHours({ enabled: true, from: 600, to: 600 }, at(10))).toBe(false);
	});

	it("formats minutes as a clock time", () => {
		expect(formatMinutes(0)).toBe("00:00");
		expect(formatMinutes(23 * 60 + 5)).toBe("23:05");
	});
});

describe("accounts", () => {
	/*
	 * The crypto prefix is the thing that keeps two signed-in accounts from
	 * sharing one device-key store. A collision there does not fail loudly —
	 * it quietly stops either account decrypting — so it gets a test.
	 */
	const session = (user: string, device: string) => ({
		homeserver: "https://example.org",
		user_id: user,
		device_id: device,
		access_token: "x"
	});

	it("keys a session by user and device, not user alone", () => {
		expect(sessionKey(session("@a:example.org", "AAA"))).not.toBe(
			sessionKey(session("@a:example.org", "BBB"))
		);
	});

	it("gives every account a distinct crypto store", () => {
		const one = cryptoPrefix(session("@a:example.org", "AAA"));
		const two = cryptoPrefix(session("@b:example.org", "AAA"));
		const same = cryptoPrefix(session("@a:example.org", "BBB"));
		expect(new Set([one, two, same]).size).toBe(3);
	});

	it("produces a prefix safe for a database name", () => {
		const prefix = cryptoPrefix(session("@a:example.org", "AA/BB:CC"));
		expect(prefix).toMatch(/^[a-zA-Z0-9-]+$/);
	});
});

describe("markdown", () => {
	/*
	 * The security property of the renderer is that it escapes before it
	 * formats. These tests exist to keep that ordering — reversing it would
	 * make every message an injection.
	 */
	it("escapes HTML before formatting, so markup in a message is inert", () => {
		const html = renderMarkdown('<img src=x onerror="alert(1)">');
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	it("refuses a javascript: link", () => {
		const html = renderMarkdown("[click](javascript:alert(1))");
		// No anchor is the property that matters. The literal text is left
		// visible on purpose — silently deleting what somebody wrote would be
		// worse than showing an inert string.
		expect(html).not.toContain("<a");
		expect(html).toContain("javascript:alert(1)");
	});

	it("refuses a data: link", () => {
		const html = renderMarkdown("[x](data:text/html,<script>)");
		expect(html).not.toContain("<a");
		expect(html).not.toContain("<script>");
	});

	it("does not format inside a code span", () => {
		const html = renderMarkdown("`**not bold**`");
		expect(html).toContain("<code>");
		expect(html).not.toContain("<strong>");
	});

	it("handles the everyday formatting", () => {
		expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
		expect(renderMarkdown("*italic*")).toContain("<em>italic</em>");
		expect(renderMarkdown("~~gone~~")).toContain("<del>gone</del>");
		expect(renderMarkdown("> quoted")).toContain("<blockquote>");
		expect(renderMarkdown("- one")).toContain("<li>one</li>");
		expect(renderMarkdown("1. one")).toContain("<ol>");
	});

	it("keeps an unterminated code fence rather than swallowing it", () => {
		expect(renderMarkdown("```\nhalf typed")).toContain("half typed");
	});

	it("only claims markdown when there is some", () => {
		expect(hasMarkdown("just text")).toBe(false);
		expect(hasMarkdown("**bold**")).toBe(true);
		expect(hasMarkdown("`code`")).toBe(true);
	});
});

describe("members", () => {
	const member = (partial: Partial<MemberView> & { userId: string }): MemberView => ({
		name: partial.userId,
		avatar: null,
		power: 0,
		membership: "join",
		presence: "unknown",
		...partial
	});

	it("names the conventional power levels and shows unusual ones raw", () => {
		expect(powerLabel(100)).toBe("Admin");
		expect(powerLabel(50)).toBe("Moderator");
		expect(powerLabel(0)).toBe("");
		// A room may use any number; forcing it into a name would misdescribe it.
		expect(powerLabel(25)).toBe("Level 25");
	});

	it("sorts joined before invited, then by power, then by name", () => {
		const sorted = sortMembers([
			member({ userId: "@z", name: "Zoe" }),
			member({ userId: "@i", name: "Ivy", membership: "invite" }),
			member({ userId: "@a", name: "Ann", power: 100 }),
			member({ userId: "@m", name: "Moe", power: 50 })
		]);
		expect(sorted.map((m) => m.name)).toEqual(["Ann", "Moe", "Zoe", "Ivy"]);
	});
});

describe("joining a room", () => {
	/*
	 * People paste links far more often than they type aliases, so the link
	 * forms have to work. Everything here is a real shape somebody will paste.
	 */
	it("takes a plain alias or room id", () => {
		expect(parseRoomTarget("#room:example.org")).toBe("#room:example.org");
		expect(parseRoomTarget("!abc123:example.org")).toBe("!abc123:example.org");
		expect(parseRoomTarget("  #room:example.org  ")).toBe("#room:example.org");
	});

	it("unwraps a matrix.to link", () => {
		expect(parseRoomTarget("https://matrix.to/#/#room:example.org")).toBe("#room:example.org");
		expect(parseRoomTarget("https://matrix.to/#/!abc:example.org?via=example.org")).toBe(
			"!abc:example.org"
		);
	});

	it("decodes a percent-encoded link, which is how they're usually shared", () => {
		expect(parseRoomTarget("https://matrix.to/#/%23room%3Aexample.org")).toBe(
			"#room:example.org"
		);
	});

	it("understands matrix: URIs", () => {
		expect(parseRoomTarget("matrix:r/room:example.org")).toBe("#room:example.org");
		expect(parseRoomTarget("matrix:roomid/abc:example.org")).toBe("!abc:example.org");
	});

	it("refuses anything that isn't a room, rather than trying it", () => {
		expect(parseRoomTarget("")).toBeNull();
		expect(parseRoomTarget("just some words")).toBeNull();
		expect(parseRoomTarget("@someone:example.org")).toBeNull();
		expect(parseRoomTarget("https://matrix.to/#/@someone:example.org")).toBeNull();
	});
});

describe("reply fallbacks", () => {
	/*
	 * Matrix prefixes a reply's body with a quoted copy of what it answers, so
	 * clients that don't implement replies still show context. A client that
	 * renders the quote itself has to strip it, or every reply shows the
	 * original twice.
	 */
	it("strips the quoted block from a reply body", () => {
		const body = "> <@a:example.org> original text\n\nmy answer";
		expect(stripReplyFallback(body)).toBe("my answer");
	});

	it("strips a multi-line quote", () => {
		const body = "> <@a:example.org> line one\n> line two\n\nanswer";
		expect(stripReplyFallback(body)).toBe("answer");
	});

	it("leaves an ordinary message alone", () => {
		expect(stripReplyFallback("just a message")).toBe("just a message");
	});

	it("keeps a quote the user actually typed themselves", () => {
		// No blank line and no reply relation: this is someone quoting by hand,
		// and eating their text would be worse than showing it.
		expect(stripReplyFallback("not a reply > with an angle bracket")).toBe(
			"not a reply > with an angle bracket"
		);
	});
});

describe("profile fills", () => {
	it("round-trips a gradient", () => {
		const fill = { kind: "gradient" as const, from: "#112233", to: "#445566", angle: 45 };
		expect(decodeFill(encodeFill(fill))).toEqual(fill);
	});

	it("treats 'none' as empty, so an unstyled profile stores nothing", () => {
		expect(encodeFill({ kind: "none", from: "", to: "", angle: 160 })).toBe("");
	});

	it("refuses colours that could escape the CSS declaration", () => {
		const hostile = decodeFill("flat|red;background:url(evil)||160");
		expect(hostile.from).toBe("");
	});

	it("falls back to a safe fill for junk from someone else's profile", () => {
		expect(decodeFill("not-a-fill").kind).toBe("none");
		expect(decodeFill(undefined).kind).toBe("none");
		expect(decodeFill("<script>|#fff||0").kind).toBe("none");
	});

	it("clamps the gradient angle", () => {
		expect(decodeFill("gradient|#112233|#445566|9999").angle).toBeLessThanOrEqual(360);
		expect(decodeFill("gradient|#112233|#445566|-40").angle).toBeGreaterThanOrEqual(0);
	});

	it("leaves the viewer's theme alone when a fill is unset", () => {
		expect(fillBackground({ kind: "none", from: "", to: "", angle: 0 }, "var(--raised)")).toBe(
			"var(--raised)"
		);
	});
});

describe("profile save gating", () => {
	/*
	 * The Save button is disabled unless `sameExtras` reports a difference, so
	 * a field it forgets is a field you can edit and never save. That is the
	 * bug this guards: colours and gradients were editable, updated the card
	 * live, and Save stayed greyed out.
	 *
	 * Driven off Object.keys so adding a field to Extras fails here until it
	 * is actually compared.
	 */
	const base = { ...EMPTY_EXTRAS };
	const changes: Record<keyof typeof base, unknown> = {
		banner: "mxc://example.org/abc",
		about: "hello",
		pronouns: "they/them",
		text: "#123456",
		font: "rubik",
		card: { kind: "gradient", from: "#111111", to: "#222222", angle: 90 },
		name: { kind: "flat", from: "#abcdef", to: "", angle: 160 }
	};

	it("notices a change to every field of a profile", () => {
		for (const key of Object.keys(base) as (keyof typeof base)[]) {
			const edited = { ...base, [key]: changes[key] } as typeof base;
			expect(sameExtras(base, edited), `${key} is not compared`).toBe(false);
		}
	});

	it("covers every field that exists, so a new one can't be forgotten", () => {
		expect(Object.keys(changes).sort()).toEqual(Object.keys(base).sort());
	});

	it("reports identical profiles as unchanged", () => {
		expect(sameExtras(base, cloneExtras(base))).toBe(true);
	});

	it("clones deeply, so editing a copy doesn't touch the original", () => {
		// Started from a real fill: with kind "none" the colours are correctly
		// not part of what gets saved, so changing one is genuinely no change.
		const styled = {
			...base,
			card: { kind: "flat" as const, from: "#112233", to: "", angle: 160 }
		};
		const copy = cloneExtras(styled);
		copy.card.from = "#ff0000";
		expect(styled.card.from).toBe("#112233");
		expect(sameExtras(styled, copy)).toBe(false);
	});

	it("ignores colours on a fill set to 'use my theme'", () => {
		const a = { ...base, card: { kind: "none" as const, from: "#111111", to: "", angle: 0 } };
		const b = { ...base, card: { kind: "none" as const, from: "#999999", to: "", angle: 0 } };
		expect(sameExtras(a, b)).toBe(true);
	});
});

describe("themes", () => {
	it("ships a spread of presets, not just a couple", () => {
		expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(12);
		expect(BUILTIN_THEMES.some((t) => t.scheme === "light")).toBe(true);
		// Blocky and rounded both represented, or "customisable shape" is a
		// claim with nothing behind it.
		expect(BUILTIN_THEMES.some((t) => t.shape.radius === 0)).toBe(true);
		expect(BUILTIN_THEMES.some((t) => t.shape.radius >= 12)).toBe(true);
		expect(BUILTIN_THEMES.some((t) => t.shape.density === "compact")).toBe(true);
	});

	it("gives every preset a complete, clamped shape", () => {
		for (const theme of BUILTIN_THEMES) {
			for (const [key, limit] of Object.entries(SHAPE_LIMITS)) {
				const value = (theme.shape as unknown as Record<string, number>)[key];
				expect(typeof value, `${theme.id}.${key}`).toBe("number");
				expect(value, `${theme.id}.${key}`).toBeGreaterThanOrEqual(limit.min);
				expect(value, `${theme.id}.${key}`).toBeLessThanOrEqual(limit.max);
			}
		}
	});

	it("builds CSS for a gradient and nothing for a half-set one", () => {
		expect(gradientCss({ from: "#111111", to: "#222222", angle: 90 })).toContain(
			"linear-gradient(90deg"
		);
		expect(gradientCss({ from: "#111111", to: "", angle: 90 })).toBe("");
		expect(gradientCss(undefined)).toBe("");
	});

	it("rejects a gradient carrying something that isn't a colour", () => {
		const result = parseTheme({
			id: "mine",
			name: "Mine",
			tokens: BUILTIN_THEMES[0].tokens,
			gradients: { surface: { from: "red;background:url(evil)", to: "#222222", angle: 10 } }
		});
		expect("theme" in result).toBe(true);
		if ("theme" in result) expect(result.theme.gradients).toBeUndefined();
	});

	it("keeps the new behaviour options within their allowed values", () => {
		const shape = clampShape({
			clock: "nonsense" as never,
			sidebarSide: "middle" as never,
			bubbles: "yes" as never
		});
		expect(shape.clock).toBe("24h");
		expect(shape.sidebarSide).toBe("left");
		expect(shape.bubbles).toBe(false);
	});

	it("clamps a shape from outside instead of trusting it", () => {
		const shape = clampShape({ radius: 9999, fontSize: -20, sidebarWidth: 5 });
		expect(shape.radius).toBeLessThanOrEqual(SHAPE_LIMITS.radius.max);
		expect(shape.fontSize).toBeGreaterThanOrEqual(SHAPE_LIMITS.fontSize.min);
		expect(shape.sidebarWidth).toBeGreaterThanOrEqual(SHAPE_LIMITS.sidebarWidth.min);
	});

	it("refuses a font stack that could escape the CSS declaration", () => {
		const shape = clampShape({ fontFamily: 'x; background: url(evil); font-family: y' });
		expect(shape.fontFamily).toBe(DEFAULT_SHAPE.fontFamily);
	});

	it("ships built-ins that each define every token", () => {
		for (const theme of BUILTIN_THEMES) {
			for (const token of TOKENS) {
				expect(theme.tokens[token], `${theme.id} is missing ${token}`).toBeTruthy();
			}
		}
	});

	it("accepts a complete user theme", () => {
		const result = parseTheme({
			id: "mine",
			name: "Mine",
			tokens: BUILTIN_THEMES[0].tokens
		});
		expect("theme" in result).toBe(true);
	});

	it("rejects a theme missing a token, rather than rendering one element wrong", () => {
		const incomplete = { ...BUILTIN_THEMES[0].tokens } as Record<string, string>;
		delete incomplete.accent;
		const result = parseTheme({ id: "mine", name: "Mine", tokens: incomplete });
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error).toContain("accent");
	});

	it("rejects anything that isn't a colour, which is also the CSS injection guard", () => {
		const tokens = { ...BUILTIN_THEMES[0].tokens, accent: "red; background: url(evil)" };
		const result = parseTheme({ id: "mine", name: "Mine", tokens });
		expect("error" in result).toBe(true);
	});

	it("clamps shape values instead of trusting them", () => {
		const result = parseTheme({
			id: "mine",
			name: "Mine",
			tokens: BUILTIN_THEMES[0].tokens,
			shape: { radius: 9999, fontSize: -4 }
		});
		expect("theme" in result).toBe(true);
		if ("theme" in result) {
			expect(result.theme.shape.radius).toBeLessThanOrEqual(40);
			expect(result.theme.shape.fontSize).toBeGreaterThanOrEqual(10);
		}
	});

	it("needs an id and a name", () => {
		expect("error" in parseTheme({ name: "x", tokens: BUILTIN_THEMES[0].tokens })).toBe(true);
		expect("error" in parseTheme({ id: "x", tokens: BUILTIN_THEMES[0].tokens })).toBe(true);
		expect("error" in parseTheme("not a theme")).toBe(true);
	});
});
