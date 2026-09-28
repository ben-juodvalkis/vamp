# ADR-318: Migrate Note Chance from Direct Clip Manipulation to Permute Device

## Status
Accepted

## Context
Note chance (probability) was implemented as a direct clip manipulation feature: the UI sent `/cmd/set_clip_note_chance` to liveAPI-v6.js, which used the Live API to modify `note.probability` on every note in a clip. This had several problems:

- **No persistence across track switches** — `noteChance` was component-local state (`$state(100)`) in ClipCentralView, resetting to 100 on every mount
- **Fire-and-forget** — no broadcast round-trip, no echo filtering, no state cache
- **Not in sequencerStore** — no ghost editing support, couldn't be included in `sendCompleteState`
- **Percentage mismatch** — used 0-100 while everything else uses 0.0-1.0
- **Permanent modification** — directly altered clip data rather than applying transiently like temperature

Meanwhile, the Permute device (extracted sequencer) already had full chance support wired: OSC routing, command handler, Max UI handler, broadcast at arg index 29, and state get/set.

## Decision
Migrate note chance to the sequencerStore → Permute device pattern, matching temperature exactly. Remove the legacy direct clip manipulation path entirely since Permute auto-loads via ghost editing when any sequencer parameter is adjusted on a track without the device.

## Changes

### Frontend (this repo)
- **sequencerStore.svelte.ts**: Added `chance` state (default 1.0), `sendChance()`, active/ghost handlers, broadcast interface field, `applyFullState`/`resetToDefaults`, both `sendCompleteState` payloads, store exports
- **maxObserverHandler.ts**: Parse chance at broadcast arg 29 (backward-compatible default to 1.0 if absent)
- **ClipCentralView.svelte**: Replaced local `noteChance`/`handleNoteChanceChange` with store-derived `chance` and device/ghost handler routing
- **messageRouter.js**: Removed `/cmd/set_clip_note_chance` route
- **liveAPI-v6.js**: Removed `handleSetClipNoteChance()` function and routing in `anything()`/`list()`
- **clipOperations.ts**: Updated comment

### Permute device (external repo)
Chance was already fully wired: `/looping/sequencer/chance [deviceId, value]` OSC routing, broadcast at index 29, Max UI inlet handling, state persistence.

## Value Range
Everything is 0.0-1.0 end-to-end. The old percentage (0-100) conversion is eliminated.

## Consequences
- Chance now has full parity with temperature: persistence, echo filtering, ghost editing, cached state per track
- Auto-load works: adjusting chance on a track without Permute triggers device load, then `sendCompleteState` pushes chance to the new device
- The old direct clip manipulation path is removed — no fallback needed since Permute auto-loads
- Requires Permute device with chance support (already available)
