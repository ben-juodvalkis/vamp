/**
 * FX Slot Store - Per-slot config + load-state holder.
 *
 * Each slot represents one grid position (fx1-fx15) bound to a device type.
 * Holds the slot's static `config`/`color` for `BaseDeviceControl` styling
 * and per-slot `findSlotForDevice` lookups in `slotRegistry`.
 *
 * **Authoritative parameter + drain owner**: `FXGridState` (in `fxGridStore.svelte.ts`).
 * Pending-param queueing during ghost interaction goes through
 * `selectedTrackStore.storePendingParam` → `FXGridState.pendingParams`,
 * and the rising-edge drain runs from `FXGridState.watchDeviceArrivals`.
 * Don't reintroduce a parallel queue here — see ADR-351.
 */

import type { DevicePresetConfig } from '$lib/config/devicePresets';
import type { PositionKey, DeviceTypeKey } from '$lib/config/fxGridLayout';
import type { Device } from './selectedTrackStore.svelte';

export class FXSlotStore {
	readonly position: PositionKey;
	readonly deviceType: DeviceTypeKey;
	readonly config: DevicePresetConfig;

	// Core state
	private _device = $state<Device | null>(null);
	private _loadState = $state<'ghost' | 'loading' | 'error'>('ghost');
	private _error = $state<string | undefined>(undefined);

	constructor(position: PositionKey, deviceType: DeviceTypeKey, config: DevicePresetConfig) {
		this.position = position;
		this.deviceType = deviceType;
		this.config = config;
	}

	// ===== PUBLIC ACCESSORS =====

	get device() {
		return this._device;
	}

	get isActive() {
		return this._device !== null;
	}

	get isGhost() {
		return this._device === null;
	}

	get state() {
		return this._device ? 'active' : this._loadState;
	}

	get loadState() {
		return this._loadState;
	}

	get error() {
		return this._error;
	}

	get color() {
		return this.config.color;
	}

	// ===== LIFECYCLE MANAGEMENT =====

	// ROW 13b (2026-04-21): `updateFromDeviceList` deleted. Readers
	// moved to `v3Store.deviceByPath`-driven updates during the
	// path-identity migration; this imperative-sync entry point was
	// orphaned and had zero production callers.

	/**
	 * Reset slot for track change.
	 *
	 * `_device` and `_loadState` are not externally written post-v3
	 * (the imperative-sync `updateFromDeviceList` path was removed in
	 * ROW 13b, 2026-04-21), so this is currently a no-op in practice
	 * — kept for shape symmetry with `FXGridState.resetForTrackChange`
	 * and future re-wiring.
	 */
	resetForTrackChange() {
		this._device = null;
		this._loadState = 'ghost';
		this._error = undefined;
	}
}
