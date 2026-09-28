# ADR-444: Muted notes ride the velocity's sign

## Status
**Accepted** (extends ADR-360, the strip's note thumbnail; ADR-415, the session grid's reuse of it)

## Context

The track strip's clip thumbnail — and every MIDI cell of the session grid,
which draws through the same `ClipPreview` — painted every note the same
way whether or not Live had muted it. The thumbnail pulls the cheap
`clip/notes` blob (ADR-360): four float32s a note, pitch / start / duration
/ velocity, 16 B, capped at 512 notes so the reply stays under darwin's
9216 B UDP MTU. Live's `MidiNote.mute` was never on that wire. It rides the
rich channel (ADR-382), but that channel is focus-scoped and chunked and
feeds the central editor only; pulling it for every strip and grid cell
would multiply its traffic for one bit.

Permute's step-mute (ADR-429) writes that same `MidiNote.mute`, so a
Permute-muted step looked, in the strip, exactly like a sounding one — and
so did a note the user had muted by hand in Live's clip view.

The ask (2026-09-18): "can we reflect muted notes somehow?"

## Decision

**1. The velocity's sign is the mute bit.** `_pack_notes_blob` packs a
muted note as `-velocity`. The stride stays 16 B and the cap stays 512;
nothing about the UDP math moves. A fifth float per note would have cost
about a hundred notes of cap, and a fifth field in a struct would have
been a wire version. Velocity 0 muted packs as `-0.0`, which float32
preserves; the decoder reads the sign with `Object.is(v, -0)`, because
`-0 < 0` is false. Live itself never sees a negative velocity — the
surface reads its boolean and flips the sign on the way out; the UI flips
it back on the way in and exposes `MidiNote.muted`, handing every consumer
`abs(velocity)`. Nothing past the decoder knows the trick. An older client
against a newer surface reads a muted note as a dim one, which is the
harmless direction.

**2. A muted note draws hollow, in signal-dim.** The way Live's own clip
view outlines a muted note: a 1px inset ring of `--signal-dim` over a faint
wash of the same, no track ink, velocity ignored. It is there, and it is
silent. The grey is the vocabulary the thumbnail already used for Permute's
step-mute (`dimmed`), so the two states read as one family: grey means no
sound. On a bar two pixels tall the ring fills the bar and it still reads
grey.

**3. Permute's muted steps show.** Because Permute writes the real flag,
its muted steps now read hollow in the strip. The strip already re-pulled
the blob on each of those writes (the `notes/changed` poke fires on every
note modification), so this changes what is drawn, not what travels. A
note muted by hand stays hollow through Permute's cycle, which is what
Live does too — Permute unmutes only the notes it muted.

**4. The screenshot mock mutes every fifth note**, so every MIDI thumbnail
in a `npm run shot` capture shows a ghost note or two. A `--diff` between
two runs of identical code is still byte-identical: the pattern is
deterministic.

## Consequences

- **Every consumer of `MidiNote` gains `muted`.** The drum pad grid
  (`padGrid.ts`, `useClipPads`) reads pitch only and is unchanged: a muted
  note still lights the pad, which is right — the pad has content.
- **A surface change.** `ClipNotesComponent` loads only after a full Live
  restart (bytecode cache). Until then the UI reads every note as sounding,
  as before.
- **Rig check pending.** Verified by unit tests on both sides of the wire
  and by the screenshot mock; not yet watched against Live with a hand-muted
  note and a Permute cycle. That is the next session's smoke item.

## Tags
`clip-notes`, `track-strip`, `session-grid`, `wire-protocol`, `permute`, `mute`
