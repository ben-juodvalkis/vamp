# ADR-407: Wah Pedal Control on the v3 Python Surface

## Status
**Accepted** — supersedes [ADR-094](094-wah-pedal-real-time-control.md).

## Context

ADR-094 gave the wireless wah pedal real-time control via two OSC endpoints
(`/looping/wah/load`, `/looping/wah`) implemented in
`ableton/scripts/liveAPI-v6.js`, keyed off a `wahDeviceCache` indexed by
selected-track. The v3 Python Control Surface migration (2026-04) collapsed
the wire to a single Python backend with positional-path identity and gutted
`liveAPI-v6.js` to an inert legacy carrier — so ADR-094's implementation no
longer carries any traffic. The pedal needed re-homing on the surface.

The constraint that shapes the design: the pedal's MIDI reaches us through a
standalone Max patch (MIDI→OSC), and that patch has no way to know "the
selected track" or where a freshly-loaded rack lands in the device chain.
That state only flows on the surface→bridge broadcast path, and
`osc_transport` deliberately does **not** last-sender-win broadcasts back to
ephemeral senders (the foot-trigger / permute pattern). So the Max side
cannot address a device path the way the UI can.

## Decision

Own the wah entirely on the surface in `WahPedalComponent`, mirroring
`FootTriggerComponent`'s "hardware sends intent, surface resolves context"
shape. Two arg-light wires, sent direct to UDP 11020:

- **`/looping/v3/wah/engage`** (arg-free) — read `song.view.selected_track`;
  no wah rack on it → load `Wah.adg` (loads enabled) and move it to chain top;
  already loaded → toggle Macro 2 (`toggleMacroIndex`) between 0 and 127
  (currently 0 → 127, else → 0).
- **`/looping/v3/wah/freq [0-127]`** — write the rack's freq macro (Macro 1).
  Raw value clamped to the macro's own range (0-127 CC → 0-127 macro, 1:1).
  The macro ref is cached and **scoped to the selected track**: a
  `selected_track` listener drops the cache on every selection change, so the
  sweep always re-resolves against the track in view (or no-ops if it has no
  wah). A stale ref (rack removed / set reloaded) also re-resolves. See the
  2026-07-24 revision below — the sweep originally stayed glued to the
  last-*engaged* track until a re-engage.

The rack is re-found by `class_name` + `name` (mirrors `fxGridStore`), not by
a stored index. Target rack, macro index, and match keys live in
`constants.devices.wah`, tunable without code.

**Rejected — raw `device/load` + `param/set` from Max.** Would force the Max
patch to track the selected track and the post-append device index over the
broadcast channel it isn't on; repeated `device/load` stacks duplicate racks
(append, no dedupe); a hardcoded param index breaks on reorder.

**`engage`-when-loaded evolved** across iterations — toggling Device On off
on repeat, then a monotonic-on Device On re-arm — and landed on toggling
**Macro 2** between 0 and 127, the macro the performer foot-maps on the rack.
Both macro indices (`freqMacroIndex`, `toggleMacroIndex`) are config so the
mapping is tunable and runtime-verifiable.

## Consequences

- The Max patch stays as dumb as `foot-trigger.js`: two `udpsend … 11020`
  messages, no trackPath, device index, generation, or listening.
- Freq writes echo through the normal `param/value` path, so the UI macro
  slider tracks the pedal.
- **Move-to-top on load** (restores ADR-094's `moveToTopOnLoad`). When engage
  *loads* the wah it's moved to chain position 0 — a wah usually sits before
  drive / dynamics. The load is async, so a one-shot flag defers the
  `song.move_device` (the same primitive as `/looping/v3/device/move_to_top`)
  to the first resolve of the materialized rack, from a handler context (not
  a LOM notification). Only a *load* arms it, so a hand-placed or saved-set
  wah is left where the user put it. Always on — no config flag.
- `freqMacroIndex` is config-driven, defaults to 1 (`parameters[0]` is Device
  On), and is bounds-guarded so a bad index no-ops rather than driving the
  wrong parameter. Verify against a live state dump before trusting it.
- BLE MIDI doesn't auto-reconnect on macOS, so `npm run ipad` opens Audio
  MIDI Setup during startup for a manual connect.
- Wire contract: `docs/reference/wire-protocol.md` §2.10.1. Component notes:
  `surface/CLAUDE.md`. 26 unit tests in `test_wah_pedal_component.py`.

## Revision (2026-07-24): freq sweep follows selection

**Original rule:** the freq cache re-targeted only on a re-engage (toe-switch)
or when the cached ref went stale. Changing the selected track alone did
*not* move the sweep — you could engage a wah on Track A, select Track B, and
the expression pedal would keep sweeping Track A's wah. This was deliberate
(it let you sweep one track's wah while looking at another), and documented as
such in the component docstring.

**Problem:** in practice this reads as cross-track pollution. The operator's
mental model is "OSC values apply to the current track" — moving the pedal
should never touch a track you've navigated away from, and adding a wah to a
new track shouldn't inherit a binding from the old one. The decoupled-sweep
workflow the original rule enabled wasn't wanted.

**Change:** `WahPedalComponent` now attaches a `song.view` `selected_track`
listener (the same idiom as `SelectedTrackComponent` / `ExclusiveArmComponent`,
with guarded detach on `disconnect`). On every selection change it drops the
cached freq macro **and** any armed move-to-top flag. The next expression-pedal
frame re-resolves the wah on the track now in view — or no-ops if that track
carries no wah. The hot path is unchanged *within* a track (still cached, no
per-message chain walk); the walk happens once per selection change, which is
cheap. Clearing move-to-top means loading a wah then navigating away before it
resolves abandons the auto-move, so a hand-placed wah on the newly-selected
track is never yanked to chain top.

**Tradeoff accepted:** you can no longer sweep Track A's wah while viewing
Track B — re-select A to drive its wah. This is the intended semantics: the
sweep is always scoped to the current track.

## Revision (2026-08-27): startup no longer opens Audio MIDI Setup

The consequence above — "`npm run ipad` opens Audio MIDI Setup during startup
for a manual connect" — no longer holds. That launch was removed from
`scripts/setup-ipad.js`; `npm run dev` never had it.

Nothing about the wah pedal itself changed: BLE MIDI still doesn't
auto-reconnect on macOS, so the pedal still needs a manual connect in the
Bluetooth panel of Audio MIDI Setup before Max can read its CoreMIDI port.
That's now a step you take yourself when you want the pedal, rather than a
window every session opened whether or not the pedal was in play.

## Tags
`wah`, `pedal`, `midi`, `osc`, `control-surface`, `hardware`, `supersedes-094`
