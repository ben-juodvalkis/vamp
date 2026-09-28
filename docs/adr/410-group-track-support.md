# ADR-410: Group Track Support (Fold/Unfold + Structure-Aware Track Scans)

## Status
**Accepted** (2026-07-27)

## Context

The Svelte UI had no notion of Live's Group Tracks. Two consequences:

1. **Every track in the set got a strip**, including group tracks and the
   children of a *folded* group. Live's own arrangement — fold a group, its
   children disappear — was not mirrored, so the iPad row was permanently
   wider than what the user sees in Live.
2. **A group masqueraded as an empty audio track.** Verified against Live
   12.4.5b8: a Group Track reports `has_audio_input == True`, and its
   `clip_slots` are never `has_clip` (they mirror the scene row rather than
   holding clips). Any scan shaped as "audio input + no clips → free to
   reuse" therefore selects the group bus. Python's
   `TrackPrepareComponent._is_reusable` already guarded this (ADR-385), but
   the UI-side `clipStateStore.emptyAudioTracks` and
   `selectedTrackStore.trackType` did not.

### LOM facts this is built on

Established by probing the running set over
`/looping/probe/lom_introspect` (not from docs — the LOM reference in this
repo does not list `fold_state` at all):

| Fact | Consequence |
| ---- | ----------- |
| `is_foldable`, `fold_state`, `is_grouped`, `group_track`, `is_visible` all exist | the full group tree is readable |
| **`fold_state` raises on a non-foldable track** | it is not merely absent — `getattr(t, "fold_state", False)` does *not* save you; the read needs an `is_foldable` gate or a raise-swallowing helper |
| **No `add_fold_state_listener`, no `add_is_visible_listener` on `Track`** | folding in Live's own UI fires nothing track-side |
| **`Song.add_visible_tracks_listener` exists**, and a fold changes `song.visible_tracks` | that song-scoped observable is the only fold signal available |
| Group reports `has_audio_input == True`, `can_be_armed == False` | the masquerade in (2) |

## Decision

### Wire: three fields on T, one focused address pair

Protocol **3.3.0 → 3.4.0**. The T record grows 10 → 13:
`isFoldable:int`, `foldState:int`, `groupTrackIndex:int`.

