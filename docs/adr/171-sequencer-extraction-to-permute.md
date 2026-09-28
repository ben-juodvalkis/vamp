# ADR-171: Sequencer Extraction to Permute

**Date:** 2026-01-24
**Status:** Accepted

## Context

The sequencer Max4Live device (`sequencer-device.js`, `Sequencer.amxd`) was tightly coupled to the Looping repository but is a general-purpose tool that could be useful independently.

## Decision

Extract the sequencer to a standalone repository called `permute` (https://github.com/ben-juodvalkis/permute).

## Changes

### Moved to Permute (renamed)

- `ableton/M4L devices/Sequencer.amxd` → `Permute.amxd`
- `ableton/M4L devices/Sequencer.maxpat` → `Permute.maxpat`
- `ableton/M4L devices/sequencer-device.js` → `permute-device.js`
- `ableton/M4L devices/sequencer-device-README.md` → `docs/reference/`

### Updated in Looping

- `ableton/scripts/liveAPI-v6.js` - `SEQUENCER_DEVICE_PATH` now points to permute installation
- `CLAUDE.md` - References permute as external dependency

### Staying in Looping

- `interface/src/lib/stores/v6/sequencerStore.svelte.ts` - Frontend integration
- `interface/src/lib/components/v6/clips/*Sequencer*.svelte` - UI components
- All sequencer-related ADRs (062, 096, 106, 108, 110, 111, 125, 150, 155, 157, 160, 163, 166) - Historical record

## Migration for Existing Users

1. Clone permute:
   ```bash
   git clone https://github.com/ben-juodvalkis/permute.git
   ```

2. Update path in `ableton/scripts/liveAPI-v6.js` (~line 63):
   ```javascript
   var SEQUENCER_DEVICE_PATH = "/path/to/your/permute/Permute.amxd";
   ```

3. Restart Ableton Live

## Consequences

- Sequencer can be used independently of Looping
- Independent versioning and releases possible
- Users must clone both repos for full Looping functionality
- Path configuration remains hardcoded (Max/MSP limitation per ADR-137)
