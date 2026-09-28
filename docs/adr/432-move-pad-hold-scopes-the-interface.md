# ADR-432: A Move Pad Held Past 300 ms Scopes the Interface to That Pad

## Status
**Accepted** (2026-09-11). Builds on ADR-412 (the Move's drum-chain knob
reads Live's selected pad), the hold-to-scope pad grid of 2026-09-08/09
and the FX-grid scope of ADR-430.

## Context

Per-pad editing is a hold: a finger on a pad tile scopes the Drum Rack
view's controls and the FX grid to that pad, and lifts back to the kit.
The user plays drums on an Ableton Move and asked whether holding a pad
*there* could do the same, so the Move picks the pad and the iPad edits
it — one hand on each.

Three facts shaped the answer, all measured or read off the rig:

- **Live's selected pad follows a Move hit.** The user confirmed it and
  ADR-412 already relies on it: `rack.view.selected_drum_pad` is the pad
  struck. Measured on the rig (below): it is the pad under the finger,
  not the pad that sounds — with a Random at +12 before the rack every
  hit sounded an octave up and the selection stayed on the struck pad
  all four times. Either way the note the Move sends is the wrong
  identity: the Move's pads send raw notes on a 68-based, 8-wide grid
  that the Move script maps onto the rack's 4-wide pages, and that map
  moves with the page. The selection is the pad; the note is not.
- **The Move's raw MIDI is already in Max.** `Max Utility 1.0.maxpat`
  reads the Move's Live Port through its Node MIDI hub and publishes it
  on the `midi_from_move` bus as `noteon <ch> <note> <vel>` / `noteoff`
  / `cc` messages; the encoders' CC 71 / 72 leave that patch as OSC
  straight to the surface's port (11020). The pads' notes are on the
  same bus.
- **The Looping control surface has one MIDI input, and it is spent.**
  Live's log shows it on `Ableton Move (External Port)` — the pedal,
  plugged into the Move's USB jack — and pedal gestures have reached the
  surface through it. Putting the Move's pads on the script's own port
  (the ADR-422 pattern) would cost the pedal its port.

Two alternatives were considered and set aside: reassigning the surface
input to a Move port (costs the pedal, and which port carries pad notes
in the mode the user plays would first have to be measured); and driving
the scope off Live's selection alone (no note-off, so it could only
scope for a fixed time after a hit, not for as long as the pad is held).

## Decision

**Max times the hold, the surface names the pad, the interface presses
the scope.** Three small pieces on the lane that already exists.

- **`owner/Max Patches/move_pad_hold.js`** on the `midi_from_move` bus
  (`[r midi_from_move] → [js move_pad_hold.js] → [udpsend 127.0.0.1
  11020]`): per pad, a note-on starts a 300 ms clock — the pad tiles'
  own `MOMENTARY_HOLD_MS` — a note-off before it fires cancels, still
  down when it fires sends `/looping/v3/move/pad_hold <note> 1`, and the
  later note-off sends `… <note> 0`. A plain hit sends nothing: playing
  is unaffected. The step buttons (notes 16–31) are ignored. The note is
  only a tag that pairs a release with its hold; it never picks the pad.
  Two pads held one after the other are two holds.
- **`SelectedTrackComponent.handle_pad_hold`** (Hardware→Surf,
  `[note, held]`): on `1` it reads the context the drum-chain knob reads
  — the first `DrumGroupDevice` on `song.view.selected_track` and its
  `view.selected_drum_pad` — and emits `/looping/v3/drum/pad_hold
  [rackPath, padNote, 1]`; on `0` it emits the release **for the pad it
  announced under that tag**, remembered per tag, never the current
  selection, so a quick hit on another pad mid-hold moves Live's
  selection but not the release. **Two pads hit together both read the
  one selection** (measured: tags 78 and 76, 18 ms apart, both named pad
  40), so a pad named by more than one tag is announced once and
  released only when the last of its tags lifts — the first lift would
  otherwise unscope a pad still under a finger. Context misses drop with
  a one-shot INFO line as the knob's do; a repeated `1` is ignored;
  malformed args reject. Ungated — the patch is the switch. Reads only,
  no undo step.
