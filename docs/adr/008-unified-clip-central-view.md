# ADR 007: Unified Clip Central View with Interactive Access

**Status:** Accepted
**Date:** 2025-01-04
**Deciders:** Ben Juodvalkis
**Related:** ADR-001 (Svelte 5 Runes), ADR-004 (Device System Refactor)

## Context

The middle panel needed dedicated controls for clip manipulation (warp modes, pitch, note chance, groove). Initial exploration considered separate views for audio and MIDI clips, similar to the instrument view pattern. However, this introduced unnecessary complexity:

### Initial Approach (Rejected)

**Two Separate Components:**
- `AudioClipCentralView.svelte` - Warp modes, pitch controls
- `MidiClipCentralView.svelte` - Transpose, note chance

**Problems:**
1. Required async clip type detection (`/live/clip/get/is_audio_clip`)
2. Complex coordinator logic to route to correct view
3. Code duplication for shared controls (groove)
4. Slower switching between clips
5. Extra state tracking in clipPropertiesStore
6. Race conditions with clip type queries

### User Experience Goals

1. **Discoverable**: Easy to find clip controls
2. **Touch-friendly**: Large targets for iPad
3. **Organized**: Related controls grouped logically
4. **Efficient**: Quick access without menu navigation

## Decision

**Implement a unified ClipCentralView with conditional rendering and multiple interactive entry points.**

### Architecture

**Single Component Pattern:**
```typescript
{#if trackType === 'audio'}
  <!-- Audio-specific controls -->
{:else if trackType === 'midi'}
  <!-- MIDI-specific controls -->
{/if}
<!-- Shared groove controls -->
```

**Multiple Access Points:**
1. Click/tap loop control brace → Show clip view
2. Click/tap quantize slider → Show clip view
3. Drag loop handles → Adjust loop (click detection prevents false triggers)

**Layout Reorganization:**
- **Middle Panel Left (50%)**: Loop (25%) → Quantize (25%) → Sequencer (50%)
- **Middle Panel Right (50%)**: Dynamic central display
- **Groove Split**: Quantize always visible, Shuffle/Random/Grid in clip view

### Rationale

**1. Simplicity Over Separation**
- `session.selectedTrackType` already available (no queries needed)
- Instant rendering (no async detection)
- Single component to maintain
- Shared code for groove controls

**2. Track Type is Sufficient**
- Audio tracks → audio clips (99% of cases)
- MIDI tracks → MIDI clips (99% of cases)
- Edge case (MIDI clip on audio track) is rare and acceptable

**3. Interactive Discovery**
- Loop control is primary clip interaction → natural entry point
- Quantize is timing-related → relevant to clip settings
- Touch-friendly large targets

**4. Context Over Querying**
- No network roundtrips for clip type
- No race conditions
- No caching issues
- Immediate response

## Implementation

### Component Structure

**ClipCentralView.svelte** (Unified)
```svelte
{#if trackType === 'audio'}
  <!-- Octave buttons (±12) + Warp mode (Beats/Complex/Pro) -->
{:else if trackType === 'midi'}
  <!-- Octave buttons (±12/±16) + Note Chance slider -->
{/if}
<!-- Groove controls (Base Grid, Shuffle, Random) -->
```

**Layout Proportions:**
- Audio/MIDI row: h-16 (64px)
- Groove base grid: auto
- Groove sliders: h-16 (64px)

### New Max4Live Commands

**Note Chance Control:**
```javascript
// Command: /cmd/set_clip_note_chance [trackIndex, sceneIndex, percentage]
// Implementation: get_all_notes_extended → set probability → apply_note_modifications
// Range: 0-100% (converted to 0.0-1.0 for Live API)
```

**Clip Property Observer:**
```javascript
// Added warp_mode to observed properties
var clipProperties = [
  "loop_start", "loop_end", "start_marker", "end_marker",
  "length", "looping", "warp_mode"
];
```

### Service Coordinator

**ClipDisplayCoordinator (Simplified)**
- Watches `session.detailClipIndices` for changes
- No clip type detection needed
- Auto-updates central view if already showing clip view
- Public API: `showCurrentClip()`

### Interactive Components

**ClipLoopControlV6:**
- Click handlers with drag detection
- Prevents false triggers when adjusting loop points
- Shows clip view on click (not drag)

**QuantizeGrooveControl:**
- Click container → Show clip view
- Drag slider → Adjust quantization
- `stopPropagation` on slider prevents container click

## Consequences

### Positive

✅ **Simpler Architecture**
- 200+ lines of complexity removed
- No async clip type queries
- Single component instead of two

✅ **Better Performance**
- Instant rendering (uses existing track type)
- No network roundtrips
- No race conditions

✅ **Easier Maintenance**
- One component to update
- Shared groove control code
- Less state to track

✅ **Better UX**
- Multiple discovery points
- Larger touch targets
- Immediate response

✅ **Cleaner Code**
- Conditional rendering is clear
- No coordinator complexity
- Follows Svelte best practices

### Negative

⚠️ **Edge Case Handling**
- MIDI clips on audio tracks (rare) would show audio controls
- Audio clips on MIDI tracks (very rare) would show MIDI controls
- **Mitigation**: Acceptable trade-off for simplicity, edge cases are <1%

⚠️ **Control Visibility**
- Shuffle/Random moved from always-visible to contextual
- **Mitigation**: Quantize remains visible, others accessible via click

### Neutral

- Groove controls split between always-visible (quantize) and contextual (shuffle/random)
- Multiple entry points require documentation/discovery
- Warp mode uses Max4Live instead of AbletonOSC (consistent with other clip properties)

## Alternatives Considered

### A. Separate Audio/MIDI Components with Async Detection
- **Rejected**: Too complex, slower, unnecessary queries

### B. Always Show All Controls (No Conditionals)
- **Rejected**: Cluttered UI, confusing for users

### C. Tabbed Interface (Audio/MIDI Tabs)
- **Rejected**: Extra clicks, less discoverable

### D. Keep Groove in Right Column (Original Layout)
- **Rejected**: Wastes space, less contextual

## Related Decisions

- **ADR-001**: Svelte 5 runes enable reactive `$derived(session.selectedTrackType)`
- **ADR-004**: Device system pattern established coordinator architecture
- **Instrument Views**: Same conditional rendering pattern (drumrack vs omnisphere)

## Follow-Up Tasks

- [ ] Add warp_enabled observer for audio clips
- [ ] Add note velocity controls for MIDI clips
- [ ] Add clip gain control for audio clips
- [ ] Expand note chance to per-note control (visual editor)

## References

- Cycling '74 Clip Object: https://docs.cycling74.com/apiref/lom/clip/
- Sequencer Device: `ableton/M4L Devices/sequencer-device.js`
- Live API: `ableton/scripts/liveAPI-v6.js`
- Instrument View Pattern: `instrumentDisplayCoordinator.svelte.ts`

---

**Decision made:** 2025-01-04
**Implemented:** 2025-01-04
**Commits:** 397d423, 1e2342a, 2588a59, c1305b8, b10334c
