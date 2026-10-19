/**
 * FX Grid Layout Configuration
 *
 * Maps grid positions (fx1-fx12) to device types and their components.
 * This separates layout concerns (position, span) from device semantics (type, config).
 *
 * Architecture:
 * - Position Keys: fx1-fx12 (layout-agnostic identifiers)
 * - Device Types: filter, delay, etc. (semantic device identifiers from DEVICE_PRESETS)
 * - Components: Svelte components to render
 * - Span: Grid column span (1 or 2)
 */

import type { Component } from 'svelte';
import { DEVICE_PRESETS, type DevicePresetConfig } from './devicePresets';

// Import all device control components
import AutoFilterControl from '$lib/components/v6/device-panel/AutoFilterControl.svelte';
import EQControl from '$lib/components/v6/device-panel/EQControl.svelte';
import AutoPanControl from '$lib/components/v6/device-panel/AutoPanControl.svelte';
import EchoControl from '$lib/components/v6/device-panel/EchoControl.svelte';
import VariationControl from '$lib/components/v6/device-panel/VariationControl.svelte';
import DrumBussControl from '$lib/components/v6/device-panel/DrumBussControl.svelte';
import RandomControl from '$lib/components/v6/device-panel/RandomControl.svelte';
import SaturatorControl from '$lib/components/v6/device-panel/SaturatorControl.svelte';
import ChorusControl from '$lib/components/v6/device-panel/ChorusControl.svelte';
import ReverbControl from '$lib/components/v6/device-panel/ReverbControl.svelte';
import UtilityControl from '$lib/components/v6/device-panel/UtilityControl.svelte';

export type PositionKey =
  | 'fx1' | 'fx3' | 'fx4' | 'fx5' | 'fx6' | 'fx7' | 'fx8'
  | 'fx9' | 'fx10' | 'fx11' | 'fx12';

export type DeviceTypeKey = keyof typeof DEVICE_PRESETS;

export interface FXGridSlotConfig {
  /** Position identifier (fx1-fx15) */
  position: PositionKey;

  /** Device type from DEVICE_PRESETS (filter, delay, etc.) */
  deviceType: DeviceTypeKey;

  /** Svelte component to render */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>;

  /** First grid column (1-based) on the ten-column ruler, MIDI/master placement */
  col: number;

  /** Grid column span (1 or 2) */
  span: 1 | 2;

  /** Grid row span (1 or 2) - for full-height slots */
  rowSpan?: 1 | 2;

  /** First grid row (1 or 2) */
  row: 1 | 2;

  /** Device preset configuration (derived from DEVICE_PRESETS) */
  config: DevicePresetConfig;

  /** Optional: kept in the layout (its slot still resolves) but not drawn */
  hidden?: boolean;
}