- **`v3DrumPadHold.ts`** presses the pad on `drumPadScope` as an
  **external hold**: the same `holds` map as fingers, under
  `externalPointerId(note)`, an id at or below `EXTERNAL_POINTER_BASE`
  (−1000) that no browser can mint. The identity is the pad **on its
  rack**, as the surface keys it: the same note announced on another
  rack (the track switched under the hold, or the rack's path shifted)
  replaces the hold, and a release names its rack and releases only a
  matching one — found by the code review before it could bite. So
  nothing downstream changes — the
  FX grid scopes, the tile lights, the controls take the pad's colour
  and values, the multi-pad delta and the pane work as for a finger. The
  release is always a `cancel`, so **a Move hold never latches**: a
  latch is a deliberate tap on the glass, and it puts back whatever was
  latched before. `releaseExternalHolds` drops the external holds and
  nothing else, and runs on every handshake accept through
  `onHandshakeAccepted` — a listener registry rather than a store
  import, because `v3Handshake` sits under `simpleClient`, which calls
  its `setSender` at load: a static import of a store from there closes
  a cycle that lands `setSender` on an uninitialised binding (found by
  the handshake test the moment it was tried).

## Consequences

- Hold a Move pad and the iPad is that pad's; lift and it is the kit's
  again. Hits do nothing new. Hold two one after the other and both move
  by the same delta; hit two together and they count as the one pad Live
  selected, held until both lift. A Move hold and a finger share one
  scope — the last pressed wins, whichever device pressed it.
- The pad is the one struck, whatever a MIDI effect before the rack
  makes of the note, because Live's selection is the identity and the
  note is only a tag.
- A dead patch, a dead Move or a release lost in a reconnect gap cannot
  leave a stuck scope: the next handshake accept drops every external
  hold on the interface, and on the surface a `1` for a tag still
  recorded releases the stale hold before announcing the new one
  (2026-09-12 — it used to be dropped as a repeat, which left a tag whose
  `0` was lost stuck for the session and every later hold of that Move
  pad ignored; a repeated hold that resolves to the same pad is still
  idempotent).
- Protocol: two new addresses, both documented in `wire-protocol.md`
  §2.10.2; no record shapes change and no version bump — a client that
  ignores the message loses nothing.
- The surface half needs a full Live restart. The Max half is the
  user's patch; the JS is in the repo.
- Measured end to end on the rig the same day — see Validation.

## Validation

- Rig, 2026-09-11, after a Live restart, the user holding pads on the
  Move with the bridge captured by a client and Live's log read beside
  it: **one pad** → one hold and one release on the wire and in the log
  (`tracks/1/devices/0` pad 46, tag 86); **two pads together** → two
  holds 18 ms apart both naming pad 40 (tags 78 and 76), two releases
  20 ms apart — the refcount rule above came out of this run; **quick
  hits** → nothing sent, nothing logged. **Rand Oct**: a Random inserted
  before the rack by name (so the rack moved to `devices/1`, and the
  wire named it there) with Chance 100 %, Interval 12, Sign Add — four
  holds, tags 77 / 69 / 92 / 70, named pads 41 / 37 / 48 / 38, every one
  the pad struck by the raw-grid map (`36 + 4·row + col` for
  `68 + 8·row + col`) and none the pad an octave up that sounded. The
  Random was deleted afterwards. One anomaly, not reproduced: the very
  first hold after the restart named pad 36 for tag 77, which every
  later hold mapped to 41 — the selection had not followed that first
  strike.
- Surface: `tests/test_selected_track_component.py` — announce and
  release, the rack named by its index on the track, the release naming
  the announced pad after the selection moved, two pads by tag, the
  idempotent repeat and the stray release, two tags naming one pad, the
  three context misses, no selected track, six malformed shapes,
  disconnect forgetting the holds (102 passed in the file; no new ruff
  category).
- Interface: `stores/drumPadScope.test.ts` (external ids, scope and
  never-latch release, the prior latch restored, idempotence, two pads,
  a finger sharing the scope, `releaseExternalHolds` sparing fingers and
  latches, the pane dropped with the last hold) and
  `handlers/v3DrumPadHold.test.ts` (address, press/release, two pads,
  the accept release, five malformed shapes, a release for another
  rack ignored). `npm run check:wire` green with the two rows.
- Code review of the two commits (same day): the interface keyed an
  external hold by note alone while the surface keys it by rack and
  note — fixed as described in the decision; and svelte-check had gone
  from the 60-error baseline to 61 because the `random` registry alias
  inherited an error the `arpeggiator` entry already carried. The cause
  was two comments inside the Arpeggiator and Permute views' script
  blocks that spelled `<style>` literally, which svelte-check reads as
  the script left open and so strips both views' module types of
  `default`; reworded, the two views and three registry lines are clean
  and the baseline is **56**.

## Tags

`move`, `drum-rack`, `pad-scope`, `max`, `selected-track`, `hardware-lane`
