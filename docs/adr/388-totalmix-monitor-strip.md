# ADR-388: TotalMix Monitor Strip in Main UI

## Status
**Superseded** by ADR-423 (2026-08-27).

The strip itself survives; what this ADR got wrong is everything behind
it. Levels no longer come from the Max Utility patch on 11003, they are
no longer `0..1` (the whole path speaks **dB**), and the "read-only
mirror, no write-back path" premise below is gone — the faders write, and
the bridge owns the UDP conversation with the mixer directly. The claim
that "the chain stops at 11004" is likewise retired: this repo now talks
to TotalMix FX itself.

## Context

The Max Utility patch reads RME TotalMix monitor levels (room, playback,
click, phones, main) and historically pushed them to a Max-for-Live
device for display, sending bare-word messages (`roomdisplay 0.75`) over
UDP to port 5000 — entirely outside the Looping bridge.

We wanted those levels visible in the SvelteKit interface instead of a
separate M4L device. This is a read-only mirror: the values originate in
Max (from the hardware mixer), and the UI only displays them — there is
no write-back path. ADR-104's send-only `/totalmix/*` outbound sliders
were superseded and are unrelated to this inbound display.

Two placement questions arose: which inbound route the patch should use,
and where the values should surface in the UI.

## Decision

**Inbound route — reuse the Max Observer port.** The patch emits OSC
addresses `/looping/v3/totalmix/<channel>` (`channel` ∈ room, playback,
click, phones, main) with a single float arg (0.0–1.0), sent to the
bridge's Max Observer **receive** port (`localPort` 11003, *not* the
11002 send port — the port pair in `constants.json` reads send/recv).
The maxObserver port is already an `INBOUND_SOURCE`, so inbound packets
broadcast to the browser with no new routing rule and no `constants.json`
change. The values originate in Max, so routing through the Python
surface would be pointless indirection; a dedicated new port was rejected
as port proliferation (consistent with ADR-104's reasoning).

**UI path — mirror the meter pattern.** A handler
(`handlers/v3TotalMix.ts`) matches the `/looping/v3/totalmix/` prefix,
parses the float, and writes a `SvelteMap`-backed store
(`stores/v3/totalmix.svelte.ts`) keyed by channel. The handler is
registered in `simpleClient.ts` next to the meter handler. This is the
same find→store→`$derived` shape as the v3 output meters.

**Display — compact strip in the persistent main UI.** A
`TotalMixStrip.svelte` component renders 5 cells in a row, each a single
letter (R/P/C/H/M) with a vertical fill behind it, mounted under the loop
brace control in the 120px right sidebar (inside
`VerticalLoopControl.svelte`'s flex-column wrapper). Cyan fill; the cell
background and letter color are theme-aware (dark slate / light letters
in dark mode, cream track / dark letters in light mode). An earlier
larger card lived in `SystemCentralView.svelte`, but it forced a 4th grid
column that overflowed the central view's width budget at 1366px, so it
was removed in favor of the always-visible corner strip.

## Consequences

**Positive**
- TotalMix levels are always visible in the main UI, no separate M4L
  device needed.
- Zero new ports / no `constants.json` change; reuses existing inbound
  infrastructure and the established meter-display pattern.
- Read-only, so no echo-loop or bidirectional-sync complexity.

**Negative**
- The patch must target 11003 specifically; the send/recv port-pair
  convention is an easy thing to get wrong (we initially sent to 11002,
  which the bridge does not listen on).
- Single-letter labels are terse (Phones → H, since P is Playback) —
  legible but not self-documenting.
- Channel set is fixed in two places (store `TOTALMIX_CHANNELS` and the
  strip's letter map); adding a channel touches both.

## Tags
`totalmix`, `rme`, `max-patch`, `osc`, `bridge`, `ui`, `read-only-mirror`,
`main-ui`, `theme-aware`

## Update — 2026-08-21: writable in the transport header

The read-only decision above still holds for the right-sidebar instance,
and held for every instance until the transport header was rebuilt as a
full-width band. With the header up, the strip moves into it (which
hands the master fader back the height it was taking) and its cells
become **faders**: a drag writes `/totalmix/<channel>` outbound, which
the bridge already routes to the MIDI-converter port (11004) — ADR-104's
send path, unused since that ADR was superseded, reused rather than
reinvented.

**The chain stops at 11004.** Nothing in this repo reaches TotalMix FX:
ADR-104 named the port and left "external OSC receivers on port 11004"
as someone else's job, and that receiver was never built. So the Max
Utility patch owns the last hop — a `udpreceive 11004`, then whatever
it already uses to reach the mixer (TotalMix's own OSC remote-control
port, or MIDI CC to the mapped fader). Two traps on that side: the patch
also *sends* levels on 11003, so an incoming value that drives a slider
which re-sends will fight the drag (`set $1`, not a value message); and
the inbound half is a display mirror, so a channel the patch can read is
not automatically one it can write. The inbound mirror is unchanged and still reconciles the
value; the drag applies optimistically so the cell tracks the finger
rather than the mixer's answer rate.

Two things are deliberate:

- **Slow.** `totalmixDrag.ts` maps 400px of travel to the full range
  (~0.25%/px). The cells are ~48px tall in the header, so mapping the
  range onto their own height would put the whole monitor level inside
  an inch of finger — on a control that sets what a room hears.
- **Channel names follow the inbound mirror** (`room`, `playback`,
  `click`, `phones`, `main`), not ADR-104's older outbound set
  (`room_mic`, `playback`, `click`, `volume`). The patch that sends the
  mirror is the one expected to receive these; if it listens on the
  older names instead, that is the mapping to fix.

