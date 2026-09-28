# ADR-344: Fix Stale Parameter Cache on Track Switch

## Status
**Accepted**

## Context

ADR-327 introduced a two-tier device state cache (Max `trackDeviceStateCache` + frontend `allTracksDeviceCache`) for instant track switching. Both tiers snapshot parameter values at creation time and serve them on subsequent track switches.

The problem: neither cache tier was updated when parameter values changed. `allTracksDeviceCache.updateParameter()` existed but was never called — dead code from the original implementation. The Max cache had no update path at all.

This caused FX grid sliders to show stale values after switching away from and back to a track where parameters had been adjusted.

## Decision

Wire up cache updates in both tiers whenever a parameter value is set:

### Frontend: `deviceParameterStorage.sendParameter()`

After the optimistic `setParameterValue()` call, also call `allTracksDeviceCache.updateParameter()` to keep the frontend cache in sync. The track index is already available via `this.deps.getTrackIndex()`.

### Max: `/looping/device/set/parameter` handler

After `queryApi.set("value", value)`, update the matching parameter entry in `trackDeviceStateCache` so Max serves fresh values on subsequent track switches.

No new APIs or data structures were needed — the frontend cache already had the `updateParameter()` method, and the Max cache is a simple object that can be mutated in place.

## Consequences

**Positive:**
- FX grid shows correct parameter values when switching back to a previously visited track
- Both cache tiers stay in sync with actual parameter state
- No additional OSC traffic — updates are applied locally in both tiers

**Negative:**
- Slightly more work per parameter change (two cache lookups + mutations), but this is negligible compared to the OSC round-trip cost

## Tags

`bugfix`, `caching`, `device-parameters`, `track-switching`
