# ADR-435: A Permute Inside a Drum Pad's Chain Drives That Pad Alone

## Status
**Accepted** (2026-09-14). Branch `feature/pad-permute`. Builds on
ADR-428 (virtual macros and the per-pad rows), ADR-429 (the surface owns
Permute's engine), ADR-430 (pad chains on the wire, hold-to-scope, the
pane) and ADR-432 (the Move hold). The per-pad goal it serves is the one
recorded 2026-09-08: editing individual pads from the interface, never
"set all".

## Context

Every track in the user's sets carries a thin Permute at the top of its
chain, and on a drum track its octave step moves the whole kit through
the drum provider's rack-wide shift term, its mute silences every note of
the playing clip, its Chance writes every note's probability. The pad
work of the previous week made single pads reachable for everything
*but* the sequencer: per-pad offsets and deviations on the surface,
`vm.pad.<note>.<fn>` rows on the wire, pad chains addressable as
`…/pads/<note>/devices/<K>`, effects loadable into a pad, hold-to-scope
on the glass and on the Move. Permute was the one preset left out of
pad scope, by decision, because nothing behind it could act on one pad.

What stood in the way, verified in the tree on 2026-09-14:

| Layer | Before |
|---|---|
| discovery | `SequencerComponent.rescan` walked `track.devices` only |
| pattern feed | the engine's cache rode `LOMListeners`' value listeners, which are attached to top-level devices; a chain device's parameters are watched only by `DrumPadChainComponent`, and only while a client holds the pad |
| shape changes | the pad-chain component's `drum_pads` / `chains` / chain `devices` listeners exist only while a client subscribes a row — with no UI connected, nothing would notice a device dropped into a pad |
| pitch | one `shift` per rack on `DrumVirtualMacroComponent`; the pad rows write an absolute value on top of it |
| actions | mute, chance and temperature iterate every note the clip returns |
| interface | `padScoped` unset on the sequencer preset; `sequencerStore` derived its device from the track's chain; the strip thumbnail and the Permute view had no notion of a pad |

Measured on the rig before a line was written: three tracks, each with
its own Permute; the selected track a 20-pad unmapped MultiSampler Drum
Rack (notes 36–61) with Permute at `devices/1`, engine route `drum`.

### The four calls

Put to the user one at a time, each with a recommendation; every
recommendation was taken.

1. **A pad's Permute and the track's compose; neither overrides.** Octave
   shifts add (kit +12 and pad +12 is +24, clamped at ±48), either mute
   silences the pad, and for Chance the pad's own value wins on its notes
   — a probability is one number per note, so it cannot add. No exclusion
   mode: a pad with its own Permute is not exempt from the kit's gesture.
2. **Temperature is inert on a pad's Permute.** It swaps pitches among the
   notes it captured, and one pad's notes are all one pitch. Dimmed on the
   glass, ignored by the engine. A hit-timing shuffle was named as the
   later reinterpretation, not built.
3. **Hold a pad and Permute becomes the pad's.** The strip's Permute
   section and the Permute view show the held (or latched) pad's Permute,
   ghosted when it has none; the first step edit loads one into the pad's
   chain — the ghost-edit flow tracks already have, aimed at the pad path.
   Lift, and it is the track's again; the Move hold behaves the same. A
   small step strip on the pad tile shows a pad's Permute running.
   Rejected: a Permute tile on the FX grid (a full grid, and the sequencer
   view is cramped inside the Drum Rack view), and Live-only editing (the
   iPad is the performance surface).
4. **Surface first, proven on the rig** by dragging a Permute into a pad
   chain in Live by hand, before the interface depends on it.

## Decision

### Two enabling changes, each inert on its own

- **`PadChainWatcher`** (`DrumPadChainComponent.py`): the rack's
  `drum_pads` / `chains` listeners and one `devices` listener per
  populated pad's first chain, extracted from the pad-chain component's
  state. `refresh()` re-walks the pads idempotently and returns the
  populated `(note, chain)` pairs, so whoever needs to read the chains
  walks them once. The pad-chain component holds one for as long as a
  client holds the rack's rows, exactly as before; the engine holds one
  per top-level Drum Rack for as long as the rack is in the set.
- **The engine's note reads scope themselves.** `_read_notes` is the one
  place mute, chance and temperature get their notes; for a pad instance
  it returns only the notes at the pad's pitch — through
  `Clip.get_notes_extended(pitch, 1, 0, length)` where the clip offers
  that form, else the full read filtered. Every action that iterates
  "the clip's notes" is thereby "the notes in scope" with no branch of
  its own.

