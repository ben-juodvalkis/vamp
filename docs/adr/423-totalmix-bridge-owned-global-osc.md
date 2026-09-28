# ADR-423: TotalMix Monitor Control — Bridge-Owned, Global OSC, dB End to End

## Status
**Accepted** (2026-08-27) — supersedes ADR-388, supersedes ADR-104's send path.

## Context

Monitor control (room / playback / click / phones / main) lived in
`Max Patches/Max Utility 1.0.maxpat`, which is not a Live device at all:
`scripts/setup-ipad.js` opened it in standalone Max on a 4-second
`setTimeout` after Ableton. That patch owned the mixer link end to end —
read the RME state, wrote to it, fanned levels to the bridge on 11003,
took the iPad's writes back on 11004.

Its **writes** were sound: each re-asserted submix and bus in one
comma-separated list before setting a value, so a write was idempotent
regardless of page state.

Its **reads** were a timing hope. The legacy TouchOSC-emulation protocol
has no getter and no stable address — `/1/volume2` means "slot 2 of the
eight-strip window, on whichever row is selected, of whichever submix is
selected". The patch poked the mixer with a page-changing command, waited
for the unsolicited dump that provoked, and caught what it wanted out of
the flood with five `udpreceive 7001` objects latching into message-box
cold inlets, banged in order by a `manydeferlows` chain. Nothing
correlated a reply to a request. Three defects fell out: room read with
no bus selected; reads never pinned the submix; and a knob turn during a
read could make one channel adopt another's level — live during normal
use, because every knob tick triggered a fresh main re-read.

## Measurements

Everything below was measured against the running rig (Babyface Pro,
TotalMix FX 2.10 beta 4) rather than taken from documentation, and each
channel was cross-checked against the legacy protocol's reading of the
same fader.

**Address map.** Global OSC gives every control a stable absolute
address. Indices are zero-based **by the left channel of the pair**
(0 = AN 1/2, 2 = PH 3/4, 4 = AS 1/2):

| Channel  | Address              | Reading at measurement |
|----------|----------------------|------------------------|
| Room     | `/mix/in/1/2/fader`  | −4.11 dB  (input AN 2) |
| Playback | `/mix/pb/0/2/fader`  | −6.64 dB  (playback AN 1/2) |
| Click    | `/mix/pb/2/2/fader`  | −22.32 dB (playback PH 3/4) |
| Phones   | `/output/2/volume`   | −19.22 dB |
| Main     | `/output/0/volume`   | −300 (−∞) |

Bus tokens are `in` and `pb`, **not** `input`/`playback`.

**Submix 2 is the headphone pair.** `/setSubmix 2.` selects the submix
labelled "PH 3/4", not Main. The addresses were right; nothing recorded
what they pointed at. **Main has been reading −∞ throughout** — the iPad's
Main cell has been displaying a constant zero, not a level.

**Compatibility Mode is per remote controller.** TotalMix keeps four
`<OscRemoteN>` blocks, each with its own `OSCCompatibility`, in
`~/Library/Application Support/RME TotalMix FX/last.<Device><serial>.xml`.
So Global OSC is **not a one-way door** — the issue's worst hazard is
retired. Controllers 3 and 4 were unused with non-colliding ports.

**Dump-on-enable exists.** Detailed Settings → *Send all data on start
(enable)* emits a full state dump: 825 messages, 811 distinct addresses,
including a `name` for every channel. The premise that TotalMix offers no
bootstrap was wrong.

**⚠️ An argument-less message is a WRITE of 1.0, not a query.** Sending
`/output/10/volume` with no arguments sets it to 1.0 dB — verified
before/after on a spare channel. The "arg-less address poke" that OSC
convention suggests, and that the issue proposed testing, is destructive.
There is no read verb at all.

**Writes are not echoed** (*Re-send received* off), so a device-side echo
loop is structurally impossible.

**Fader floor is −65 dB**; below that the mixer reads −oo. True off is −300.

**RME's fader taper**, swept at 1 dB resolution: 0 dB sits at 0.8172 of
travel, +6 at 1.0, linear between −6 and +6 (0.0304659 per dB) and curved
below. Recorded here because it is measured and would be tedious to
re-derive — it is deliberately **not** used in shipping code (see below).

## Decision

**1. Global OSC, on remote controller 3.** Controller 1 keeps its legacy
configuration untouched, so the old path remains available and the cutover
is reversible by one dropdown. Requires TotalMix FX **2.10+**; 2.03 has no
Global OSC. Detailed Settings: *Send changes*, *Send all data on start*,
*Send status*, and *Receive to hidden channels* on — the last because
writes to non-visible channels fail **silently** without it.

All three read defects become unrepresentable rather than fixed: with
absolute addresses there is no page state to serialise, no latch to
corrupt, and no correlation problem.

**2. The bridge owns the mixer link.** Live tears the device down on every
set load, so it can hold nothing across one — the same argument that
produced `autoCaptureOverride.js` (ADR-405). The bridge caches the last dB
per channel for its process lifetime and replays it to a device that says
`/totalmix/hello`.

Note the dump-on-enable finding weakens the original "only the bridge can
answer what the levels are" argument. Bridge-owned still wins, on better
grounds: it filters 811 addresses down to five and keeps that burst out of
Live's process, it puts the clamp somewhere no writer can bypass, and it
makes the iPad strip correct on a fresh page load with no device present.

