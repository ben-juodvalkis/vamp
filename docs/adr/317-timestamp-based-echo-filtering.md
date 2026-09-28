# ADR-317: Timestamp-Based Echo Filtering for Sequencer Broadcasts

**Status**: Accepted
**Date**: 2026-02-22

## Context

The sequencer store (`sequencerStore.svelte.ts`) uses origin tags from Permute's state broadcasts to decide whether to apply incoming state. The original implementation used a static `ECHO_ORIGINS` set that unconditionally skipped any broadcast with origins like `mute_step`, `mute_rate`, `mute_length`, `pitch_step`, `pitch_rate`, `pitch_length`, and `temperature`.

The problem: **Permute uses the same origin tags regardless of whether the change came from the Svelte UI (via OSC) or the Max UI (dials/buttons).** For example:

- Svelte changes mute rate → OSC command → Permute broadcasts with origin `mute_rate`
- Max UI dial changes mute rate → inlet 2 → Permute broadcasts with origin `mute_rate`

The Permute API docs (`docs/api.md`) explicitly document this as a known issue:

> The current origin-based echo filtering is broken. Both produce the same origin tags... changes made from the Max UI are never reflected in Svelte.

The only origin tags unique to Max UI are `mute_pattern` and `pitch_pattern` (full pattern changes via Max step buttons). All other parameter origins (`*_rate`, `*_length`, `temperature`) are shared between both sources.

### Observed Symptom

When changing the mute division dial in the Max patch, the browser console showed:

```
Skipping echo broadcast {"origin":"mute_rate","trackIndex":1}
```

The Svelte UI never updated to reflect the new rate.

## Decision

Replace the static `ECHO_ORIGINS` set with **timestamp-based echo filtering**, as recommended in Permute's API reference (Option 1).

### How It Works

1. Each `send*()` function in the store calls `markSent(origin)` to record the current timestamp before sending the OSC command.

2. When a broadcast arrives, `isEcho(origin)` checks if Svelte sent a command with a matching origin within the last 150ms.

3. If within the window → skip (it's an echo of our own command).
   If outside the window or never sent → apply (it's from the Max UI).

4. `set_state_ack` is always treated as an echo since it exclusively responds to our `set/state` command.

### Echo Window Duration

The 150ms window accounts for:
- WebSocket → bridge latency (~1-5ms)
- Bridge → UDP OSC to Max (~1-5ms)
- Max JS processing (~1-10ms)
- Max → UDP OSC broadcast back (~1-5ms)
- Bridge → WebSocket to browser (~1-5ms)

Total round-trip is typically 10-30ms, so 150ms provides comfortable margin without risking false positives from rapid manual Max UI changes (humans can't change a dial twice in 150ms).

## Implementation

### Changed Files

- **`sequencerStore.svelte.ts`**: Replaced `ECHO_ORIGINS` set with `lastSentTimestamps` map, `markSent()`, and `isEcho()`. Added `markSent()` calls to all seven `send*()` functions.
- **`sequencerStore.test.ts`**: Updated echo filtering tests to reflect new behavior — broadcasts without a preceding Svelte send are now correctly applied.

### Before (broken)

```typescript
const ECHO_ORIGINS = new Set([
  'set_state_ack',
  'mute_step', 'pitch_step',
  'mute_length', 'pitch_length',
  'mute_rate', 'pitch_rate',
  'mute_enable', 'pitch_enable',
  'temperature'
]);

// In handler:
if (ECHO_ORIGINS.has(origin)) {
  return; // Always skipped — even from Max UI
}
```

### After (fixed)

```typescript
const ECHO_WINDOW_MS = 150;
const lastSentTimestamps = new Map<string, number>();

function markSent(origin: string) {
  lastSentTimestamps.set(origin, Date.now());
}

function isEcho(origin: string): boolean {
  if (origin === 'set_state_ack') return true;
  const sentAt = lastSentTimestamps.get(origin);
  if (!sentAt) return false;
  return (Date.now() - sentAt) < ECHO_WINDOW_MS;
}

// In each send function:
function sendMuteRate(rateIndex: number) {
  // ...
  markSent('mute_rate');
  send('/looping/sequencer/mute/rate', args);
}
```

## Consequences

### Positive

- **Max UI changes now reflected in Svelte**: Rate, length, temperature, and pattern changes from Max dials/buttons are applied to the Svelte UI.
- **Echo suppression still works**: When Svelte initiates a change, the broadcast echo is still correctly skipped within the 150ms window.
- **No Permute changes required**: Fix is entirely in the frontend; the origin tags from Permute remain unchanged.
- **Minimal complexity**: A single `Map<string, number>` and timestamp comparison replaces the static set.

### Neutral

- The `mute_pattern` and `pitch_pattern` origins (Max UI only) were never in the old `ECHO_ORIGINS` set, so they already worked correctly. They continue to work with the new approach since `isEcho()` returns false for origins Svelte never sends.

### Risks

- If round-trip latency exceeds 150ms (e.g., network congestion on a remote setup), an echo could slip through and cause a brief UI flicker. This is acceptable — the state would be correct, just momentarily redundant. The window can be tuned if needed.
