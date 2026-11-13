/**
 * Devices the interface never draws as a device: the ones Vamp puts on a
 * track for its own work, and Live's Tuner (the user, 2026-11-13). The
 * chain overview gives them no cell, inside a rack included, and a strip's
 * device band never shows one as the track's head. The list is
 * `constants.devices.hiddenFromChain` (Live's class and, where a rule names
 * one, the name it gives the loaded file; a rule with no name hides every
 * device of its class); add a device there, not here.
 *
 * Filter where a chain is DRAWN, never the store: `devicesByPath[N]` is the
 * device at chain index N, and views index it that way.
 */
import constants from '$config/constants.json';

export interface HiddenDeviceRule {
	className: string;
	/** Absent: every device of the class, whatever it is named. */
	deviceName?: string;
}

const RULES: readonly HiddenDeviceRule[] = constants.devices.hiddenFromChain;

/** True for a device Vamp keeps out of every chain it draws. */
export function isHiddenFromChain(device: { className: string; name: string }): boolean {
	return RULES.some(
		(r) => r.className === device.className && (r.deviceName === undefined || r.deviceName === device.name)
	);
}

/** `devices` without the hidden ones, in their order. */
export function visibleDevices<T extends { className: string; name: string }>(devices: readonly T[]): T[] {
	return devices.filter((d) => !isHiddenFromChain(d));
}
