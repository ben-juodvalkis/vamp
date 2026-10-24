# ADR-468: New Audio and New MIDI Always Create a Track

## Status
**Accepted** (2026-10-24). Supersedes ADR-464's reuse rule for the two
buttons; the rest of ADR-464 stands. Needs a Live restart (surface).

## Context
ADR-464's buttons sent `prepare_for_preset` with no preset, which runs
the surface's reuse-vs-create decision: the selected track if empty and
of the kind, else the lowest-numbered empty one, else a new track. A
press could therefore land on an empty track somewhere else in the set
rather than making the track the button names.

## Decision
**A New button always creates.** It sends `target_track_path` `new`,
which skips the decision: the surface creates a track of that kind at
the end of the set (audio armed and routed, Permute appended, selected)
and acks `was_created=1`. Preset loads from the browser and everything
else that sends no target keep the reuse rule.

## Consequences
- Every press is a new track; two presses are two tracks.
- Empty tracks are no longer filled by the buttons, only by preset loads.
- A surface from before this change reads `new` as a malformed pinned
  path and nacks `invalid-args`, so the buttons fail until Live restarts.

## Tags
`tracks`, `new-track`, `wire`, `prepare_for_preset`
