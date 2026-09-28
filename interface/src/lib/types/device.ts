/**
 * Shared Device type definition
 * Used across stores for device representation
 */

export interface Device {
	/**
	 * Stable LOM device id (Python surface's `_live_ptr`-derived id).
	 * Used by `FXSlotStore` for cross-update device identity comparisons
	 * and as a `paramIds` map key. Wire writes are path-addressed (v3)
	 * and do not consume this field.
	 */
	id: number;
	/**
	 * Chain position (0-based). Stable only within a given device-list
	 * snapshot — reorders change it. Do NOT use for cross-message
	 * identity; use `id` for that.
	 */
	index: number;
	name: string;
	className: string;
	// ROW 5 (2026-04-21): `legacyId?: number` deleted. The
	// M4L-served `/looping/device/{select,move_appointed_*}` /
	// `/looping/live_api/*` consumers that needed it all retired;
	// the v3 `/looping/v3/device/{select,move_to_*}` wires use
	// `devicePath` directly.
}
