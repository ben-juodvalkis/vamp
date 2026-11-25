/**
 * Slot Registry — the FX grid's position table as a frozen lookup.
 *
 * Built once from `FX_GRID_LAYOUT`: position ↔ device type, and each
 * position's preset config and colour. It holds no state. A slot's live
 * state (ghost / loading / error, pending values) is `FXGridState`'s, in
 * `fxGridStore.svelte.ts`, and so is matching a device to its slot
 * (`fxGrid.findSlotForDevice`). The per-slot `FXSlotStore` objects this
 * used to hold carried a device, a load state and an error nothing ever
 * wrote.
 *
 * The file keeps its `.svelte.ts` name so the components that import it
 * need not change.
 */

import { FX_GRID_LAYOUT, type PositionKey, type DeviceTypeKey } from '$lib/config/fxGridLayout';
import type { DevicePresetConfig } from '$lib/config/devicePresets';

type SlotColor = DevicePresetConfig['color'];

/** One grid position: what it holds and how it is drawn. */
export interface FXSlotInfo {
	readonly position: PositionKey;
	readonly deviceType: DeviceTypeKey;
	readonly config: DevicePresetConfig;
	readonly color: SlotColor;
}

const slots: ReadonlyMap<PositionKey, FXSlotInfo> = new Map(
	FX_GRID_LAYOUT.map(({ position, deviceType, config }): [PositionKey, FXSlotInfo] => [
		position,
		Object.freeze({ position, deviceType, config, color: config.color })
	])
);

const positionByDeviceType: ReadonlyMap<DeviceTypeKey, PositionKey> = new Map(
	FX_GRID_LAYOUT.map(({ position, deviceType }) => [deviceType, position])
);

export const slotRegistry = Object.freeze({
	/** The slot at a position. Throws on a position the layout does not have. */
	getSlot(position: PositionKey): FXSlotInfo {
		const slot = slots.get(position);
		if (!slot) throw new Error(`[SlotRegistry] Unknown position key: ${position}`);
		return slot;
	},

	/** The position a device type sits at, or null for a virtual device. */
	getPositionForDeviceType(deviceType: DeviceTypeKey): PositionKey | null {
		return positionByDeviceType.get(deviceType) ?? null;
	},

	/** The device type at a position, or null. */
	getDeviceTypeForPosition(position: PositionKey): DeviceTypeKey | null {
		return slots.get(position)?.deviceType ?? null;
	},

	/** Every position, in layout order. */
	getAllSlots(): ReadonlyMap<PositionKey, FXSlotInfo> {
		return slots;
	}
});