### Surface

- **Discovery.** `rescan` walks each track's top-level chain and, for
  every top-level `DrumGroupDevice`, the populated pad chains the rack's
  watcher returns. A Permute found there is an `_Instance` with
  `pad_note` set and the path `tracks/N/devices/M/pads/<note>/devices/K`;
  its rack and rack path are the pad's own. A Drum Rack nested in an
  Instrument Rack is not walked: the wire has no path to a pad under the
  reserved `chains/` segment, so nothing could address, load or draw it.
- **Shape changes reach the engine without a client.** The watcher's
  callback marks a rescan due `PAD_RESCAN_DELAY_S` (150 ms) later — the
  margin a chain needs to populate after the add fires, and the tick is
  the write-legal context a retired instance's restore needs. The rescan
  runs at the top of the next tick past the deadline; a Permute deleted
  from a pad in Live is retired there and restored in the same tick.
  Watchers are attached on first sight, refreshed on every rescan, and
  detached with the rack and on `disconnect`.
- **A pad instance keeps its own pattern listeners** (`own_listeners`):
  one `add_value_listener` per control, re-synced by parameter id on
  every rescan, detached when the instance retires. A fire lands on the
  same `on_param_value_changed` the track-level fan-out feeds, so the
  pad-chain component watching the same parameter while a client holds
  the pad is harmless.
- **Pitch is a per-pad term on the drum provider.**
  `set_pad_sequencer_shift(rack, rack_path, note, shift)` holds the term
  on the pad's `_PadPitch.shift` and writes the pad now:
  `pitch = global + offset + kit shift + pad shift`. The kit fan-out
  carries the term on every gesture, the pad row (`vm.pad.<note>.pitch`)
  and the UI's per-pad write read and write without it, a re-seed keeps
  it, a held term keeps the rack's state alive past the UI's
  subscriptions as the kit's does, and a pad that cannot move on its own
  — a still-mapped kit, a pad with no enabled pitch member — refuses it
  with one log line, so a step-off can never land below where the pad
  started. Same undo grouping as the kit's term.
- **Mute** sets `note.mute` on the pad's unmuted notes and unmutes only
  those; an audio clip is left alone (a pad has none to silence).
  **Chance** writes the pad's notes; the track-level instance on the same
  rack skips the pitches pad instances govern (`_governed_pitches`), so
  the pad's value stands whichever writes last. **Temperature** returns
  early on a pad instance in `_on_temperature_changed` and `_temp_start`.
  Restore, clip changes, the solo override, the toggle and `disconnect`
  are the existing paths; a pad instance's `drum_shift` restores through
  the per-pad call.
- **Telemetry** is unchanged: `/looping/v3/permute/step` carries the
  instance's device path, which for a pad is the pad-shaped one.
- **`sequencer_stats`** reports `route: "pad"` and `pad` per instance and
  a `rescan` block — `last_ms`, `max_ms`, `watchers`, `due` — because the
  walk now reads pad chains and its cost was the one number the design
  could not know in advance.

### Interface

- **`padScoped: true` on the sequencer preset.** It has no tile; the flag
  is the rule that a scope may reach it.
- **`sequencerStore` follows the scope** (`activeDrumRackScope`, the one
  place that says whether a pad is scoped on the selected track's Drum
  Rack): its device is the Permute in the scoped pad's map — records, or
  presence stand-ins before the bundle lands, which read as the device's
  defaults rather than "every step off" — or the track's. Pending ghost
  edits are keyed by the pad path, the ghost load names the pad as its
  target, and a landed device flushes only its own scope's edits. Every
  read and write is the same `param/set` wire on a pad-shaped path.
  `scope` and `temperatureInert` are new getters; the clip view's
  Temperature slider dims and drops writes under a scope.
