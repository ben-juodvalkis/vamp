# ADR-375: Mute/Solo Control M4L Device

## Status
**Accepted**

## Context

The Python Control Surface owns all LOM interaction for the main looping workflow, but mute and solo are needed as quick gesture controls driven by an external Max patch (foot controller or key controller), not by the SvelteKit UI. Adding a UDP/OSC route through the Python surface for something this lightweight would add round-trip latency and a new OSC address to maintain.

A standalone M4L device with a patchable inlet is the right scope: it sits on any track, receives list messages from whatever Max patch is upstream, and writes directly to the LOM — no bridge, no network hop.

## Decision

Created `owner/mute-solo-control/` containing:

- `mute-solo-control.maxpat` — minimal patch: one inlet wired to a `[v8]` object
- `mute-solo-control.js` — ES5 v8 JS; all logic lives here

**Message protocol** (list into the device inlet):

```
<trackNum> mute toggle    — toggle mute on standard track N
<trackNum> solo toggle    — toggle solo on standard track N
```

`trackNum` is 1-based, indexing only standard tracks (`live_set.tracks`); return tracks and master are never touched.

**Solo pool:** solo presses accumulate — each one adds track N to an in-memory pool and solos it in the LOM. Multiple tracks can be soloed simultaneously by sending successive solo commands.

**Selected track pin:** on the *first* solo press (pool was empty), if the currently selected track is a different standard track with no clip playing, it is also force-soloed ("pinned"). Subsequent solo presses do not re-evaluate the pin — the pin is set once and held. If the selected track has a clip playing it is not pinned; it is already contributing to the mix.

**Un-solo removes from pool:** toggling solo off on track N removes it from the pool. When the last pooled track is un-soloed (pool empties), the pinned selected track is also cleared, returning to normal playback.

**Mute and solo are independent** — soloing does not clear mute and vice versa.

**Init:** `autowatch = 1`; no `loadbang` or deferred Task needed because the JS constructs fresh `LiveAPI` path lookups on every incoming message rather than caching patcher handles at load time.

## Consequences

- Zero bridge/network dependency — works even when the OSC bridge is not running.
- The device must live on a track in the Live set; it is not a MIDI Effect and has no audio i/o, so it should be placed on a dedicated utility track or the track hosting `Track Key Controls`.
- `soloedPaths` and `pinnedSoloPath` are module-level state in the v8 script. If the device is reloaded mid-session (e.g. via `autowatch` re-parse), both are reset and any active solos become orphaned in the LOM. Acceptable edge case for a utility device — workaround is to toggle solo off and on again.
- The playing-clip check (`has_clip` + `is_playing` across all clip slots) iterates every slot on the selected track at the moment of the solo command. On sets with many scenes this adds a small per-command cost, but it is synchronous and bounded by scene count, not continuous.

## Tags
`m4l`, `mute`, `solo`, `v8`, `foot-controller`, `lom`
