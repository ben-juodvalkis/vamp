# ADR-178: Key Signature UI Relocation

## Status
Accepted

## Context
The key signature (root note + scale name) was previously only accessible via the Scale button in the left sidebar browser. This required users to open the full-screen scale browser just to see the current key. Additionally, the Record button occupied prime real estate above the Master Track in the right sidebar.

## Decision
Relocate UI elements for better ergonomics:

1. **MasterTrack displays key signature** - The header now shows the current root note (large) and abbreviated scale name (smaller) instead of "Master/Main"
2. **SystemCentralView has key signature button** - Tapping opens the scale browser
3. **Record button moves to left sidebar** - Replaces the Scale button position in VendorButtonGrid
4. **Scale browser triggers externally** - Added `browserModeStore.openScaleBrowser()` for triggering from SystemCentralView
5. **Session queries scale on refresh** - Added `/looping/song/get/root_note`, `/looping/song/get/scale_name`, and `/looping/song/get/scale_mode` to `requestSessionData()`

## Scale Abbreviations
To fit in the 120px-wide MasterTrack, scale names are abbreviated:

| Full Name | Abbreviation |
|-----------|--------------|
| Major | Maj |
| Minor | Min |
| Dorian | Dor |
| Mixolydian | Mix |
| Minor Pentatonic | Min Pent |
| Harmonic Minor | Harm Min |
| Phrygian Dominant | Phr Dom |
| (etc.) | ... |

## Files Changed

### Interface
- `MasterTrack.svelte` - Displays key signature with abbreviations
- `SystemCentralView.svelte` - Added key signature button that opens scale browser
- `VendorButtonGrid.svelte` - Replaced Scale button with RecordButton component
- `UnifiedGestureBrowser.v6.svelte` - Removed scale props, added watcher for external scale trigger
- `browserModeStore.svelte.ts` - Added `openScaleBrowser()` method
- `simpleClient.ts` - Added scale queries to `requestSessionData()`

### Max4Live
- `liveAPI-v6.js` - Added handler for `/looping/song/get/scale_mode`

## Consequences

### Positive
- Key signature always visible on MasterTrack without opening browser
- Record button more accessible in left sidebar (always visible)
- Tapping MasterTrack header opens System panel, tapping key in System opens scale browser
- Scale info syncs on page refresh

### Negative
- Scale button removed from sidebar (must tap MasterTrack then Key button, or just look at MasterTrack)
- Abbreviations may be unfamiliar to some users

## Layout Summary

**Left Sidebar (VendorButtonGrid)**
- Group 1: Recent, Record, Audio
- Group 2: Drums, Bass, FX
- Group 3: Inst, Keys, Synth

**Right Sidebar**
- Top: MasterTrack (shows key signature)
- Middle: Quantize control
- Bottom: Loop control