- **The strip thumbnail** (`useTinySequencer`) is the scoped pad's Permute
  when the scope is on that track's rack, framed in the pad's chain
  colour (`MiniSequencer`'s `scopeLabel` / `scopeInk`); the pure
  `tinySequencerState` is shared with the pad tiles.
- **The Permute view** names the pad in a chip on the seam between the
  two sequencers and paints the mute row in the pad's ink.
- **Pad tiles carry a step strip** (`PadStepStrip`) when the pad's chain
  holds a Permute: `usePadSequencers` reads presence for the grid's pads,
  holds `vm.padChain.<note>` for those with one, and derives each strip
  from the pad's records and the telemetry keyed by its device path.

### Wire

No new address and no version bump. `permute/step`'s `devicePath` may
be pad-shaped; `device/load` with a pad target and the pad-shaped
`param/set` already exist (3.8.0). The Permute is a `.amxd`, so a pad
load takes the browser path — landed on the track, moved into the chain
after the pad's instrument — as any non-native preset does.

## Consequences

- A performer holds a pad and gives that pad its own octave pattern,
  its own mute pattern and its own chance, with the kit's Permute still
  running over the whole kit. Two Permutes on one pad add up.
- The engine now walks pad chains on every structural rescan. The cost
  is reported, not assumed: see Validation for the number.
- A device dropped into a pad in Live reaches the engine 150 ms later,
  UI or no UI. The same delay applies to a removal, during which the
  retiring instance touches nothing (its cache is read-only and the
  apply targets the clip and the rack, never the device).
- A pad Permute's Chance leaves the track's Chance no way to reach that
  pad's notes; remove the pad's Permute and the track's next apply
  reaches them again.
- Nested-rack kits (a Drum Rack inside an Instrument Rack) get no pad
  Permutes until the `chains/` grammar opens.
- Two providers still share the `vm.` prefix, and the engine now
  depends on the pad-chain module for its watcher; the dependency is one
  way.
- Temperature on a pad is a dimmed slider that does nothing, which is
  honest but is a control with no meaning on screen. The later
  reinterpretation (a timing shuffle) would give it one.

## Addendum — the pad's Permute opens inside the Drum Rack view (2026-09-14)

Tried on the rig the same afternoon, the user's first ask: with a pad held
or latched, the strip's Permute tap swapped the whole central view for the
Permute view, which unmounted the pad column (and cancelled a held
finger). Now `TrackStrip.selectThen('permute')` first calls
`openScopedPermutePane()`: with a pad scoped on the selected track's Drum
Rack it sets the pane to `permute` through the same `openDeviceView` door
the effect tiles use, and `PadFxPane` resolves that type as the registry's
top-level Permute view (its header chip names the pad and says "Permute";
the view's own seam chip steps aside when it reads the pane's scope
context). The pad column stays, the hold survives, and lifting a held pad
closes the pane as it closes an effect's. Nothing scoped, and the tap
swaps the top-level Permute view as before.

## Validation

- Surface: `uv run --with pytest --with ruff python -m pytest -q` — 2,472
  passed, 4 skipped (31 new: the watcher's extraction leaves the
  pad-chain suite green; the per-pad term composes with the kit's, is
  one undo step, clamps, survives a re-seed, keeps the state alive and
  is refused where a pad cannot move; the engine discovers a pad
  Permute as a pad instance, ignores a nested rack, mutes and unmutes
  only the pad's notes through the ranged read and through the filtered
  fallback, leaves audio alone, lets the pad's Chance win, rides its own
  value listeners, finds a Permute dropped into a chain on the deferred
  rescan and watches a pad that gained a chain, retires and restores a
  removed one, drops a rack's watcher with the rack, keeps Temperature
  inert, and composes with the kit's Permute through the real provider).
  `ruff check .` adds no rule category.
- Interface: `npm run test:run`, `npm run build`; `sequencerStore.test.ts`
  gains six cases (the scoped device and the way back, pad-shaped writes,
  the pad's telemetry, a stand-in reading as defaults, the pad-targeted
  ghost load with its own pending key, `clearCachedState` reaching pad
  keys).
- Rig (2026-09-14, after a Live restart; Live 12.4.15b2, the user's
  Untitled set, kit "Memphis Studio + Plymouth" — DrumCell pads, unmapped
  — with a four-beat test clip built over the wire on track 1: kick 36
  ×2, snare 38 ×2, hat 42 ×4, deleted afterwards; every write and read
  through the bridge's WebSocket and the surface's probes, nothing by hand):

| Check | Result |
|---|---|
| Load into pad 38 (`device/load` with the pad path) | landed on the track — the engine attached it there as a kit-level instance for 180 ms, the browser detour — then moved into the chain and re-attached as `tracks/1/devices/0/pads/38/devices/1`, route "pad 38 of the drum rack", 510 ms after the request; the pad path resolves the device's 23 parameters |
| Rescan cost with pad chains walked | 1.8–2.3 ms per walk (`rescan.last_ms` 2.17 after the load, 2.03 after the delete, max 2.31) — the one number the design could not know in advance |
| Pitch, the pad alone (all eight steps on) | pad 38 Transpose 0 → 12; pads 36 and 42 stay 0; provider `padShifts {38: 12}`, kit shift 0 |
| Pitch, composed | the kit Permute's steps on: 36 and 42 → 12, 38 → 24; off again: 36 and 42 → 0, 38 → 12 |
| Mute | the pad's mute steps off: the two pitch-38 notes muted, the six others untouched (`clip_mute {applied, notes: 2}` on the pad instance, nothing on the kit's); on again: all unmuted |
| Chance | pad 0.5 → its two notes at 0.50, the rest 1.00; kit 0.7 → 36 and 42 at 0.70, 38 stays 0.50; both back to 1.0 → every note 1.00 |
| Temperature 0.5 on the pad | no variation, no base model; pitches and probabilities unchanged |
| Stop | every Transpose back to 0, notes unmuted, both instances idle (520 transitions, 8 pitch applies, 7 mute applies, 4 chance applies) |
| Delete the pad's Permute | retired on the deferred rescan; the three track-level instances remain; pad 38's chain is its DrumCell again |
| Live's log | no warning from the engine or the provider. One `control-thread hiccup: 893 ms` fired during three back-to-back deep pad probes — the known ~600 ms probe cost, not the engine — and one pre-existing `ClipNotesComponent notes (detach)` argument-types warning when the test clip was deleted |
| Undo | not exercised on the rig this run |

## Addendum — the pad's mute and Chance follow the pad under the kit's Temperature (2026-09-18)

The kit-level Permute's Temperature swaps pitches among note ids across
the whole clip, and a pad Permute's mute rode on the id. Reproduced on
the engine's fakes (seed 1, pad 38 muted on step 0, kit Temperature
0.9): the variation on the first loop jump carried two muted notes to
pads 42 and 36 and two unmuted notes onto 38; the pad's unmute — a read
at its own pitch — found one of the three it had muted and forgot the
rest; a return to 0 and a transport stop left both stranded muted. The
pad's Chance value drifted the same way, silently. The transport-start
case only looked consistent by ordering: the variation lands before the
pad's first step mutes whatever is on 38 at that instant.

