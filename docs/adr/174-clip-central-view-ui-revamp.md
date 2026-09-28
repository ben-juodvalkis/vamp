# ADR-174: ClipCentralView UI Revamp

## Status
Accepted

## Context
The ClipCentralView component had become visually cluttered with bright, filled-in buttons that were distracting during live performance. The UI needed a more minimal, professional appearance while maintaining clear affordances for touch interaction.

Key issues:
- Bright colored button backgrounds (cyan, amber, indigo, orange, emerald) competed for attention
- Record button's bright red fill was particularly distracting
- Inconsistent button placement between MIDI and audio track types
- Rate slider labels were unclear (just "1", "2", "4", "8" instead of "1 bar", "2 bars", etc.)
- Button labels were verbose ("Delete Clip", "Load Simpler", "Dup Loop")

## Decision

### 1. Outline Button Style
Changed all action buttons from filled backgrounds to outline style:
- **Border**: Colored border (2px) matching the action's semantic color
- **Background**: Dark muted background (`bg-muted`)
- **Text**: Colored text matching the border
- **Hover**: Subtle color tint on background, lighter text
- **Hold states**: Slightly filled background with lighter border/text

Color assignments:
- Replace: Cyan (`border-cyan-500 text-cyan-400`)
- Transpose: Amber (`border-amber-500 text-amber-400`)
- Duplicate: Indigo (`border-indigo-500 text-indigo-400`)
- Delete: Orange (`border-orange-500 text-orange-400`)
- Simpler: Emerald (`border-emerald-500 text-emerald-400`)

### 2. Minimal Record Button
Changed record buttons (both ClipCentralView and RecordButton.svelte) to minimal style:
- Outline circle icon (`○`) instead of filled (`●`)
- Outline square icon (`□`) for stopping instead of filled (`■`)
- Muted background with semi-transparent red text (`text-red-500/70`)
- Subtle red tint on background when recording (`bg-red-600/20`)
- No bright red fills

### 3. Consistent Layout
Made left section consistent between MIDI and audio tracks:
- Column 1: Replace (top) + +12/-12 transpose (bottom)
- Column 2: Dup/empty (top) + Delete (bottom)

### 4. Simplified Labels
Shortened button text for cleaner appearance:
- "Delete Clip" → "Delete"
- "Load Simpler" → "Simpler"
- "Replace Clip/Inst/Audio" → "Replace"
- "Dup Loop" → "Dup"
- "Rec to Simpler" → `○` (record icon)

### 5. Improved Rate Labels
Updated SequencerPatternGrid rate display to show units:
- "8 bars", "4 bars", "2 bars", "1 bar" for bar-based rates
- "1/2", "1/4", "1/8", "1/16" for note-based rates

Increased font size from `text-lg` to `text-2xl` for both length and rate sliders.

## Consequences

### Positive
- Much cleaner, less distracting interface during performance
- Colored borders still provide clear visual grouping by function
- More professional appearance
- Better readability with larger fonts and clearer labels
- Consistent button placement reduces cognitive load

### Negative
- Lower contrast may be slightly harder to see in very bright environments
- Users familiar with old UI may need brief adjustment period

## Files Changed
- `interface/src/lib/components/v6/central/views/ClipCentralView.svelte`
- `interface/src/lib/components/v6/controls/RecordButton.svelte`
- `interface/src/lib/components/v6/clips/SequencerPatternGrid.svelte`
