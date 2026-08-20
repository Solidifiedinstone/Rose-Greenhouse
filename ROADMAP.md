# Rose Greenhouse — roadmap

Features land **one at a time, finished**, rather than several at once
half-done. That's a deliberate choice: a bug in a client with one new feature
is findable, and a bug in a client with six is a weekend.

Anything not in "Done" is not built. If you're looking for it in the app, it
isn't there yet — see the rule in `CONTRIBUTING.md` about not shipping things
that only look like they work.

---

## Done — v0.1.0, the framework

- Login with `.well-known` homeserver discovery
- Session restored on launch; token held by Rust at `0600`, never in browser storage
- Sync, with the room list ordered invites → mentions → unread → recency
- Read and send messages, with local echo, grouping and scrollback
- End-to-end encryption (Rust crypto stack)
- Device verification by emoji (SAS), in both directions — start it here, or
  answer a request from Element. Unverified devices are told why their history
  is unreadable instead of being left to guess
- Right-click room management: mark read, hide, leave, delete, block/unblock
- Themed default avatar colours, and a blocked-users list in settings
- Theme system: every colour a token, four built-ins, unlimited written ones
- File sending — drag-and-drop, paste, or the paperclip — with per-file
  progress. **Attachments are encrypted client-side in encrypted rooms**, and
  decrypted on read; media never reaches the homeserver in the clear
- Replies, with the quoted original shown inline and the spec's fallback
  stripped so it isn't printed twice
- Emoji reactions, grouped and counted, with a quick picker
- Edit and delete your own messages, with honest wording about what a
  redaction does and doesn't remove
- Create rooms (public or private, encryption decided at creation), join by
  address or pasted link, and browse the public directory
- Member list with power levels, grouped by role
- Markdown composer with live preview, rendered through an escape-first
  pipeline rather than trusting anyone's HTML
- Local search (Ctrl+F) across everything loaded, encrypted rooms included —
  which server-side search cannot do
- Spaces filter the room list
- Private read receipts, globally or per room, using `m.read.private` so your
  own unread counts keep working
- Edit history on any edited message
- Windowed timeline, so a long scrollback doesn't put thousands of rows in
  the DOM
- **Multiple accounts** — sign into several, switch from the status menu, sign
  out of one without touching the rest. Each account gets its own crypto
  store, so device keys can never collide
- Tray icon with the unread count in its tooltip, and a menu to reopen or quit
- Threads — a reply count on the root, and a side panel for the conversation,
  so a long thread never floods the room
- **Scheduled messages** — send at a time, or the next time you're online.
  Local-only, and the UI says so: Matrix has no server-side scheduling, so
  nothing sends while the app is closed
- **Quiet hours** — notifications are held, not dropped, and released as one
  summary when the window ends
- Desktop notifications driven by your Matrix push rules, per-room mute as a
  real push rule, and a DND status that silences everything
- Profile: avatar, banner, about, pronouns, and per-element styling published
  to your public profile where the server supports it
- Theme editor with 14 presets, gradients on every surface, fonts, density,
  bubbles, timestamp format, sidebar side
- Inline images; other attachments listed with size

---

## Next

**Scheduled messages**, then background sync for inactive accounts (level 2
below), then activity status.

---

## Agreed, in rough order

### Table stakes
Nothing below is exotic; the app isn't daily-driveable without them.


### The differentiators
The reasons to use this over Element.

- **Recovery-key restore**, for verifying when this is your only session
- **Local-first search** over your own history, with no server-side index
- **Activity status** — Discord-style presence. Greenhouse-to-Greenhouse via a
  custom account-data event; degrades to plain Matrix presence for everyone else
- **Meshtastic** — chat over LoRa when there's no internet. A separate
  transport, not a Matrix feature, so it comes late and probably as its own
  bridge process

### Performance, for the decade-old-machine goal
- Virtualised room list, and a true virtualised timeline (the current one is
  windowed, which bounds the DOM but still keeps every view in memory)
- Sliding sync (MSC3575), which makes login on a large account near-instant
- Low-power mode: no animations, no image autoload

### Later
- Voice, video and screen sharing, not capped to Discord's resolutions
- Self-hosting a homeserver from a button
- Android build (Tauri v2 targets it from this codebase)
- Profile customisation: banners, animated avatars, about me, notes

---

## Explicitly not doing

- **Room export.** Declined.
- **Per-room theme overrides.** Declined — the theme is a property of the
  client, not of a room.
- **Discord interop.** Viewing real Discord servers needs either a user-token
  self-bot, which violates Discord's ToS and gets accounts banned, or a
  Matrix↔Discord bridge. Not in scope for now; if it returns, it returns as
  the bridge.
- **Analytics, telemetry, crash reporting, update pings.** Never, and not
  behind a toggle.

---

## Note: multiple accounts at once

Worth writing down because it's the one feature that shapes the architecture,
and it gets much more expensive the later it's done.

**What it means.** Being signed into several Matrix accounts — say a personal
one and a work one on different homeservers — at the same time, in one window.
Both sync, both notify, and you switch between them without logging out.
Discord actively fights this; Element makes you use separate profiles or
separate browsers.

**Three levels, increasingly useful:**

1. **Switching** — a picker in the rail, one account visible at a time. Only
   the active account syncs. Cheapest, and already 80% of the benefit for
   someone who just wants to stop logging in and out.
2. **Background sync** — every account syncs at once, so unread counts and
   notifications are live for all of them even while you're looking at one.
   This is where it starts being genuinely nice and where the cost appears:
   several sync loops, several crypto stores, several times the memory.
3. **Unified view** — one merged room list across accounts, with each room
   badged by which account it belongs to. Nicest to use, most confusing to get
   right: every action must carry "which account is this?" with it, and
   getting that wrong sends a message from the wrong identity.

**Why it shapes the architecture.** Right now `client.svelte.ts` holds a single
module-level `client` and a single `mx` state object. Multi-account means both
become a keyed collection, and every function that currently reads the ambient
client takes an account id instead. That's a mechanical change, but it touches
every call site — which is why it is much cheaper to do before there are forty
features calling into it than after.

**Where this got to:** level 1 is built. Several accounts can be signed in,
you switch from the status menu, and signing out of one leaves the others
alone. Only the active account syncs.

Level 2 — every account syncing at once, so unread counts and notifications
are live for all of them — is next. Level 3 only if it turns out to be
wanted; the badging complexity may not be worth it.

**The hazard, and what was done about it:** each account needs its own crypto
store, or two accounts' device keys collide and neither decrypts correctly —
silently. Every client is created with a `cryptoDatabasePrefix` derived from
user id *and* device id, and there is a test asserting those prefixes are
distinct. Sessions live in one `sessions.json` at `0600`, so "which account
was I using?" is answered atomically with the list itself.
