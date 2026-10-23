# ADR-461: The Foot Pedal's Hold Readies the Next Take

## Status
**Accepted** (2026-10-23). Branch `foot-hold-next-take`, `c98fdfd`.
Surface change: needs a full Live restart. Supersedes the hold half of
ADR-326 (hold creates an armed audio track); the tap is unchanged.

## Context
The foot pedal has two gestures. The tap walks the highlighted slot
through the looper cycle: an empty slot records, a recording clip closes
the take and loops it, a stopped clip plays, and a playing clip toggles
overdub (`FootTriggerComponent.handle_tap`). Since ADR-326 the hold
(650 ms, `osc.footTrigger.holdThresholdMs`) created an audio track,
armed and routed it, and appended Permute.

Together they left no pedal path to "record a new clip". A strip tap
aims the pedal at the clip that track is playing, and a closed loop
leaves the pedal on that loop, so the next stomp lands on a playing
clip and overdubs. Recording a fresh take meant touching the clip grid
first. Making a track is a choice of what kind (audio or MIDI), which
is better made on the screen than with a foot.

## Decision
**A hold readies the next take on the selected track.** It stops the
track's clips (`track.stop_all_clips()`, quantized like Live's own stop)
and highlights the first slot below the selected scene that holds no
clip. When every slot below is full it appends a scene and highlights
the new slot. The next tap records there. The selection is read from
Live (`song.view.selected_track` / `selected_scene`), as the tap reads
the highlighted slot.

**A hold on anything but a regular track does nothing.** A group track
is skipped: stopping it stops every member, and its slots never hold a
clip, so "the next empty slot" means nothing there. The master and a
return are skipped because they have no slots to record into. Each case
logs one INFO line.

**Track creation leaves the pedal.** It moves to the tracks panel's
New Audio / New MIDI buttons (ADR-462). `FootTriggerComponent` drops the
track-creation code, its constants, the auto-arm gate, the Permute
closure and the 5 s rate limit. `/looping/v3/track/created` leaves the
wire contract; nothing had sent it since the hold's Permute moved to
Python.

## Consequences
- The pedal alone runs record → loop → next take → record, on one track,
  without touching the iPad. The take you leave stops, so the new one
  isn't recorded over it.
- Appending a scene adds a scene to the whole set. A hold on the last
  row of a full track always grows the set by one row.
- The hold no longer makes a track, so a performer used to hold-to-create
  must use the buttons. A hold that used to build a track now stops the
  one under the selection.
- Not yet measured on the rig: the stop's quantization against a take
  that is still recording when the hold lands.

## Tags
`foot-pedal`, `foot-trigger`, `hold`, `session-recording`, `looper`
