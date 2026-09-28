# ADR-357: Detach-all-and-rebind for track listeners on structural change

## Status
**Accepted**

## Context

`TrackMetadataComponent` and `MetersComponent` each attach
per-track LOM listeners (8 metadata attrs + `arrangement_clips`,
and `output_meter_left`/`right`) and rebind on structural changes
fanned out by `LOMListeners`. Each listener is a Python closure
that captures the canonical track path (`tracks/<N>`) at attach
time so the fire path can emit without re-walking `song.tracks`.

After a structural change (track delete, add, or reorder), Live's
LOM keeps every still-present track's C++ listener alive, but
indices shift. The closures continue firing on their *original*
captured paths. With Python-side bookkeeping that didn't actually
detach those closures on rebind, the surviving track at the
shifted index emits on the deleted track's old path, contaminating
the sibling slot in the UI's stores.

User-reported symptom (issue #399): "tracks after the deleted ones
are weird with volumes that jump etc." Volume strips snap back to
stale values; meters bleed across tracks.

A first attempt on branch `claude/fix-tank-volume-control-L7H2Z`
keyed listener bookkeeping by `id(track)` and tried to detach
only on path-shifted tracks. It made the symptom worse — every
track started snapping back even with no delete — because Live's
v3 framework hands out fresh Python wrappers per `song.tracks`
read (ADR-350: `_live_ptr`-based identity, never `is`-based).
The `id()` lookup never matched any existing entries, so the
"is this a known track?" branch always took the "new track"
path, double-attached listeners, and lost the bookkeeping needed
to detach the originals later. That branch is discarded.

## Decision

On every structural-change fire, detach **every** prior listener
unconditionally and re-walk `song.tracks` to re-attach fresh
closures with current paths. No identity-based bookkeeping, no
path-shift detection.

To make this possible, both components store listeners as a flat
list of detach records:

```
(target, remove_method_name, cb, path)
```

— where `target` is the wrapper we attached on (the track for
direct-attr listeners, the mixer parameter for `volume`), `cb` is
the closure, and `path` is for debug logging. The list, not
`id(track)`, is the source of truth: each wrapper we attached
on stays alive in the list and points at the same underlying
LOM handle. Live's fresh-wrapper-per-read behavior is irrelevant
when we hold the wrapper that actually accepted the listener.

Detach loops swallow `RuntimeError` / `AttributeError` /
`TypeError` (the latter covers `Boost.Python.ArgumentError` for
torn-down handles) at DEBUG so a delete-heavy session doesn't
flood Log.txt.

`disconnect()` follows the same shape — walk the records, detach,
clear — instead of resolving targets through a fresh `song.tracks`
read (which would hand back wrappers that don't match the ones we
attached on, by ADR-350).

## Consequences

**Positive:**

- Issue #399 fixed: surviving tracks emit on their current path
  only; no sibling contamination.
- No identity bookkeeping to get wrong. The dead branch's
  failure mode (`id()` mismatch → double-attach → leaked closures
  → worse contamination) is structurally impossible.
- `disconnect()` becomes simpler and correct on real Live —
  before this change, `disconnect` resolved targets through a
  fresh `song.tracks` read keyed on `id()`, missing every record.
- One detach record per (track, attr) makes audit trivial: count
  the list to count active listeners.

**Negative:**

- Cost is `9 detach + 9 attach × N tracks` per structural change
  for `TrackMetadataComponent`, and `2 + 2 × N` for
  `MetersComponent`. Microseconds for typical sets. Runs only on
  add / remove / reorder, never per-fire.
- Test fixtures had to grow: a `FreshWrapperSong` whose
  `tracks` property returns brand-new wrapper instances per read
  (mimicking Live's behavior) so the rebind path is exercised
  honestly. Without it, identity-keyed bugs hide in tests because
  the prior `StubSong` re-used `StubTrack` instances across
  reads. Coverage now spans delete-in-middle, no-op
  structural-change, add-at-end, and reorder for both components.

## References

- Issue #399 — user-visible symptom and proposed fix shape.
- ADR-350 — `_live_ptr` / `_safe_int_id` identity discipline.
- `surface/CLAUDE.md` — "LOM identity is `_live_ptr`-based,
  never `is`-based."
- Dead branch (discarded): `claude/fix-tank-volume-control-L7H2Z`
  (commits f69502b0..b86db472).

## Tags
`listeners`, `lom`, `track-metadata`, `meters`, `structural-change`,
`adr-350`, `issue-399`
