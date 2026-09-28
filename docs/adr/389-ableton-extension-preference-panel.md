# ADR-389: Ableton Extension as a Preference Front-End (session toggles)

## Status
**Retired 2026-09-23.** `ableton/extensions/` (this panel and the
`hello-context-menu` sample) was deleted in the general-release audit's
Tier 0: it needed Live Beta's Developer Mode, it vendored the private-beta
Extensions SDK under a license that forbids redistributing it, and every
toggle it offered is also in the iPad's System view and the menubar app.
The decision below is kept as the record of what was built.

*Previously: **Accepted***

## Context

`auto_arm` (exclusive arm-follows-selection) is a session-scoped surface
toggle owned by `SessionSettingsComponent` and enforced by
`ExclusiveArmComponent` on the Python surface. Historically it was *set* from a
Max for Live device that fired `/looping/v3/session/auto_arm $1` at UDP port
11020 — a fire-and-forget write, no UI for current state.

We want to retire that M4L control in favor of a right-click **preference panel**
built as an **Ableton Live Extension** (`@ableton-extensions/sdk`, TypeScript
running in Live's Extension Host — see `ableton/extensions/CLAUDE.md`). The panel
should (a) be reachable from "anywhere" in the Session view, (b) let the user
flip `auto_arm`, and (c) **open already showing the surface's current value**.

Three facts shaped the design:

1. **The SDK has no global context-menu scope.** `ContextMenuScope` (v1.0.0) is
   a closed list of 11 object/selection scopes — no empty-space/application
   scope exists. "Anywhere" can only be approximated by registering on every
   Handle-passing scope.
2. **The SDK exposes no networking**, but an extension is a Node process; Node's
   `dgram` (UDP) works (the SDK sandbox restricts *filesystem*, not loopback
   sockets). This lets the extension mirror the M4L device's wire exactly.
3. **The surface does not reply to the last sender.** `OSCTransport.poll`
   deliberately does *not* adopt the last sender as the broadcast remote (it
   would hijack meters/heartbeats toward ephemeral foot-pedal ports). Broadcasts
   — including the `auto_arm` `emit_on_accept` seed — go to the fixed bridge
   remote (11021). A handler only replies to an ephemeral asker if it **returns
   a tuple** (the reply-to-sender path at the bottom of `_dispatch`).

So *writing* `auto_arm` from the extension is trivial (same wire as M4L).
*Reading* it back required a dedicated reply-to-sender path — the extension
binds an ephemeral UDP port and the surface must answer to *that* port.

## Decision

**Enforcement stays in Python; the extension is purely a front-end.** It never
arms tracks itself, so the two processes can't fight over `track.arm`.

**Surface side — a read-only query address.** Added
`/looping/v3/session/auto_arm/query` →
`SessionSettingsComponent.handle_query_auto_arm`, which returns the current value
as a 1-tuple `(0|1,)`. The existing `_dispatch` reply-to-sender path then sends
the reply **on the same address it received** — i.e. back on
`/looping/v3/session/auto_arm/query` (NOT `/looping/v3/session/auto_arm`) — to
the asker's source port. The client must listen for the answer on the query
address. (Initially the extension listened on the set address and every query
timed out despite the surface replying correctly — caught via a raw UDP probe
that showed the reply arriving on the query address.) It is
read-only: no state mutation, no broadcast `_emit`, args ignored — so it cannot
flip the value or perturb the UI broadcast stream. This reuses an existing
transport mechanism rather than introducing a new reply convention.

**Extension side — `ableton/extensions/looping-prefs/`.**
- `src/osc.ts` — an in-house OSC 1.0 encode/decode matched byte-for-byte to the
  surface's `osc_codec.py` (verified by a round-trip hex check), plus an
  `OscClient` (`dgram`) that binds an ephemeral port, sends to 127.0.0.1:11020,
  and listens for the query reply.
- `src/panel.html` — a Live-themed webview with the `auto_arm` toggle. The SDK
  webview is **one-way** (the page posts out to close+return; the host cannot
  push into an open page), so initial state is **baked into the data-URL** via a
  `__AUTO_ARM_INITIAL__` placeholder substituted before opening.
- `src/extension.ts` — registers one command on all 9 Handle-passing scopes
  (the practical "anywhere"). On open it queries current state (short timeout),
  opens the panel pre-set, and on Save writes `auto_arm [0|1]` to 11020.

**Query timeout = pre-open latency budget, not an expected wait (250ms).** The
surface answers from inside its Live-tick poll loop (tens of ms). Because the
webview can't be updated post-open, the query must precede the open; a short
timeout keeps a present surface imperceptible and an absent/stale one (no
handler → no reply) costs only a blink before opening at the default.

## Consequences

**Positive**
- No duplicated arm logic; Python remains the single enforcer.
- Write path mirrors the retired M4L device — proven working in Live (toggling
  the panel logs `auto_arm DISABLED`/`ENABLED` on the surface).
- The query handler is a tiny, well-tested, read-only addition that reuses the
  transport's existing reply-to-sender path.
- Establishes the pattern for an extension talking to the surface over UDP —
  reusable for future preference panels.

**Negative / watch-outs**
- The extension is now a (minimal) bidirectional v3 client, more than the M4L
  device was. It speaks the raw wire, so it must track `osc_codec.py` /
  `wire-protocol.md` if arg types ever change (today: int-only).
- **Stale-surface gotcha:** Live caches Remote Script bytecode until a full
  restart. The query handler only answers after Live reloads the surface; until
  then the panel opens at the default and the write path still works. (The write
  path needed no new code, so it worked immediately; the read path needs the
  reload.)
- **Orphaned-host gotcha:** `extensions-cli run` spawns a
  `Helpers/ExtensionHost/node` child that Live keeps alive; killing the CLI
  launcher does not reap it, and orphans jam Live's single host slot. Kill
  `pkill -f "Helpers/ExtensionHost/node"` between dev runs. Noted in
  `ableton/extensions/CLAUDE.md`.
- "Anywhere" is really "9 object scopes" — the menu item appears in a lot of
  right-click menus by design.

## Addendum — `move_volume_knob` (second toggle)

The panel was extended to also host `move_volume_knob` (the Ableton Move
first-knob → selected-track volume gate, the other toggle
`SessionSettingsComponent` owns). Same pattern throughout: a mirror
`/looping/v3/session/move_volume_knob/query` read-only handler
(`handle_query_move_volume_knob`, replies on the query address), a second panel
toggle with its own `__MOVE_KNOB_INITIAL__` placeholder, and a `queryToggle`
helper so the extension queries both settings concurrently before opening and
writes each on Save. Verified in Live: both toggles read real state on open and
write on Save. Adding further session toggles is now a repeatable recipe (query
handler + address + register + a panel row + one `queryToggle`/`send` pair).

## Addendum — UI / theming

The panel was redesigned (header + "Session behavior" subtitle, a bordered card
grouping the toggles with row dividers, refined toggle visuals, a primary Save
button, content-fit sizing at 420×300).

**Light/dark follows the macOS system appearance, NOT Live's skin.** The SDK
exposes *no* theme accessor — verified against the SDK's own `index.d.cts`, the
`Environment` class surfaces only `storageDirectory`, `tempDirectory`, and
`language` (locale, e.g. `"EN"`), with nothing for appearance/skin. So the panel
uses `@media (prefers-color-scheme)` with light + dark CSS variable sets, which
the host's WebKit/WebView2 webview honors from the OS setting. Consequence: if a
user runs a light Live skin under macOS dark mode (or vice-versa), the panel
tracks the OS, not Live. Accepted as the only auto-adapt path the SDK allows; a
manual in-panel toggle (persisted to `storageDirectory`) is the fallback if exact
Live-skin matching is ever required. Both themes were verified by rendering the
substituted panel and screenshotting each scheme before shipping.

## Addendum — distribution / install (outside Developer Mode)

Dev mode (`npm start` → `extensions-cli run`) is for iteration only; it doesn't
persist across Live restarts and needs Developer Mode on. For real use:

- `npm run package` (build → `extensions-cli package`) emits a single **`.ablx`**
  archive (bundled `dist/extension.js` + `manifest.json` + any `-i` assets).
  **Always build first — `package` does not run the build.**
- The user **installs the `.ablx` by dropping it onto the Extensions page in
  Live's Settings.** That's the supported install; it does not require Developer
  Mode and survives restarts.
- **No symlink equivalent (unlike the Python surface).** The Remote Script loads
  from a folder Live scans (hence the User-Library symlink to the repo), but
  extensions install through Live's Settings page from an `.ablx`, not from a
  scanned folder we can symlink. So the surface's "symlink the repo into Remote
  Scripts" trick has no analogue — re-package and re-drop the `.ablx` to update an
  installed extension. Keep using dev mode for iteration; package only when
  cutting a build to install.

## Tags
`ableton-extension`, `auto_arm`, `move_volume_knob`, `session-settings`, `osc`,
`reply-to-sender`, `preference-panel`, `extensions-sdk`
