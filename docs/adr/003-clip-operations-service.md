# ADR 0003: Clip Operations Service Layer

**Status**: ✅ Accepted and Implemented
**Date**: October 2025
**Deciders**: Architecture Review
**Context**: Post V6 stores migration, need unified clip operations layer

## Context and Problem Statement

After migrating clip state to dedicated stores (`clipPropertiesStore`, `clipGrooveStore`), we had 200+ lines of complex transpose logic embedded directly in `MiddlePanelV6.svelte`. This created several problems:

1. **No Reusability**: Transpose logic locked in one component
2. **Mixed Concerns**: UI component handling complex business logic
3. **Difficult Testing**: Can't test operations without rendering component
4. **Hard to Extend**: Adding new clip operations (duplicate, quantize, etc.) would repeat the same pattern
5. **Unclear Ownership**: Which component should own which clip operations?

**Question**: How do we organize clip manipulation operations (transpose, duplicate, quantize, etc.) in a way that's reusable, maintainable, and extensible?

## Decision Drivers

- **Existing Pattern**: `trackPreparation.ts` already demonstrates successful service layer pattern
- **Hybrid Architecture**: Need to support both AbletonOSC and Max4Live operations seamlessly
- **Svelte 5 Runes**: Stores should be pure reactive state, not contain business logic
- **Component Simplicity**: UI components should focus on UI, delegate operations to services
- **Future-Proofing**: Pattern should scale to many clip operations (10+ planned)

## Considered Options

### Option 1: Keep Logic in Components
**Status**: ❌ Rejected

```typescript
// Each component duplicates logic
MiddlePanelV6.svelte: transposeUp() { /* 100+ lines */ }
SomeOtherComponent.svelte: transposeUp() { /* duplicate 100+ lines */ }
```

**Pros**:
- Simple to understand initially
- No new files needed

**Cons**:
- ❌ Code duplication across components
- ❌ Hard to maintain (fix bugs in multiple places)
- ❌ Components become bloated
- ❌ Can't test logic without component

### Option 2: Put Operations in Stores
**Status**: ❌ Rejected

```typescript
// clipPropertiesStore.svelte.ts
class ClipPropertiesStore {
  transposeUp() { /* business logic mixed with state */ }
}
```

**Pros**:
- Centralized location
- Accessible from anywhere

**Cons**:
- ❌ Violates single responsibility (stores = state, not operations)
- ❌ Stores become god objects
- ❌ Unclear which store owns which operation
- ❌ Makes stores harder to understand and maintain

### Option 3: Create Dedicated Service Layer ✅
**Status**: ✅ **SELECTED**

```typescript
// services/clipOperations.ts
export async function transposeClipUp(): Promise<void> {
  const ctx = getClipContext();  // Read from stores
  // Pure stateless logic
}

// MiddlePanelV6.svelte
import { transposeClipUp } from '$lib/services/clipOperations';
async function handleTransposeUp() {
  await transposeClipUp();  // Simple delegation
}
```

**Pros**:
- ✅ Clear separation of concerns (stores = state, services = logic, components = UI)
- ✅ Reusable from any component
- ✅ Easy to test in isolation
- ✅ Follows established `trackPreparation.ts` pattern
- ✅ Scalable to many operations
- ✅ Single source of truth for each operation

**Cons**:
- ⚠️ One more abstraction layer (acceptable trade-off)
- ⚠️ Requires imports in components (minimal overhead)

## Decision

**We will use Option 3: Create a dedicated `clipOperations.ts` service layer.**

### Architecture Pattern

```
┌─────────────────────────────────────────┐
│         Components (UI)                  │
│  MiddlePanelV6.svelte, etc.             │
│  - Render UI                             │
│  - Handle user interactions              │
│  - Call service functions                │
└─────────────────┬───────────────────────┘
                  │ imports & calls
                  ▼
┌─────────────────────────────────────────┐
│      Services (Business Logic)          │
│  clipOperations.ts                       │
│  - Stateless functions                   │
│  - Read context from stores              │
│  - Coordinate AbletonOSC + Max4Live      │
└─────────────────┬───────────────────────┘
                  │ reads state
                  ▼
┌─────────────────────────────────────────┐
│        Stores (Reactive State)           │
│  session.svelte.ts                       │
│  clipPropertiesStore.svelte.ts           │
│  clipGrooveStore.svelte.ts               │
│  currentInstrumentStore.svelte.ts        │
│  - Pure reactive state (Svelte 5 runes)  │
│  - No business logic                     │
└──────────────────────────────────────────┘
```

### Service Design Principles

1. **Stateless Functions**: No internal state, read from stores as needed
2. **Context Detection**: Centralize track/instrument/clip context logic
3. **Hybrid Support**: Handle AbletonOSC and Max4Live transparently
4. **Unified API**: Components don't know or care about implementation
5. **Promise-Based**: Async operations return Promises for proper flow control
6. **Composable**: Operations can call other operations

### Key Design Decision: Include Max4Live Operations

**Decision**: Max4Live operations (like `/cmd/transpose_clip_notes`) belong in `clipOperations.ts` alongside AbletonOSC operations.

