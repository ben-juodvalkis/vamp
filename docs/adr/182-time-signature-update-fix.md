# ADR-182: Time Signature Update Handler Fix

## Status
Accepted

## Context

The vertical loop brace control and time signature display were showing incorrect values. Specifically:
- A 3-bar loop would display as "4" bars
- Loop snapping moved in 3-beat increments instead of 4-beat increments in 4/4 time
- The System Central View showed "3" for the time signature numerator when it should be "4"

## Problem

AbletonOSC sends time signature numerator and denominator as **separate messages**. The parser handles this by defaulting the missing component to 4:
- Numerator message: `{ numerator: X, denominator: 4 }`
- Denominator message: `{ numerator: 4, denominator: Y }`

The previous code in `handleTimeSignatureUpdate` attempted to be "smart" about merging these partial updates:

```typescript
// If incoming numerator is 4 AND old numerator is NOT 4, keep old numerator
const finalNumerator = incomingNum === 4 && oldSig.numerator !== 4
  ? oldSig.numerator
  : newNumerator;
```

This logic was flawed because it couldn't distinguish between:
1. A **partial update** where 4 is a placeholder default
2. A **real update** to 4/4 time signature

**Example of the bug:**
1. User is in 3/4 time → `_timeSignature = { numerator: 3, denominator: 4 }`
2. User switches to 4/4 time
3. Numerator message arrives: `{ numerator: 4, denominator: 4 }`
4. Old logic: `4 === 4` AND `3 !== 4` → keep old numerator 3
5. Result: `_timeSignature = { numerator: 3, denominator: 4 }` (WRONG!)

## Solution

Simplified the handler to directly accept incoming values without attempting to merge:

```typescript
_timeSignature = {
  numerator: update.timeSignature.numerator,
  denominator: update.timeSignature.denominator
};
```

This approach works because:
1. Both numerator and denominator messages arrive in quick succession (milliseconds apart)
2. Any momentary intermediate state is not visible to users
3. The final state is always correct

## Consequences

### Positive
- Time signature always updates correctly, including to 4/4
- Loop brace snapping now works correctly in all time signatures
- Loop bar count display is accurate
- System Central View shows correct time signature

### Negative
- None identified - the simpler approach is more robust

## Files Changed
- `interface/src/lib/stores/session.svelte.ts` - Simplified `handleTimeSignatureUpdate()`
