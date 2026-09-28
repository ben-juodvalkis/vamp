# ADR-361: Clip-view spam audit — six bounded fixes

## Status
**Accepted** (2026-04-30)

## Context

After the ADR-360 all-tracks clip-observability rollout and the perf
sweep that landed across `da9c12a` (split playingClipsStore into
gestural + audio-rate channels), `7dd284d` (stop redrawing
`TrackClipView` on every 30 Hz playhead tick), and `aea9196` (throttle
`notes/changed` + skip notes re-fetch while recording), an audit of the
clip-view code path turned up six residual spam vectors. None were
actively on fire — the headline 30 Hz / 4 Hz throttles and the LRU peak
cache held — but each represented either wire churn that scaled
poorly with track count or a latent correctness gap.

The audit was triggered by the question "are we spamming the API,
network, stores etc?" against the recently landed work in:

- `interface/src/lib/components/v6/tracks/TrackStrip/components/TrackClipView.svelte`
- `interface/src/lib/components/v6/tracks/TrackStrip/components/TrackClipMidiView.svelte`
- `interface/src/lib/stores/v6/playingClipsStore.svelte.ts`
- `interface/src/lib/services/clipNotesService.ts`
- `surface/components/PlayheadComponent.py`

Six concrete vectors were identified (one further candidate around
`SvelteMap` per-key reactivity was retracted on closer reading — the
reactive `Map` API in Svelte 5 already invalidates per-key, so that
case never spammed). One additional candidate around an `_emit_initial_values`
storm on structural rebind was folded into the dedup work below.

## Decision

Land six layered fixes — three on the Python surface side, two in the
TS notes service, one in the playing-clips store — each small enough to
review and revert independently. None change wire shape; all are
internal optimizations / correctness tightenings.

### 1. PlayheadComponent: highlight-move guard

`_on_highlight_changed` walked every stopped track and ran
`detach + attach + emit` even when the resolved display slot was
unchanged. Pressing `↓ ↓ ↓` through clip slots in Live's session view
fired `O(stopped_tracks)` listener churn per keypress.

Now: compare the resolved `display_idx` to the existing
`_clip_listeners[path]['slot_idx']` and short-circuit when equal.

### 2. PlayheadComponent: content-based emit dedup

`_emit_playing_slot` and `_emit_playing_slot_empty` now route through
a new `_emit_playing_slot_dedup` helper that compares the outgoing
payload to `_last_emitted_payload[track_path]`. Identical payloads are
suppressed — the UI's store entry for that path is already in the
matching state, so the wire emit is wasted.

This collapses the post-`on_structural_change` re-emit storm: surviving
tracks whose state didn't change keep the cached payload and produce no
wire traffic; only tracks that actually changed (added/removed/reordered)
emit. The dedup map is intentionally **not** cleared in
`on_structural_change` — only stale paths (tracks that disappeared) are
pruned.

### 3. PlayheadComponent: clear `_warned` on structural rebind

The `_warned` set survived `on_structural_change`, meaning a torn-down
LOM wrapper that warned once would silence a future genuine raise on the
freshly rebound wrapper. Cleared now alongside the listener detach.

### 4. clipNotesService: single-flight `requestNotes` per `clipPath`

`requestNotes` issued a fresh `request_id` per call; the Python LRU is
keyed on `request_id`, so concurrent calls for the same `clipPath`
forced N full LOM reads + N blob round-trips on the surface. Concurrent
callers now share one in-flight `Promise<MidiNote[]>`. The shared
promise drops on settle so a later request after resolution issues a
fresh round-trip.

The `__resetClipNotesServiceForTests` helper clears the new
`inflightByClipPath` map. The `.finally()` cleanup is guarded so a
between-issue-and-settle test reset cannot clobber a fresh promise.

### 5. clipNotesService: multi-subscriber `subscribeNotesChanged`

`subscribers` was a `Map<clipPath, callback>` — a second subscribe for
the same `clipPath` silently replaced the first. With
`TrackClipMidiView` and `ClipCentralView` potentially showing the same
clip, that's a latent dropped-update bug.