**Reasoning**:
- `send()` function automatically routes messages to correct destination
- `/cmd/*` → Max4Live (port 11002)
- `/live/*` → AbletonOSC (port 11000)
- No special handling needed - same API for everything
- Components get unified interface regardless of implementation

**Example**:
```typescript
// Component doesn't know or care if this uses Max or AbletonOSC
await transposeClipUp();

// Service routes automatically based on context
export async function transposeClip(semitones: number) {
  const ctx = getClipContext();

  if (ctx.instrumentType === 'omnisphere') {
    send('/cmd/transpose_clip_notes', [ctx.trackIndex, semitones]);  // → Max
  } else if (ctx.trackType === 'audio') {
    send('/live/clip/set/pitch_coarse', [track, scene, value]);  // → AbletonOSC
  }
}
```

## Implementation

### Files Created

**`interface/src/lib/services/clipOperations.ts`** (456 lines)

**Sections**:
1. **Context Detection** - `getClipContext()` function
2. **Transpose Operations** - Full implementation for all track/instrument types
3. **Loop Operations** - `doubleLoop()`, `halveLoop()`
4. **Future Placeholders** - `duplicateLoop()`, `quantizeNotes()`, `setNoteChance()`, `shiftNotes()`

**Public API**:
```typescript
// Transpose operations
export async function transposeClipUp(): Promise<void>
export async function transposeClipDown(): Promise<void>
export async function transposeClip(semitones: number): Promise<void>

// Loop operations
export function doubleLoop(): void
export function halveLoop(): void

// Future operations (placeholders)
export async function duplicateLoop(): Promise<void>
export function quantizeNotes(grid: number): void
export function setNoteChance(percentage: number): void
export function shiftNotes(beats: number): void
```

### Files Modified

**`interface/src/lib/components/v6/layout/MiddlePanelV6.svelte`**
- **Before**: 375 lines (200+ lines of transpose logic)
- **After**: 124 lines (simple function calls)
- **Reduction**: 251 lines removed (67% smaller)

## Consequences

### Positive

✅ **Component Cleanup**: MiddlePanelV6 67% smaller, focuses on UI
✅ **Reusability**: Any component can call `transposeClipUp()`
✅ **Testability**: Can test clip operations without rendering components
✅ **Maintainability**: Single source of truth for each operation
✅ **Extensibility**: Easy pattern for adding new clip operations
✅ **Consistency**: Follows established `trackPreparation.ts` pattern
✅ **Type Safety**: Full TypeScript with proper interfaces
✅ **Documentation**: JSDoc comments on all public functions

### Negative

⚠️ **Additional Abstraction**: One more layer (services vs components)
⚠️ **Import Overhead**: Components must import from services
⚠️ **Learning Curve**: New developers need to understand pattern

### Neutral

- Service pattern now established for future feature categories (e.g., `sceneOperations.ts`, `deviceOperations.ts`)
- Requires discipline to keep services stateless
- Operations that need state still read from stores (acceptable pattern)

## Validation

### Success Metrics

- [x] MiddlePanelV6 reduced from 375 → 124 lines (67% reduction)
- [x] `transposeClipUp()` accessible from any component
- [x] Production build successful with zero errors
- [x] All transpose scenarios work identically
- [x] Clear separation: stores (state) vs services (logic) vs components (UI)

### Real-World Results

**Component Simplification**:
```typescript
// BEFORE: 100+ lines per operation
async function transposeUp() {
  const trackIndex = session.selectedTrackIndex;
  if (trackType === 'audio' && hasDetailClip && detailClipIndices) {
    // 40 lines of query/response logic
  } else if (/* 5 more branches */) {
    // 160+ more lines
  }
}

// AFTER: 5 lines
async function transposeUp() {
  transposeUpPressed = true;
  setTimeout(() => (transposeUpPressed = false), 150);
  await transposeClipUp();
}
```

**Service Implementation**:
- Context detection: 40 lines (reusable across all operations)
- Transpose logic: 250 lines (covers all scenarios)
- Loop operations: 20 lines (simple, clean)
- Future placeholders: 80 lines (documented, ready to implement)

## References

- **Implementation Plan**: `documentation/current-project/clip-operations-plan.md`
- **PR Message**: `PR_MESSAGE.md`
- **Service Code**: `interface/src/lib/services/clipOperations.ts`
- **Component Code**: `interface/src/lib/components/v6/layout/MiddlePanelV6.svelte`
- **Similar Pattern**: `interface/src/lib/services/trackPreparation.ts` (Phase 5.5)

## Notes

This ADR establishes the pattern for future service layers:
- Operations that coordinate between stores and OSC belong in services
- Services are stateless and read context from stores
- Components delegate business logic to services
- Both AbletonOSC and Max4Live operations use the same pattern

Future service candidates:
- `sceneOperations.ts` - Scene launching, recording, arrangement
- `deviceOperations.ts` - Device loading, parameter mapping, presets
- `sessionOperations.ts` - Tempo changes, time signature, global operations

---

**Status**: ✅ Implemented and validated October 2025
**Pattern**: Proven successful, recommended for future use