`groupTrackIndex` (parent's LOM index, `-1` at top level) is carried rather
than a bare `isGrouped` bit because **a track is hidden when *any* ancestor
group is folded**, not just its immediate parent. With nested groups that's a
walk, and a walk needs parent pointers. It's recovered from
`Track.group_track` by `_safe_int_id` identity against `song.tracks` — never
`is`, per ADR-350.

Two focused addresses (§2.5):

- `/looping/v3/track/fold_state [trackPath, 0|1]` — Surf→UI
- `/looping/v3/track/set/fold_state [trackPath, 0|1]` — UI→Surf

### Folds do not advance generation and do not ride `state/full`

A fold adds, removes, and reorders nothing — the LOM tree is byte-identical
before and after. Republishing `state/full` to hide six strips would ship
~4.5k tree args (11 chunks in the reference set) to communicate one bit.

So the surface emits the compact echo and the **UI derives visibility from
the group tree it already holds** (`$lib/utils/trackGroups`). One flag flip
updates every descendant at any nesting depth.

This is also why we don't carry Live's `Track.is_visible`, even though it
exists and would answer the question directly: it has no listener, so a
`is_visible`-based design would need a full republish (or a poll) on every
fold — exactly what deriving avoids.

### `Song.visible_tracks` is the fold signal

Since `Track` has no fold listener, `TrackMetadataComponent` attaches one
song-scoped `visible_tracks` listener and, on each fire, diffs the foldable
tracks against a `track_path → 0|1` cache, emitting only what changed. That
listener also fires on plain track add/remove, which the cache dedups to
nothing.

The write path echoes its own value rather than relying on that listener —
the same write-path-echo shape `Groove.base` needs (ADR: see
`docs/reference/toggles.md`). Necessary because folding a group whose children
are *already* hidden by an outer fold changes no visible track, so the
listener may not fire at all.

Rejected: **polling `fold_state` on the Live tick**. Workable (the read is a
handful of bools) but strictly worse than an observable that already exists.

### UI: group strips keep name + volume, drop clip + Permute

A group is a mixer bus, not a playable track. Its strip keeps what a group
genuinely has — name (tap = mute, which mutes every child), the strip-wide
volume fader, and the fold control — and drops the Clip and Permute
sections.

The strip keeps the **same three-third geometry** as its neighbours rather
than reflowing — strips sit shoulder-to-shoulder, and a name floating to the
vertical middle would break the row's read. The thirds map to
**Name / body / fold**:

- **Name** (unchanged) — tap mutes the group, which mutes every child.
- **Body** — the vacated Clip third. Empty on purpose; it carries the
  group's select tap, since a group has no clip or Permute section to carry
  one, and it leaves the meter wash visible.
- **Fold** — the vacated Permute third, at full section size. A chevron
  (down = open, right = closed, in the track ink). Sized as the whole
  section rather than a corner triangle because this is the group strip's
  primary action and it's driven by a finger on an iPad.

### Visibility filtering runs last and outranks every inclusion rule

`clipStateStore.getVisibleTracks` applies the hidden filter after the
filter-mode logic, in **both** `all` and `active` modes. A selected track
that gets folded away disappears — matching Live, rather than leaving an
orphan strip whose parent isn't on screen.

Indices are untouched: they remain LOM positions, so hiding a strip never
re-points a `tracks/<N>` path.

### Fail-open on a torn tree

Every ancestor walk is depth-capped (32) and treats an unresolvable parent as
"not hidden". Live cannot produce a cycle, but a torn `state/full`
mid-restructure could momentarily look like one, and an unbounded walk would
spin the render loop. A wrongly-shown strip is recoverable; a wrongly-hidden
one loses access to the track.

## Consequences

- Folding a group in **either** Live or the iPad hides its children in both.
- Group tracks can no longer receive an instrument via the reuse path, on
  either side of the wire.
- `selectedTrackStore.trackType` returns `null` for a group, so selecting one
  no longer opens an audio-track view over a bus.
- Protocol bump is breaking in one direction: a 3.4.0 UI cannot parse a
  3.3.0 surface (it would over-read every T record). The surface still
  advertises the older versions for downgrade-revert.
- `Track.is_visible` remains unused. If a future need makes the derived tree
  awkward, note that switching to it re-introduces the no-listener problem.

## Files

- `surface/components/V3StateFullComponent.py` — T fields,
  `_group_track_index`
- `surface/components/TrackMetadataComponent.py` —
  `visible_tracks` listener, fold cache, `handle_set_fold_state`
- `surface/components/HandshakeComponent.py` — 3.4.0
- `interface/src/lib/utils/trackGroups.ts` — the tree math (pure)
- `interface/src/lib/api/handlers/v3TrackFoldState.ts` — inbound echo
- `interface/src/lib/stores/v6/clipStateStore.svelte.ts` — visibility filter,
  group-aware reuse scan
- `interface/src/lib/components/v6/tracks/TrackStrip.svelte` — group variant
- `interface/src/lib/services/trackCommands.ts` — `setTrackFoldState`

## Verification

Verified end-to-end against the live set (Live 12.4.5b8, group "1-Group"
holding tracks 1–5) on 2026-07-27:

- Surface negotiates 3.4.0; zero exceptions across the reload.
- `set/fold_state` writes fold Live for real — `tracks/1.is_visible` flips
  to `False` with the fold and back on unfold.
- A fold write against a non-group track is rejected with no state change.
- A wire-driven unfold made strips 1–5 reappear in an already-loaded page
  with **no reload** — confirming the `visible_tracks` → echo → derived
  visibility path, which is the part that has no LOM listener behind it.
- Tapping the strip's fold control folds Live and hides the child strips;
  tapping again restores both.

## Tags
`group-tracks`, `lom`, `wire-protocol`, `track-strip`, `visibility`
