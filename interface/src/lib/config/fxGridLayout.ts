/**
 * The device slots (fx1-fx12): which device type each position names, and
 * the tile component that controls it.
 *
 * The FX grid that laid these out on a ten-column ruler is gone (ADR-485,
 * 2026-10-26, the user's call): the FX section is the chain overview alone.
 * What stays is the slot table, which the tiles, the chain's cells and the
 * central views resolve their device through (`getFxGridSlot`,
 * `useFxGridSlot`), and the tile each type is drawn with. A position is an
 * identifier now, not a place.
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
  /** Position identifier (fx1-fx12): a name, not a place */
  position: PositionKey;

  /** Device type from DEVICE_PRESETS (filter, delay, etc.) */
  deviceType: DeviceTypeKey;

  /** Svelte component to render */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>;

  /** Device preset configuration (derived from DEVICE_PRESETS) */
  config: DevicePresetConfig;
}

/** The slots, one per device type that has a tile of its own. */
export const FX_GRID_LAYOUT: FXGridSlotConfig[] = [
  {
    position: 'fx1',
    deviceType: 'random',
    component: RandomControl,
    config: DEVICE_PRESETS.random
  },
  {
    position: 'fx3',
    deviceType: 'eq',
    component: EQControl,
    config: DEVICE_PRESETS.eq
  },
  {
    position: 'fx4',
    deviceType: 'filter',
    component: AutoFilterControl,
    config: DEVICE_PRESETS.filter
  },
  {
    position: 'fx5',
    deviceType: 'saturator',
    component: SaturatorControl,
    config: DEVICE_PRESETS.saturator
  },
  {
    position: 'fx6',
    deviceType: 'drum',
    component: DrumBussControl,
    config: DEVICE_PRESETS.drum
  },
  {
    position: 'fx7',
    deviceType: 'utility',
    component: UtilityControl,
    config: DEVICE_PRESETS.utility
  },
  {
    position: 'fx8',
    deviceType: 'variation',
    component: VariationControl,
    config: DEVICE_PRESETS.variation
  },
  {
    position: 'fx9',
    deviceType: 'chorus',
    component: ChorusControl,
    config: DEVICE_PRESETS.chorus
  },
  {
    position: 'fx10',
    deviceType: 'tremolo',
    component: AutoPanControl,
    config: DEVICE_PRESETS.tremolo
  },
  {
    position: 'fx11',
    deviceType: 'echo',
    component: EchoControl,
    config: DEVICE_PRESETS.echo
  },
  {
    position: 'fx12',
    deviceType: 'reverb',
    component: ReverbControl,
    config: DEVICE_PRESETS.reverb
  }
];

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
