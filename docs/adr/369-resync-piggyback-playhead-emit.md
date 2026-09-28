# ADR-369: Re-emit `playing_slot` on `state/resync`, not just on handshake accept

## Status
**Accepted** (2026-05-04)

## Context

A user-reported "create a clip and it doesn't show up" symptom turned
out to depend on tab visibility, not on the clip-create path itself.
Sequence that reproduces the bug:

1. UI is connected. User Cmd-Tabs to Ableton. Browser fires
   `visibilitychange → hidden`.
2. User creates a clip in Live (any path: drag-in audio, empty MIDI,
   paste).
3. User Cmd-Tabs back to the browser. `visibilitychange → visible`
   fires → `clientWatchdog` dispatches the `bridge-resync` window
   event.
4. `playingClipsStore`'s `bridge-resync` listener clears every
   per-track entry.
5. UI sends `/looping/v3/state/resync`.
6. Surface re-emits `state/full` and that's it. **No `playing_slot`
   re-emit.**
7. UI's `playingClipsStore` stays empty. `TrackStrip` gates
   `<TrackClipView />` on `hasClip`, so the strip never mounts. User
   sees the clip in Live but not in the UI until either a hard reload
   (which runs the full handshake-accept chain) or a recording event
   (which fires `clip.is_recording` listener → re-emits
   `playing_slot`).

The "recording works" carve-out had been the source of confusion all
along. Recording fires real LOM listeners that re-emit `playing_slot`
independent of the handshake; non-recording clip creation depends on
the slot-change emit firing while the UI is connected and not
mid-resync-clear.

The structural reason: `state/full` is track-scoped and carries slot
identity + clip name + length. It does **not** carry `file_path`,
`loop_start`, `loop_end`, `looping`, or `is_audio_clip` — those live
exclusively on the `/looping/v3/track/playing_slot` wire owned by
`PlayheadComponent`. ADR-361 established this split deliberately; the
`emit_on_accept` chain in `LoopingSurface.py` already piggybacks
`PlayheadComponent.emit_on_accept()` onto handshake accept so the
fields are re-seeded after a fresh connect. The `state/resync` path —
which targets exactly the same UI-side staleness problem, just
triggered by visibility-resume instead of WS reconnect — was missing
the same piggyback.

`PlayheadComponent.emit_on_accept` was written to be re-callable
(clears the per-track dedup cache, then runs `_emit_initial_values`)
precisely so this sort of seed could be reused. The fix is just to
call it.

## Decision

Build a `_emit_on_resync_chain` parallel to the existing
`_emit_on_accept_chain` and wire it as the `state_full_on_resync`
callback. The chain calls `V3StateFullComponent.emit_on_resync()`
first (preserves prior behaviour), then
`PlayheadComponent.emit_on_accept()` to re-seed the playing-slot
render context.

```python
def _emit_on_resync_chain():
    self._v3_state_full_component.emit_on_resync()
    playhead = getattr(self, "_playhead_component", None)
    if playhead is not None:
        playhead.emit_on_accept()
self._devices_component.set_state_full_on_resync(_emit_on_resync_chain)
```

Defensive `getattr` guard mirrors the equivalent calls inside
`_emit_on_accept_chain` — `state/resync` only arrives after full
construction, but cheap insurance.

Scope deliberately kept narrow: only `playhead` is added to the
resync chain. The accept chain also re-seeds session attrs,
session-settings toggles, focused-clip properties, selected-track
path, exclusive-arm state, and groove. None of those were observed
broken on visibility-resume. The session attrs and selected-track
path don't get cleared by `bridge-resync`; the others have their own
listener-driven echo paths that recover on the next user gesture.
Adding them all would be defensible but speculative — revisit if a
matching symptom shows up.

## Consequences

**Positive**

- Tab-resume after a clip-create in Live now shows the strip without
  a hard reload.
- `playingClipsStore` is consistent across all reconnect paths:
  WS-reconnect (handshake accept), visibility-resume
  (`bridge-resync` → `state/resync`), and live LOM changes
  (slot-index flip, has_clip fanout, recording-stop). One mental
  model.
- No new wire address, no new component method. Reuses
  `emit_on_accept`'s existing dedup-clearing + `_emit_initial_values`
  walk.

**Negative / risks**

- A user who triggers many tab-switches in quick succession will
  re-emit one `playing_slot` per regular track each time. Each emit
  is a small OSC frame and the dedup cache still suppresses
  byte-identical follow-ups, so the cost is bounded. No new dedup
  layer needed.
- If a future component's `emit_on_accept` is added to the accept
  chain but not the resync chain, this pattern silently regresses.
  Long-term either both chains should be one function, or the
  resync chain should iterate the same list. Left for a follow-up
  if more components surface the same gap.

**Why not just emit `playing_slot` from `state/full`?**

Considered and rejected. `state/full` is a chunked snapshot of the
LOM tree shape; mixing per-track render-context fields into it would
mean every reader has to know about both shapes, and the v3 wire
contract documents the split deliberately. The emit_on_accept piggyback
pattern keeps each address typed and lets the consumer pick which
seeds it cares about.

**Why not re-emit on the UI side from cached state?**

The UI clears `playingClipsStore` on `bridge-resync` precisely because
it can't trust local state to still match the surface. Reloading from
the surface is the correct cache-tear strategy; the bug was that
reloading was incomplete.

**Tests**

- 54 existing PlayheadComponent unit tests pass — `emit_on_accept`
  contract is unchanged.
- 4 existing DevicesComponent state/resync tests pass — they verify
  that the injected callback fires, identity-agnostic.
- 1022 UI unit tests pass; production build clean.
- Manual verification: hidden→visible flip after a non-recording
  clip create now produces the strip. Confirmed against an empty
  MIDI clip on track 1 — strip mounts immediately on tab return.

## Files

- `surface/LoopingSurface.py` —
  `set_state_full_on_resync` callback now wraps the v3 state/full
  emit + `playhead.emit_on_accept()`.

## Tags

`playing-slot`, `state-resync`, `bridge-resync`, `visibility-resume`,
`handshake`, `playhead-component`, `adr-360`, `adr-361`, `adr-363`
