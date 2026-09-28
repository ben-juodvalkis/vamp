# ADR-328: Halve Clip Loop Buttons and Sub-Bar Loop Display

**Date**: 2026-03-13
**Status**: Accepted

---

## Context

During live looping, a common workflow is progressively shortening a clip loop to create stutter effects or isolate a section. Previously, the only way to halve a loop was manual adjustment of start/end markers — too slow for live performance.

Additionally, loops shorter than 1 bar (e.g., half bar, quarter bar) displayed "0" in the loop length indicator because the formatting only handled integer bar values.

## Decision

### 1. Add two halve buttons to the MIDI clip central view

Two arrow buttons in the top row of the left action section:

| Button | Symbol | Action |
|--------|--------|--------|
| → (right arrow) | `halveLoopFromStart()` | Moves loop start later — keeps second half |
| ← (left arrow) | `halveLoopFromEnd()` | Shortens loop end — keeps first half |

Both read `clipPropertiesStore.loopStart` and `clipPropertiesStore.loopEnd`, compute the midpoint, and send the appropriate `/clip/set/loop_start` or `/clip/set/loop_end` OSC message. `halveLoopFromStart()` also updates the start marker to keep it aligned.

### 2. Rearrange MIDI left section to 4-row layout

The left action area was reorganized to fit the new buttons:

```
Row 1: → (halve from start)  |  ← (halve from end)
Row 2: REPLACE INSTRUMENT (hold gesture, full width)
Row 3: DEL  |  DUP
Row 4: -12  |  +12
```

### 3. Fix sub-bar loop length display

Loop length formatting now uses decimal bar notation for sub-bar values:

| Beats | Display |
|-------|---------|
| 4 | 1 |
| 2 | 0.5 |
| 1 | 0.25 |
| 6 | 1.5 |
| 0 | 0 |

Applied in both `ClipLoopControlV6.svelte` (horizontal loop controls) and `VerticalLoopControl.svelte` (sidebar).

## Files Changed

| File | Change |
|------|--------|
| `interface/src/lib/components/v6/central/views/ClipCentralView.svelte` | Added `halveLoopFromStart()`, `halveLoopFromEnd()`, 4-row layout |
| `interface/src/lib/components/v6/clips/ClipLoopControlV6.svelte` | Decimal bar format for sub-bar loops |
| `interface/src/lib/components/v6/clips/VerticalLoopControl.svelte` | Decimal bar format for sub-bar loops |

## Consequences

### Positive

- Fast loop halving during performance — single tap per halve
- Both directions available — keep first or second half of the loop
- Sub-bar loops now display meaningful values instead of "0"
- Consistent decimal notation across both horizontal and vertical controls

### Negative

- No "double loop" inverse operation (can be added later if needed)
- Arrow direction convention (→ = halve from start) may need practice to internalize

## Tags

`clip-editing`, `loop-control`, `ui`, `live-performance`
