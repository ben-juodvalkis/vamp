/**
 * Slot Registry - Central registry for all FX slot stores
 *
 * Manages lifecycle of slot stores and syncs them with device list updates.
 * Each slot is a stable, reactive store that only updates when its specific
 * device appears/disappears.
 *
 * This eliminates the reactive cascade problem - when device 8 is deleted,
 * only slot 8 reacts, not all other slots!
 *
 * Architecture (V2 - Position-Based):
 * - Slots indexed by position keys (fx1-fx13)
 * - Each slot associated with a device type (filter, delay, etc.)
 * - Position → Device Type mapping from FX_GRID_LAYOUT
 * - Note: Drum Buss controls are accessed via Pedal central view
 */

import { FXSlotStore } from './fxSlotStore.svelte';
import { FX_GRID_LAYOUT, type PositionKey, type DeviceTypeKey } from '$lib/config/fxGridLayout';
import type { Device } from './selectedTrackStore.svelte';
import { logger } from '$lib/utils/logger';

class SlotRegistry {
	private slots = new Map<PositionKey, FXSlotStore>();
	private positionToDeviceType = new Map<PositionKey, DeviceTypeKey>();
	private deviceTypeToPosition = new Map<DeviceTypeKey, PositionKey>();

	constructor() {
		this.initializeSlots();
	}

	private initializeSlots() {
		// Create a slot store for each grid position
		FX_GRID_LAYOUT.forEach(({ position, deviceType, config }) => {
			const slot = new FXSlotStore(position, deviceType, config);
			this.slots.set(position, slot);
			this.positionToDeviceType.set(position, deviceType);
			this.deviceTypeToPosition.set(deviceType, position);
		});

		logger.debug(`Initialized ${this.slots.size} FX slots (position-based)`, { component: 'SlotRegistry' });
	}

	/**
	 * Get a slot store by position key (fx1-fx13)
	 * Returns a stable reference - same object every time!
	 */
	getSlot(position: PositionKey): FXSlotStore {
		const slot = this.slots.get(position);
		if (!slot) {
			throw new Error(`[SlotRegistry] Unknown position key: ${position}`);
		}
		return slot;
	}

	/**
	 * Get a slot store by device type (for backward compatibility during migration)
	 * @deprecated Use getSlot() with position key instead
	 */
	getSlotByDeviceType(deviceType: DeviceTypeKey): FXSlotStore | undefined {
		const position = this.deviceTypeToPosition.get(deviceType);
		return position ? this.slots.get(position) : undefined;
	}

	/**
	 * Get position for a device type
	 */
	getPositionForDeviceType(deviceType: DeviceTypeKey): PositionKey | null {
		return this.deviceTypeToPosition.get(deviceType) || null;
	}

	/**
	 * Get device type for a position
	 */
	getDeviceTypeForPosition(position: PositionKey): DeviceTypeKey | null {
		return this.positionToDeviceType.get(position) || null;
	}

	// ROW 13b (2026-04-21): `syncWithDeviceList` deleted — zero
	// production callers. Readers moved to `v3Store.deviceByPath`-
	// driven updates during the path-identity migration; this was
	// the last consumer of `FXSlotStore.updateFromDeviceList`, also
	// deleted in the same row.

	/**
	 * Reset all slots for track change
	 */
	resetForTrackChange() {
		logger.debug('Resetting all slots for track change', { component: 'slotRegistry' });
		this.slots.forEach((slot) => {
			slot.resetForTrackChange();
		});
	}

	/**
	 * Find which slot a device belongs to
	 */
	findSlotForDevice(device: Device): PositionKey | null {
		for (const [key, slot] of this.slots.entries()) {
			if (
				device.className === slot.config.expectedClassName &&
				device.name === slot.config.defaultName
			) {
				return key as PositionKey;
			}
		}
		return null;
	}

	/**
	 * Get all slots (for debugging/inspection)
	 */
	getAllSlots(): Map<PositionKey, FXSlotStore> {
		return this.slots;
	}

	/**
	 * Get stats for all slots
	 */
	getStats() {
		const stats = {
			totalSlots: this.slots.size,
			activeSlots: 0,
			ghostSlots: 0,
			loadingSlots: 0,
			errorSlots: 0,
			totalSubscriptions: 0
		};

		this.slots.forEach((slot) => {
			if (slot.isActive) stats.activeSlots++;
			else if (slot.loadState === 'loading') stats.loadingSlots++;
			else if (slot.loadState === 'error') stats.errorSlots++;
			else stats.ghostSlots++;

			// Count subscriptions (would need to expose this from FXSlotStore)
		});

		return stats;
	}
}

// Export singleton
export const slotRegistry = new SlotRegistry();