Three models were on the table: exempt a governed pad's notes from the
kit's scramble (the carve-out Chance already makes at write time);
unmute by id wherever the swap put the note (ends the stranding, not
the leak of unmuted notes onto the held pad); or make the mute follow
the pad. The user chose the third: the pad's pitch step is already a
term on the pad's Transpose, so whatever note the scramble lands there
gets the pad's octave — its mute and Chance now agree with it, and a pad
with its own Permute stays in the scramble.

- **The pad's unmute clears its remembered ids wherever they are**
  (`_mute_notes` reads the whole clip on the way off, `_read_notes(…,
  whole=True)`); the way on still reads the pad's occupants.
- **The kit's note writes settle the pads in the same write**
  (`_settle_pads`, from `_temp_variation` and `_temp_restore`, against
  the clip's pitches as read): a note the write moves onto a pad whose
  mute step holds is muted and remembered by that pad; a note the pad
  muted that the write moves off it is unmuted; a mover's probability
  becomes the value of whichever Chance governs where it landed — the
  pad's on a governed pad, the kit's elsewhere — when that Chance has
  been applied to the clip (`chance_applied`), otherwise the note keeps
  what it carried. One write per variation, so one undo entry.
- **Notes the write does not move are never touched.** A note recorded
  on a held pad keeps playing (the existing rule) and a note the user
  muted by hand stays muted whichever pad it drifts to — the pad
  remembers only what it muted itself.

Tests: `test_kit_temperature_keeps_a_pads_mute_on_the_pad` (the
reproduction, then the pad's unmute, a variation with the pad open, a
return to 0 while held and a stop — nothing stranded, one write per
variation), `test_kit_temperature_moves_chance_with_the_pad`,
`test_kit_temperature_leaves_a_hand_muted_note_and_an_overdub_alone`.
Not yet exercised on the rig.

## Tags

`permute`, `drum-rack`, `pad-scope`, `sequencer-engine`, `surface`, `interface`