Now: `Map<clipPath, Set<callback>>`. `handleClipNotesChanged` iterates
a `Array.from(set)` snapshot so a callback that registers/unregisters
during fire doesn't mutate the set being walked. Each release function
removes only its own callback; the entry is dropped from the map when
the set goes empty.

### 5b. PlayheadComponent: `emit_on_accept` re-seed (PR review follow-up)

State/full carries slot path / state / clip name / length / color /
pitch but **not** the fields the strip render needs from
`playing_slot` — `file_path`, `loop_start`, `loop_end`, `looping`,
`is_audio_clip`. Pre-PR the strip already had a latent bug here (LOM
listeners only fire on actual changes; a stationary-state reconnect
produced no listener fires); the dedup added in §2 made it acute by
suppressing the byte-identical re-emit attempt that *would* have
landed if a future refactor ever added one.

`PlayheadComponent.emit_on_accept` clears `_last_emitted_payload` and
calls `_emit_initial_values()`. Wired into the
`_emit_on_accept_chain` in `LoopingSurface.py` alongside every other
component's accept hook. Resolves the reviewer-flagged blank-strip-on-
reconnect risk.

### 6. playingClipsStore: clipPath → trackPath reverse index

`patchLoopWindowFromProperty` walked every entry in `playingClips` on
every `loop_start` / `loop_end` / `looping` property fire. During a
brace drag this was 30 Hz × N tracks of map iteration. With the
reverse index, lookup is O(1); the fallback "no entry matches" stays
silent.

The reverse index is maintained inside `applyPlayingSlot`: the prior
`clipPath`'s mapping is dropped before the new one is registered, so
slot rotations don't leak stale entries. Cleared alongside the other
maps on `bridge-resync` and `__resetPlayingClipsStoreForTests`.

## Consequences

### Positive

- **Steady-state wire churn drops** in two scenarios: highlight-sweep
  through stopped tracks, and structural rebinds on already-correct
  state.
- **`patchLoopWindowFromProperty`** is now O(1) per property fire,
  removing the only per-30Hz O(N_tracks) loop on the property-change
  path.
- **Multi-subscriber notes** unlocks the strip + central-view "render
  the same clip" case without dropping updates.
- **Single-flight notes** caps the worst-case `notes/get` traffic at
  one round-trip per clipPath in flight, regardless of caller count.
- **`_warned` clearing** restores the diagnostic value of one-shot
  warnings post-rebind.
- All wire shapes unchanged — no contract migration for downstream.

### Negative

- The dedup cache `_last_emitted_payload` adds one tuple per track to
  the surface's resident memory. Bounded by `n_tracks`; trivial.
- Single-flight `requestNotes` means the new `notes/get` after a
  reply-resolve only issues once the prior promise has settled. A
  caller that sees stale data and retries within the same microtask
  will get the same stale result. The notes-changed poke will trigger
  a fresh fetch on the next event loop tick — acceptable.
- Reverse index assumes `clipPath` uniqueness across `playingClips`.
  Today guaranteed: each track has one playing entry, paths are
  positional. If we ever surface multiple display slots per track, the
  index needs to become `Map<clipPath, Set<trackPath>>`.
- The dedup behaviour means `_emit_playing_slot_empty` redundancy is
  silently suppressed; `test_slot_change_to_minus_one_on_empty_track_emits_empty`
  needed a `c._last_emitted_payload.clear()` to re-assert listener-fire
  payload shape. The dedup itself is covered by separate tests
  (`test_emit_playing_slot_dedupes_identical_payloads`,
  `test_emit_playing_slot_empty_dedupes`,
  `test_emit_playing_slot_fires_when_payload_changes`).

## Validation

35 PlayheadComponent tests pass (8 new). 39 TS tests across
`clipNotesService` + `playingClipsStore` pass (10 new). Full Python
suite: 1399 / 1399. Full TS suite: 989 / 989 across 57 files.
Production build green.

Manual validation checklist: see
`documentation/clip-view-spam-audit-validation.md`.

## Tags
`performance`, `observability`, `clip-view`, `playhead`, `notes`,
`adr-360-followup`
