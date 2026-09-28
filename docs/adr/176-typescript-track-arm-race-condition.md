# ADR 176: TypeScript Track Arm Race Condition Fix

**Status**: Accepted
**Date**: 2026-01-26
**Authors**: Claude
**Tags**: `track-creation`, `race-condition`, `audio-routing`, `typescript`

## Context

When creating guitar or bass tracks via the TypeScript interface (`trackPreparation.ts`), tracks were intermittently failing to arm for recording. This is the same race condition documented in ADR-115, but occurring in the TypeScript track preparation code rather than the Max4Live pedalboard code.

### The Race Condition

The track creation flow in `trackPreparation.ts` was:

1. Create audio track (via Max4Live)
2. Configure audio input routing (via AbletonOSC)
3. Track gets selected (triggers auto-arm in `session.svelte.ts`)

**Problem**: Step 3 happened immediately after step 2, but AbletonOSC hadn't finished applying the routing configuration yet. When the arm command arrived, Ableton rejected it because the track had invalid/pending routing.

### Why This Manifested for Guitar/Bass

Guitar and bass tracks require specific input routing configuration (e.g., "11/12 Guitar Mic"). Unlike MIDI tracks which can arm immediately, audio tracks with custom routing must wait for the routing to be applied before arming will succeed.

## Decision

Add explicit track arming in `trackPreparation.ts` AFTER routing is configured, with a 100ms delay to allow AbletonOSC to process the routing command.

### Implementation

1. **New helper function** in `trackPreparation.ts`:

```typescript
/**
 * Arms a track after routing configuration has settled.
 * Adds a delay to prevent race condition where arm command
 * is sent before Ableton has fully initialized routing.
 *
 * @see ADR-115 for timing rationale (100ms delay)
 */
async function armTrackAfterRoutingSettle(trackIndex: number, trackType: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, constants.timing.routingSettleDelayMs));
    send('/live/track/set/arm', [trackIndex, 1]);
    logger.debug(`Armed ${trackType} track after routing setup`, {
        component: 'trackPreparation',
        trackIndex
    });
}
```

2. **New timing constant** in `config/constants.json`:

```json
"timing": {
    "routingSettleDelayMs": 100
}
```

3. **Separation of concerns**:
   - `trackPreparation.ts`: Arms newly created tracks after routing setup (with delay)
   - `session.svelte.ts`: Auto-arms when switching between existing tracks (no delay needed)

### Why 100ms?

Per ADR-115:
- **0-50ms**: Too short, OSC messages may not be processed
- **100ms**: Safe buffer for OSC message transmission and processing
- **500ms+**: Noticeable UX lag

The 100ms delay is consistent with the Max4Live implementation and provides reliable arming without perceptible delay.

### Alternative: Delay All Auto-Arms

Initially considered adding a 150ms delay to ALL track selections in `session.svelte.ts`. This was rejected because:
- Adds unnecessary lag when switching between existing tracks
- Only new tracks with routing configuration need the delay
- Violates single responsibility principle

## Consequences

### Positive

- Tracks reliably arm after creation via TypeScript track preparation
- No unnecessary delay when switching between existing tracks
- Consistent with ADR-115 approach (100ms delay)
- Centralized arming logic via helper function
- Configurable delay via `constants.json`

### Negative

- Timing-based solution (assumes 100ms is sufficient)
- No feedback mechanism to verify arm succeeded
- Newly created tracks may receive two arm commands (one from trackPreparation, one from auto-arm)

### Redundant Arm Commands

When a track is created:
1. `trackPreparation.ts` arms the track after routing (with 100ms delay)
2. `session.svelte.ts` auto-arms when track selection changes (immediately)

The second arm command is redundant but harmless - arming an already-armed track is a no-op. The explicit arm in `trackPreparation.ts` is the reliable one; the auto-arm in `session.svelte.ts` serves as a backup and handles the switching-between-existing-tracks case.

## Related

- **ADR-115**: Max4Live track arm race condition (same root cause, Max4Live implementation)
- **Issue #289**: Bug report for guitar/bass track arming failures
- **Track Creation Flow**: `interface/src/lib/services/trackPreparation.ts`
- **Auto-Arm Logic**: `interface/src/lib/stores/session.svelte.ts`

## Files Changed

- `config/constants.json`: Added `routingSettleDelayMs` timing constant
- `interface/src/lib/services/trackPreparation.ts`: Added `armTrackAfterRoutingSettle()` helper, used in 3 track creation paths
- `interface/src/lib/stores/session.svelte.ts`: Added documentation comment explaining separation of concerns
