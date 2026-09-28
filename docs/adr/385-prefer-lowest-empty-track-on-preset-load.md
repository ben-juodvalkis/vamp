# ADR-385: Prefer Lowest Empty Track on Preset Load

## Status
**Accepted**

## Context

`TrackPrepareComponent._decide()` (server-authoritative reuse-vs-create logic
for `/looping/v3/track/prepare_for_preset`) used to inspect only the
currently-selected track. The rule was:

- If selection is `None` or index 0 → CREATE
- If selected track is wrong type, or has any session/arrangement clips → CREATE
- Otherwise → REUSE selected

This meant a workflow of "tap preset, tap preset, tap preset" steadily appended
new tracks even when the set already had a stack of empty tracks the user had
created earlier and not yet filled. Each new preset landed on a fresh track
instead of consuming the empty ones, and the user had to manually delete the
leftovers.

Track 0 has a long-standing policy of being off-limits for prep targets
(matches legacy `trackPreparation.ts:319-326`) — it's where the user keeps a
reference / scratch surface.

## Decision

Extend `_decide()` to scan for an empty matching track when the selected one
isn't eligible. Three-step policy:

1. **Prefer selected** — if the selected track is eligible (not index 0, type
   matches, no clips, not a group), reuse it. Respects explicit intent.
2. **Scan for lowest empty matching** — walk `song.tracks` from index 1,
   reuse the first track that's type-matching, clip-free, and not a group.
3. **Create** — only if both fall through.

Eligibility is centralized in a single `_is_reusable(track, track_type)`
helper. A track counts as reusable iff:
- not a group track (`is_foldable=False`)
- audio/MIDI type matches the requested preset type
- no session-view or arrangement-view clips

Track 0 is permanently excluded from the scan, regardless of contents.

Log lines distinguish the three outcomes: `REUSE_SELECTED`, `REUSE_EMPTY`,
`CREATE` — so traces make the chosen path obvious.

### Group tracks

Group tracks have `has_midi_input=False` and no clip slots, so a naïve scan
would treat them as "empty audio" and load a preset *into the group fold*.
Adding the `is_foldable` guard prevents that footgun.

Changed files:
- `surface/components/TrackPrepareComponent.py` — new
  `_decide()` body plus `_is_reusable` / `_find_lowest_empty_track` /
  `_is_group_track` helpers
- `surface/tests/test_track_prepare_component.py` — updated
  `test_distinct_request_ids_run_independently` (second request now reuses
  the just-created track instead of creating again); 6 new scan tests
  covering lowest-wins, skip-track-0, skip-wrong-type, skip-group-track,
  selected-wins-over-lower-empty, no-empty-anywhere-creates

## Consequences

**Positive**
- "Tap a preset" naturally consumes existing empty tracks before growing the
  set. No more accumulating empty rows after a long browse session.
- Group tracks are guarded — a preset can never land on a group fold even
  though it superficially looks empty.
- Selected-track intent still wins when it's eligible, so the user can still
  steer a load to a specific track by tapping it first.
- Distinct log outcomes (`REUSE_SELECTED` / `REUSE_EMPTY` / `CREATE`) make
  trace debugging unambiguous.

**Negative / watch-outs**
- Behavior change for users who relied on each preset tap creating a new
  track: empty tracks elsewhere in the set will now be consumed first. If
  this becomes annoying, the natural escape valve is to put something on
  the empty track (any clip disqualifies it from reuse).
- Return tracks and master are not in `song.tracks` so they're naturally
  out of scope, but if Live's API ever changes that, the scan would need
  an explicit guard.
- Frozen/muted tracks are still in scope (same as the prior selected-track
  path). If reusing a muted track turns out to be confusing, add a check
  later — kept out of this change for consistency.

## Tags
`track-preparation`, `python-surface`, `reuse-policy`, `prepare-for-preset`,
`track-management`