/**
 * FX Grid Layout
 *
 * 11 slots on a TEN-column, two-row grid, every cell placed explicitly
 * (`col` / `row` / `span` / `rowSpan`) so placement can differ by track kind:
 *
 *   MIDI / master  col 1 Rand Oct (empty on master), full height
 *                  cols 2-9 row 1: EQ, Filter, Saturator, Drum
 *                           row 2: Tremolo (Auto Pan), Glitch, Echo, Reverb
 *                  col 10 Squash over Gain
 *   audio          col 1 Bass over Guitar
 *                  cols 2-10 identical
 *
 * 2026-10-15, last: the Chorus and Pitch tiles left the grid, their XYs
 * and their views now inside the Auto Pan view (the user's call). Chorus
 * keeps its `hidden` entry so its slot resolves; Pitch had none. Auto Pan
 * leads row 2, so each row holds four XYs and the grid is ten columns
 * again (the user's call), with no empty cell.
 *
 * 2026-10-15, later the same day: the two freed columns became one more XY
 * pair, back to twelve columns and the XY width they had before: Pitch (the
 * Octave, PITCH_CELL) and Glitch (GlitchLoop, GLITCH_CELL) lead row 2, and
 * Tremolo moved up to close row 1 (the user's order). Neither new tile has
 * a layout entry; each resolves its own slot through `slotKey`, as Squash
 * does.
 *
 * 2026-10-15 (the user's call): twelve columns became ten. Squash and Gain
 * share one column, Squash on top, and Variation is hidden for now
 * (`hidden`, so it comes back by deleting one line). On audio the Guitar
 * stacks over the Bass in column 1, so every kind is one column at the left
 * and the XY tiles stand on the same columns whichever kind is selected.
 *
 * 2026-09-15, later the same day (ADR-438 addendum): the single-column
 * tiles became full-height columns. Both kinds are twelve columns, so the
 * XY tiles and the TotalMix ruler in layouts/default/Layout.svelte never move when the
 * selected track changes kind. Squash and the audio Guitar have no entries;
 * FXGrid places them from SQUASH_CELL and AUDIO_GUITAR_CELL below.
 *
 * 2026-09-15: the grid lost a column. Gain's cell spans both rows, so each
 * row has nine columns left and the four XY pairs take eight of them —
 * which leaves EXACTLY ONE single-column slot per row. On MIDI that is
 * Rand Oct over Variation; the instrument slider that used to share fx1's
 * column and the Guitar tile that used to sit beside it both went (the
 * strip's device band opens the instrument view now, and the Guitar rack's
 * drive slider moved into PedalCentralView, which is also its door). On
 * audio the row-1 slot is the Bass, and the clip-pitch tile went with it —
 * it was a second copy of the PITCH column ClipCentralView already draws.
 *
 * 2026-08-22: Pitch-Helix left the grid (still reachable as a central view)
 * and Saturator took a tile, moving up from the Pedal central view. EQ took
 * Pitch's row-1 tile; Tremolo dropped to row 2 where Delay was, and Delay +
 * Reverb each shifted one tile right.
 *
 * 2026-09-10 (ADR-431): the Drum Buss took the Saturator's tile — the Drum
 * XY (transients × dry/wet) on the grid, Boom + Comp in DrumBussCentralView —
 * and the Saturator went back into the Pedal central view (its XY plus its
 * four faders). The role-gated instrument-view rail (ADR-424) is gone.
 * Same day, Squash (the Glue Compressor's one-finger threshold + makeup)
 * left the Gain / Utility view for the top half of the Gain column —
 * FXGrid splits fx7 the way it splits fx1 — so the grid stays at eleven
 * columns and the TotalMix status strip's ruler in layouts/default/Layout.svelte with it.
 *
 * 2026-10-05: the Saturator and the Pedal swapped places — the Saturator's
 * XY is the grid tile again, and the Pedal's XY moved into the view the
 * tile opens (PedalCentralView), beside its type tabs.
 *
 * Note: Arpeggiator and Bass are virtual devices (not in grid, accessed via central views)
 */
export const FX_GRID_LAYOUT: FXGridSlotConfig[] = [
  // ===== ROW 1: 6 SLOTS =====
  {
    position: 'fx1',
    col: 1,
    deviceType: 'random',
    component: RandomControl,
    span: 1,
    rowSpan: 2,
    row: 1,
    config: DEVICE_PRESETS.random
  },
  {
    position: 'fx3',
    col: 2,
    deviceType: 'eq',
    component: EQControl,
    span: 2,
    row: 1,
    config: DEVICE_PRESETS.eq
  },
  {
    position: 'fx4',
    col: 4,
    deviceType: 'filter',
    component: AutoFilterControl,
    span: 2,
    row: 1,
    config: DEVICE_PRESETS.filter
  },
  {
    position: 'fx5',
    col: 6,
    deviceType: 'saturator',
    component: SaturatorControl,
    span: 2,
    row: 1,
    config: DEVICE_PRESETS.saturator
  },
  {
    position: 'fx6',
    col: 8,
    deviceType: 'drum',
    component: DrumBussControl,
    span: 2,
    row: 1,
    config: DEVICE_PRESETS.drum
  },
  {
    // Gain: the bottom of the last column, under Squash (SQUASH_CELL),
    // 2026-10-15. Each had a full-height column from 2026-09-15.
    position: 'fx7',
    col: 10,
    deviceType: 'utility',
    component: UtilityControl,
    span: 1,
    rowSpan: 1,
    row: 2,
    config: DEVICE_PRESETS.utility
  },

  // ===== ROW 2 =====
  {
    // Variation: hidden for now (2026-10-15, the user's call); its column
    // went to the XY tiles. Delete `hidden` and give it a cell to bring it back.
    position: 'fx8',
    col: 2,
    hidden: true,
    deviceType: 'variation',
    component: VariationControl,
    span: 1,
    rowSpan: 2,
    row: 1,
    config: DEVICE_PRESETS.variation
  },
  {
    // Chorus: its XY lives in the Auto Pan view since 2026-10-15 (the
    // user's call). `hidden` keeps the slot resolving there.
    position: 'fx9',
    col: 6,
    hidden: true,
    deviceType: 'chorus',
    component: ChorusControl,
    span: 2,
    row: 2,
    config: DEVICE_PRESETS.chorus
  },
  {
    // Auto Pan leads row 2 since 2026-10-15 (the user's call), in the
    // Pitch tile's old cell.
    position: 'fx10',
    col: 2,
    deviceType: 'tremolo',
    component: AutoPanControl,
    span: 2,
    row: 2,
    config: DEVICE_PRESETS.tremolo
  },
  {
    position: 'fx11',
    col: 6,
    deviceType: 'echo',
    component: EchoControl,
    span: 2,
    row: 2,
    config: DEVICE_PRESETS.echo
  },
  {
    position: 'fx12',
    col: 8,
    deviceType: 'reverb',
    component: ReverbControl,
    span: 2,
    row: 2,
    config: DEVICE_PRESETS.reverb
  }
];