**3. Bootstrap the cache once, over the legacy protocol.** Global OSC has
no read verb, and its dump fires when TotalMix enables a controller — not
when the bridge starts. Since TotalMix runs continuously and the bridge
starts with `npm run dev`, the bridge almost always starts second and
would come up empty: load a set then and the device's gates never open.

So at startup the bridge asserts each bus row on legacy controller 1,
reads the five levels out of the dump that provokes, seeds the cache, and
closes the socket — port 7001 is held for well under a second.

This revives exactly the read machinery removed above, which deserves
justifying. In the patch it ran **continuously**, driving dials, with no
request/reply correlation, so a knob turn mid-read made one channel adopt
another's level. Here it runs **once**, serialized, before anything is
cached, in a process that holds no dials. Two additions close the holes
the patch had:

- **Strip names are verified, not just slot numbers.** The legacy bank
  window is never pinned, so "slot 2 of the output row" can silently be a
  different channel than when it was measured. Every read asserts the
  strip's `trackname`; a mismatch skips that channel rather than seeding a
  wrong monitor level.
- **dB is taken from the mixer's own `Val` strings** ("-19.2 dB", "-oo"),
  so this never models RME's taper. Costs 0.1 dB on the seed — an order of
  magnitude below audible — and a real change event replaces it exactly.

Measured round trip: ~1.8 s for all five channels, matching the Global OSC
readings to within the expected 0.1 dB. A busy port 7001 (the old patch
still running) returns empty in ~1 ms without throwing. Seeding never
overwrites a level already heard from the mixer, so a change arriving
mid-bootstrap wins.

**4. dB end to end.** The mixer's protocol, the bridge, the wire, the
store, and the `live.gain~` objects in the device all carry dB. Nothing
converts in transit. `0..1` survives only in
`interface/src/lib/utils/totalmixScale.ts`, to draw a fader.

This came out of choosing `live.gain~` over `live.dial` for the device.
A bare dial has no natural unit, which is the only reason the original
plan needed a conversion at all — and it carried the design's worst
hazard, since the eight existing dials have no `parameter_mmin`/`mmax`
and therefore sit on Max's default 0–127 range; wiring one through
un-ranged puts Room or Phones at full scale in an occupied room.

**5. Linear-in-dB for the UI fader, not RME's taper.** Reproducing the
measured taper would make the strip look exactly like TotalMix's and
nothing else — it would not make the Move agree, because `live.gain~`
follows Live's gain law rather than RME's, so parity across the three
surfaces was never available. Given that, uniform ~0.18 dB/pixel is the
better trade: one line instead of a 72-point table, and a monitor fader
that nudges identically everywhere is easier to trust mid-performance.

**Consequence:** the iPad drag feel changes. Worth trying before a
session rather than during one.

**6. Bottom of travel means off.** `MIN_DB` (−65) is inaudible but not
silent. `dbForWire` / `clampDb` map it to the mixer's −300, so pulling a
monitor fader all the way down is actually off.

**7. Unknown is not zero.** A channel never heard from renders as an empty
fader rather than a level. In 0..1 "no data" and "silent" were the same
value; in dB they are not, and an unknown monitor level must not look like
a real one.

## Consequences

- The mixer link now depends on the bridge running. It previously depended
  on a standalone Max patch launched by a 4-second `setTimeout`, so this is
  a better dependency, not a new one.
- Port 7001 stays with the legacy controller; the steady-state path uses
  7003/9003, so there is no hard handoff and no silent-failure window. The
  bridge borrows 7001 briefly at startup and releases it, so the Utility
  patch can still be run during the transition — the bootstrap simply
  degrades to empty when the port is taken.
- `TotalMixStrip.svelte`, the store, and the handler keep their addresses
  and shapes — only the **unit** changed.
- The Global OSC settings live in TotalMix's per-device XML, which is
  written on **clean quit**. A crash or force-quit loses them.

## Remaining

- **The Max for Live device is not in the repo.** A working device exists
  — it was observed bound to 11018 and its `/totalmix/hello` answered with
  all five cached levels — but it lives only in Live's memory: no `.amxd`
  has changed and no set has been saved, so its internals are unreviewed
  and unversioned. Save it, commit it, and document its parameter orders
  and gate wiring here.
- Lock the Move to it (CC 75–78 → parameter orders 5–8, per
  `surface/CLAUDE.md`'s CC map).
- Confirm `live.gain~` honours `set` (position without output). The
  `[change]` after each gate contains the damage if it does not.
- Decide whether Main stays on the strip given it reads −∞.

Done since this ADR was written: the Utility patch's TotalMix objects are
deleted (282 objects → 78), and `wire-protocol.md` §2.10.3 carries the
contract.

## Related

- ADR-104 — original `/totalmix/*` send path (superseded)
- ADR-388 — inbound monitor mirror, 0..1 from the Utility patch (superseded)
- ADR-405 — bridge-carries-state-across-set-load precedent
- ADR-412 — Move CC 71–78 map

## Tags
`totalmix`, `rme`, `osc`, `global-osc`, `bridge`, `monitor-levels`, `max-for-live`, `live-gain`, `ableton-move`, `db`
