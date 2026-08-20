# Contributing to Rose Greenhouse

## The two rules that matter

**1. Nothing may only look like it works.**

If a button is in the UI, it does the thing. No placeholder screens, no
progress bars backed by a timer, no settings toggle that writes a value
nothing reads. A client that looks 80% finished and is 20% finished costs
more time than one that looks exactly as finished as it is.

The corollary: `README.md` has a "what isn't built yet" section, and it is
load-bearing. Add to it rather than quietly shipping a stub.

**2. Failures are reported, never swallowed.**

An empty room list and a failed connection look identical to a user, so they
must not look identical in the code. No bare `catch {}` that hides a real
error — if a failure genuinely doesn't matter, say so in a comment and log it.

## Architecture rules

These two are enforced by the design and are easy to break by accident:

**No SDK object enters reactive state.** `Room`, `MatrixEvent` and
`RoomMember` are large, mutable, and full of back-references. Putting one in
`$state` deep-proxies it, which is slow and confuses an SDK that expects to
own its own objects. Flatten to a `RoomView` / `MessageView` in
`src/lib/matrix/views.ts` first.

**No component writes a literal colour.** Every colour is a `--token` set by
the theme system. If you need a colour that doesn't exist, add a token to
`TOKENS`, give every built-in theme a value for it, and the tests will hold
you to it. One hardcoded hex makes every theme wrong in that one place.

**Coalesce rebuilds.** A single sync fires hundreds of events. Schedule work
on a frame (`scheduleRoomRebuild`) rather than doing it per event — that's the
difference between idle and a pinned CPU core.

## Getting set up

```sh
git clone <this repo> ~/rose-greenhouse
cd ~/rose-greenhouse
npm install
npm run tauri dev
```

Before pushing:

```sh
npm test        # pure logic, no homeserver needed
npm run check   # types and Svelte, must be 0 errors
```

Linux build deps: `webkit2gtk-4.1`, `gtk3`, `librsvg`, `libappindicator-gtk3`.

`npm run tauri build` bundles a `.deb` and an `.rpm`. **AppImage is
deliberately not a default target**: its packer shells out to `patchelf`,
which is absent on a plain system and on most CI runners, and a default that
fails on a clean machine is not a default. Install `patchelf` and run
`npm run tauri build -- --bundles appimage` if you want one.

## Nothing may be specific to one machine

Fonts are the example that bit us. The font pickers were once a hand-written
list copied from one developer's `fc-list`, so on anyone else's machine most
entries matched nothing, the browser fell back silently, and the setting
looked broken. `src/lib/theme/fonts.ts` now measures which families actually
render before offering them.

The same rule applies to paths, hostnames and hardware assumptions: if it
only works because of how your box happens to be set up, it is a bug.

## Testing

Anything that can be tested without a homeserver, should be. Message grouping,
room ordering, theme validation and formatting all live in pure modules
precisely so they're testable — put new rules there rather than inside a
component.

Things that genuinely need a server are tested by hand for now; a Synapse in a
container is on the list.

## Scope

Features land one at a time, finished, rather than several at once half-done.
If you want to start something from the roadmap, say so first so two people
don't build the same thing differently.

## Privacy

No analytics, no telemetry, no crash reporting, no update pings — ever, and
not behind a toggle. The app talks to the user's homeserver and to nothing
else. A pull request that adds a third-party network call will be declined on
principle, not on implementation.

---

*Part of R.O.S.E. — Rose Open Source Endeavours.*