/** The grid's column count. The TotalMix status strip in layouts/default/Layout.svelte repeats it by hand. */
export const FX_GRID_COLUMNS = 10;

/** Which placement a grid uses. Master and group tracks use MIDI's. */
export type GridTrackKind = 'midi' | 'audio';

/** One cell on the ten-by-two grid: 1-based start column and row, plus spans. */
export interface GridCell {
  col: number;
  row: 1 | 2;
  span: 1 | 2;
  rowSpan: 1 | 2;
}

/** Squash: the top of the last column, over Gain, on every track. No layout entry. */
export const SQUASH_CELL: GridCell = { col: 10, row: 1, span: 1, rowSpan: 1 };

/** Glitch (GlitchLoop): beside Pitch, under Filter, on every track. No layout entry. */
export const GLITCH_CELL: GridCell = { col: 4, row: 2, span: 2, rowSpan: 1 };

/** The Guitar rack's drive: the bottom of the first column, under the Bass, audio tracks only. No layout entry. */
export const AUDIO_GUITAR_CELL: GridCell = { col: 1, row: 2, span: 1, rowSpan: 1 };

/**
 * Audio moves fx1 (the Bass there) over the Guitar in column 1 (2026-10-19). Every
 * other slot is placed the same on both kinds.
 */
const AUDIO_CELLS: Partial<Record<PositionKey, GridCell>> = {
  fx1: { col: 1, row: 1, span: 1, rowSpan: 1 }
};

/** Where a layout slot sits for a track kind. */
export function cellFor(slot: FXGridSlotConfig, kind: GridTrackKind): GridCell {
  const override = kind === 'audio' ? AUDIO_CELLS[slot.position] : undefined;
  return override ?? { col: slot.col, row: slot.row, span: slot.span, rowSpan: slot.rowSpan ?? 1 };
}

/** Inline grid placement. Inline, not utility classes: Tailwind cannot see computed class names. */
export function cellStyle(cell: GridCell): string {
  return `grid-column: ${cell.col} / span ${cell.span}; grid-row: ${cell.row} / span ${cell.rowSpan};`;
}

/**
 * Utility: Get grid slot by position
 */
export function getSlotByPosition(position: PositionKey): FXGridSlotConfig | undefined {
  return FX_GRID_LAYOUT.find(slot => slot.position === position);
}

/**
 * Utility: Get grid slot by device type
 */
export function getSlotByDeviceType(deviceType: DeviceTypeKey): FXGridSlotConfig | undefined {
  return FX_GRID_LAYOUT.find(slot => slot.deviceType === deviceType);
}

/**
 * Utility: Get position for a device type
 */
export function getPositionForDeviceType(deviceType: DeviceTypeKey): PositionKey | null {
  const slot = getSlotByDeviceType(deviceType);
  return slot ? slot.position : null;
}

/**
 * Utility: Get device type for a position
 */
export function getDeviceTypeForPosition(position: PositionKey): DeviceTypeKey | null {
  const slot = getSlotByPosition(position);
  return slot ? slot.deviceType : null;
}

/**
 * Utility: Get all grid positions
 */
export function getAllPositions(): PositionKey[] {
  return FX_GRID_LAYOUT.map(slot => slot.position);
}

/**
 * Utility: Get all device types in grid
 */
export function getGridDeviceTypes(): DeviceTypeKey[] {
  return FX_GRID_LAYOUT.map(slot => slot.deviceType);
}
