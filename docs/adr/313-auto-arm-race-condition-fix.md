# ADR 313: Auto-Arm Race Condition Fix (Updated: Retry-Based)

**Status**: Accepted (Updated 2026-01-31)
**Date**: 2026-01-30 (Updated 2026-01-31)
**Authors**: Claude
**Tags**: `track-creation`, `race-condition`, `audio-routing`, `auto-arm`, `retry`

## Context

Despite two previous fixes for track arming race conditions (ADR-115 for Max4Live and ADR-176 for TypeScript), guitar and bass tracks were still intermittently failing to arm for recording.

### Original Problem

The original fix added a 100ms hardcoded delay before arming. While this worked in most cases, the user raised a valid concern:

> "I don't love these hardcoded delays. What if Ableton takes longer?"

A hardcoded delay is fragile - if Ableton is under load or the system is slow, routing could take longer than 100ms and arming would still fail.

## Decision

Replace hardcoded timing delays with **retry-based arming with confirmation**.

Instead of:
```typescript
await new Promise(r => setTimeout(r, 100));  // Hope 100ms is enough
send('/live/track/set/arm', [trackIndex, 1]);
```

Now using:
```typescript
for (let attempt = 1; attempt <= maxRetries; attempt++) {
    send('/live/track/set/arm', [trackIndex, 1]);
    await new Promise(r => setTimeout(r, 50 * attempt));  // Exponential backoff

    const isArmed = await queryArmState(trackIndex);  // Actually verify!
    if (isArmed) return true;
}
```

### Implementation

#### 1. Query Arm State Helper

Both `trackPreparation.ts` and `session.svelte.ts` now have a `queryArmState()` function that:
- Sends `/live/track/get/arm` query to AbletonOSC
- Listens for the response via `osc-message` event
- Returns `true` if armed, `false` otherwise
- Times out after 200ms (assumes not armed)

```typescript
async function queryArmState(trackIndex: number): Promise<boolean> {
    return new Promise((resolve) => {
        const handler = (evt: CustomEvent) => {
            const msg = evt.detail;
            if (msg.address === '/live/track/get/arm') {
                const [respTrackIndex, armState] = msg.args;
                if (respTrackIndex === trackIndex) {
                    window.removeEventListener('osc-message', handler);
                    resolve(armState === 1);
                }
            }
        };
        window.addEventListener('osc-message', handler);
        send('/live/track/get/arm', [trackIndex]);

        setTimeout(() => {
            window.removeEventListener('osc-message', handler);
            resolve(false);
        }, 200);
    });
}
```

#### 2. Retry-Based Arming

`armTrackWithRetry()` in `trackPreparation.ts`:
- Up to 3 retry attempts
- Exponential backoff: 50ms → 100ms → 150ms wait between attempts
- Verifies arm state after each attempt
- Logs success or failure

#### 3. Auto-Arm on Track Selection

`updateTrackArming()` in `session.svelte.ts`:
- Same retry pattern as above
- Runs asynchronously on track selection
- Disarms other tracks after arming succeeds

#### 4. Max4Live Fallback

The Max4Live pedalboard arm (`liveAPI-v6.js`) retains its 100ms delay as a backup.
Since the TypeScript side now handles arming robustly with retries, the Max4Live
arm is often redundant - but arming an already-armed track is a no-op, so it's harmless.

## Consequences

### Positive

- ✅ **Adapts to actual Ableton response time** - not relying on fixed delay
- ✅ **Self-healing** - retries if first attempt fails (Ableton under load)
- ✅ **Verifies actual state** - doesn't just hope the command worked
- ✅ **Fast when things work** - first attempt may succeed in 50ms
- ✅ **More robust** - 3 attempts with increasing wait times

### Negative

- ⚠️ **Slightly more complex** - query/response pattern vs simple delay
- ⚠️ **Multiple OSC messages** - query adds overhead (but minimal)
- ⚠️ **Redundant arm commands** - both session.svelte.ts and trackPreparation arm

### Performance Characteristics

| Scenario | Old (100ms delay) | New (retry-based) |
|----------|-------------------|-------------------|
| Fast Ableton | 100ms wait | ~50-100ms |
| Slow Ableton | May fail | Adapts, retries |
| Very slow | Fails | Up to ~300ms total |
| Already armed | 100ms + no-op | ~50ms verify + done |

## Files Changed

- `interface/src/lib/services/trackPreparation.ts`:
  - Replaced `armTrackAfterRoutingSettle()` with `armTrackWithRetry()`
  - Added `queryArmState()` helper
  - Removed `constants.json` import (no longer needed)

- `interface/src/lib/stores/session.svelte.ts`:
  - Updated `updateTrackArming()` with retry logic
  - Added `queryArmState()` helper

- `ableton/scripts/liveAPI-v6.js`:
  - Updated comments to indicate this is now a fallback

## Testing

To verify the fix works:

1. Create a new guitar track (via browser or pedalboard)
2. Track should reliably arm after creation
3. Switching between existing tracks should feel instant
4. Try creating tracks while Ableton is under heavy load - should still work
5. No more intermittent arm failures

## Related

- **ADR-115**: Max4Live track arm race condition (pedalboard track creation)
- **ADR-176**: TypeScript track arm race condition (trackPreparation.ts)
- **Issue #313**: Discussion of retry-based solution
- **Track Creation Flow**: `interface/src/lib/services/trackPreparation.ts`
- **Auto-Arm Logic**: `interface/src/lib/stores/session.svelte.ts`
- **Max4Live Track Creation**: `ableton/scripts/liveAPI-v6.js`
