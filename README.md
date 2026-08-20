# Rose Greenhouse

A Matrix client with a familiar layout, theming that goes all the way down,
and nothing phoning home.

Matrix is the open protocol; Greenhouse is one way of looking at it. The
layout will feel obvious if you've used Discord — a rail of spaces, a room
list, a conversation, a composer — because that layout is genuinely good and
there is no prize for being different at the user's expense.

> **Status: v0.1.0 — the framework.** It logs in, syncs, lists rooms, reads
> and sends messages, and handles end-to-end encrypted rooms. Everything else
> on the roadmap is honestly labelled as not built yet. Nothing in this app is
> a mock: if a button is there, it does the thing.

---

## What works right now

- **Log in** to any homeserver, with `.well-known` discovery, so "matrix.org"
  or "my.server" both do the right thing
- **Stay logged in** — the session is restored on launch
- **Sync**, with the room list ordered by invites, then mentions, then unread,
  then recency
- **Read and send messages**, with local echo, grouping, and infinite
  scrollback
- **End-to-end encryption**, via the Rust crypto stack — encrypted rooms are
  readable rather than a wall of padlocks
- **Four built-in themes and unlimited written ones** — every colour in the
  interface is a token, so a theme you write is exactly as powerful as a
  built-in one
- **Attachments** render inline for images and are listed with size for
  everything else

## What isn't built yet

Named plainly, because a roadmap that reads like a feature list is how
projects end up looking finished and being hollow. **See `ROADMAP.md`** for
the full list, what's agreed, and what's been ruled out.

The short version: device verification · replies, threads and reactions ·
editing and deleting · file uploads · room creation and the directory ·
member list · notifications and tray · search · multiple accounts · scheduled
messages · quiet hours · voice, video and screen sharing · activity status ·
Meshtastic · the Android build.

---

## Why this stack

**Tauri v2 + matrix-js-sdk + Svelte 5.**

- Tauri puts the UI in the system webview and the shell in Rust: the binary is
  around 10 MB rather than Electron's 150, and idle memory is a fraction of it.
  That matters for the goal of running on a decade-old machine.
- The webview brings a complete WebRTC stack with it, which is what voice,
  video and screen sharing will be built on. That is the single biggest reason
  not to build this in Qt — hand-wiring WebRTC into a native toolkit is a
  project of its own.
- `matrix-js-sdk` is the most complete Matrix implementation there is, and
  it's the one Element itself uses.
- Svelte compiles away, so there's no framework runtime shipping in the
  bundle. Theming is CSS, which is why a user theme can be a JSON file rather
  than a plugin.
- Tauri v2 targets Android and iOS from this same codebase.

## Where things live

```
src/
  lib/
    matrix/
      client.svelte.ts   client lifecycle, sync, and the reactive state
      views.ts           plain snapshots of SDK objects + the pure rules
      session.ts         talks to Rust about the access token
    theme/
      tokens.ts          the token list, built-in themes, theme validation
      theme.svelte.ts    which theme is on, and remembering it
    components/          the UI
src-tauri/
  src/session.rs         the access token, on disk, owner-only
tests/                   the pure logic, no homeserver required
packaging/               icon, desktop entry, installer
```

Two rules hold the architecture together:

1. **No SDK object ever enters reactive state.** `Room` and `MatrixEvent` are
   large, mutable and full of back-references; proxying them is both slow and
   a good way to confuse the SDK. They're flattened into the small records in
   `views.ts` first.
2. **No component writes a literal colour.** Every one comes from a `--token`.
   The moment one component hardcodes a hex value, every theme is wrong in
   that one spot and nobody can fix it without a rebuild.

## Privacy

- No analytics, no telemetry, no crash reporting, no update pings. The app
  talks to your homeserver and to nothing else.
- The access token is held by the Rust side in the app's config directory with
  `0600` permissions, never in browser storage where any script in the webview
  could reach it. An OS keyring is the next step up and isn't done yet — see
  `src-tauri/src/session.rs` for exactly what today's guarantee is and isn't.
- A strict Content-Security-Policy is set in `tauri.conf.json`. Media and API
  calls are allowed out because that's the job; scripts are not.

## Building it

```bash
git clone <this repo> ~/rose-greenhouse
cd ~/rose-greenhouse
npm install

npm run tauri dev      # develop, with hot reload
npm run tauri build    # a release binary + packages
npm test               # the pure logic
npm run check          # types and Svelte
```

Linux needs `webkit2gtk-4.1`, `gtk3`, `librsvg` and `libappindicator`. On
Arch/Artix: `webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3`. On Debian and
Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev`.

`npm run tauri build` produces a `.deb` and an `.rpm`. AppImage is not built
by default because its packer needs `patchelf`, which is absent on a plain
system and on most CI runners — install it and run
`npm run tauri build -- --bundles appimage` if you want one.

Then put it in your application menu:

```bash
./packaging/install-desktop-entry.sh
```

## Writing a theme

Settings → **Start from current theme** hands you the active theme as JSON.
Change what you like and paste it back. Every one of the tokens must be
present — a theme missing one would leave a single element inheriting a colour
from nowhere, so an incomplete theme is refused with a message naming what's
missing rather than half-applied.

```json
{
  "id": "midnight",
  "name": "Midnight",
  "scheme": "dark",
  "tokens": { "backdrop": "#05060a", "accent": "#7aa2f7", "…": "…" },
  "shape": { "radius": 4, "fontSize": 14, "avatarRounding": 8 }
}
```

`shape` is optional, and controls corner radius, font sizes, message spacing,
font stacks, and whether avatars are circles or squares.

---

*Part of R.O.S.E. — Rose Open Source Endeavours.*
