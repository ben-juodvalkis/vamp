# ADR 040: Complete State Architecture - Query-Based Parameter System

**Date:** 2025-10-12
**Status:** Implemented
**Context:** Device parameter performance optimization

## Problem

The original observer-based system for device parameters created performance issues:
- 85+ parameter observers created on track switch
- Reactive cascades between frontend and Max
- 500-800ms track switch time
- Complex subscription lifecycle management
- Race conditions and duplicate subscriptions

## Decision

Implement **query-based complete state architecture** where Max sends all device and parameter data in a single message, eliminating real-time observers for device parameters.

## Architecture

### Core Principle: Backend is Source of Truth

**Max (Backend):**
- Knows all devices on track
- Knows which parameters matter (from device-configs.json)
- Queries all values once
- Sends complete state in single message

**Frontend:**
- Receives complete state
- Stores in simple reactive Map
- Components read once when device changes
- No subscriptions, no observers

### Message Flow

```
Track Switch:
1. Max detects track change
2. Max queries all devices + configured parameters
3. Max sends /looping/devices/complete_state (single message)
4. Frontend parses → populates Map<deviceId, Map<paramIdx, value>>
5. Components' $effect runs → reads from Map once
6. UI displays → Done

User Interaction:
1. User drags slider
2. Component updates local state (visual)
3. Component sends parameter to Ableton
4. No Map update - component owns visual state
5. Next track switch refreshes Map with truth
```

### Data Structure

**Simple Map Storage:**
```typescript
class DeviceParameterStorage {
  private parameters = $state(new Map<number, Map<number, number>>());

  getParameterValue(deviceId, paramIdx) { /* read */ }
  setParameterValue(deviceId, paramIdx, value) { /* write from complete state */ }
  sendParameter(deviceId, paramIdx, value) { /* send to Ableton only */ }
}
```

**No:**
- ❌ Subscription tracking
- ❌ Observer lifecycle
- ❌ Debounce timers in storage
- ❌ LRU cache eviction
- ❌ Optimistic updates (tried, caused complexity)

## Component Pattern

**Parent Component (FX Grid / Central View):**
```typescript
let paramValue = $state(defaultValue);

$effect(() => {
  if (device) {
    paramValue = store.getParameterValue(device.id, paramIdx) ?? defaultValue;
  } else {
    paramValue = defaultValue;
  }
});
```

**Reads once when device changes, then component owns the value.**

**Slider Component (DeviceXY, DeviceSlider, etc.):**
```typescript
let localValue = $state(value); // From prop

$effect(() => {
  localValue = value; // Sync from prop
});

// User drags
onInteraction={(newValue) => {
  localValue = newValue; // Update local
  onChange(newValue); // Send to Ableton
}}
```

**Why sync from prop is safe:** Props only change on track switch (no observers), never during drag.

## Trade-offs

### What We Lost
- Real-time updates from external sources (MIDI controllers, automation)
  - **Acceptable:** Single-user system, updates visible on next track switch
- Incremental device updates
  - **Acceptable:** Complete state fast enough (~150-200ms)

### What We Gained
- **3-4x faster track switching** (500-800ms → 150-200ms)
- **97% fewer messages** (41 messages → 1 message)
- **Zero observer overhead** in LiveAPI
- **Impossible to desync** (always complete state)
- **Dramatically simpler code** (~300 lines deleted)
- **Bulletproof reliability** (no reactive cascades, no race conditions)

## Performance

**Before:**
- Track switch: 500-800ms
- Messages: 41 (9 Max→Client, 32 Client→Max)
- Observers: 85+ created on every track switch
- Complexity: High

**After:**
- Track switch: 150-200ms
- Messages: 1 (Max→Client only)
- Observers: 0
- Complexity: Low

## Device Configuration Requirement

**Critical:** All devices used in FX Grid, instruments, and middle panel MUST have complete configs in `data/device-configs.json`.

**Why:** Max queries parameters based on config. Missing config = no parameters in complete state = UI doesn't update.

**Current:** 23 device types, 115 parameters configured

## Future Enhancements

If real-time updates needed later:

```javascript
// In Max - optional hybrid mode
if (ENABLE_REALTIME_OBSERVERS) {
  // Also set up observers after sending complete state
  setupParameterObservers(devices);
}
```

Best of both: Fast init (complete state) + real-time updates (observers).

## Implementation Notes

- Device lookup: className:deviceName first, fallback to className
- ID-based Map keys (stable across reordering): `trackIdx-deviceId-paramIdx`
- Sequencer uses same pattern with pending params support
- Slider components: DeviceXY/DeviceSlider/DeviceVerticalSlider (device params) vs VerticalSlider (observed properties like clip/groove)

## References

- Implementation Plan: `documentation/current-project/device-revamp/00-OVERVIEW.md`
- Implementation Checklist: `documentation/current-project/device-revamp/05-IMPLEMENTATION-CHECKLIST.md`
- Related: ADR-039 (Device Subscription Optimization - superseded by this)
