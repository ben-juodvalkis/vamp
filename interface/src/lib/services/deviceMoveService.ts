/**
 * Device Move Service
 *
 * Path-addressed device-chain operations against the Python Surface's
 * `DeviceCommandsComponent`. ROW 5 (2026-04-21) retargeted these off
 * the M4L "appointed device" (blue-hand) dance — the old flow required
 * the UI to maintain a `devicePath → legacyId` side-table populated
 * off every v3 state/full, plus a two-hop select-then-move gesture
 * per reorder. Under v3 `path_resolver.resolve_device` feeds each
 * handler directly, so the UI just passes the `devicePath` and the
 * Python surface reads `device.canonical_parent` + `song.move_device`
 * in a single LOM write.
 */

import { send } from '$lib/api/simpleClient';
import { logger } from '$lib/utils/logger';

const V3_DEVICE_SELECT_ADDRESS = '/looping/v3/device/select';
const V3_DEVICE_MOVE_TO_TOP_ADDRESS = '/looping/v3/device/move_to_top';
const V3_DEVICE_MOVE_TO_END_ADDRESS = '/looping/v3/device/move_to_end';

/**
 * Set the "blue hand" (view's selected device). Idempotent at the LOM
 * layer; duplicate selects are a no-op. Typed `path-not-found` /
 * `path-not-supported` / `write-rejected` errors arrive via
 * `/looping/v3/error`.
 */
export async function selectDevice(devicePath: string): Promise<void> {
	try {
		await send(V3_DEVICE_SELECT_ADDRESS, [devicePath]);
	} catch (error) {
		logger.error('Failed to select device:', {
			component: 'deviceMove',
			devicePath,
			error,
		});
	}
}

/**
 * Move the device at `devicePath` to index 0 in its parent's device
 * chain. The Python handler reads `device.canonical_parent` to pick
 * the destination chain and calls `song.move_device(device, parent,
 * 0)`. Typed errors on `/looping/v3/error`.
 */
export async function moveDeviceToTop(devicePath: string): Promise<void> {
	try {
		await send(V3_DEVICE_MOVE_TO_TOP_ADDRESS, [devicePath]);
	} catch (error) {
		logger.error('Failed to move device to top:', {
			component: 'deviceMove',
			devicePath,
			error,
		});
		throw error;
	}
}

/**
 * Move the device at `devicePath` to the last index in its parent's
 * chain. Wire shape mirrors `moveDeviceToTop`; the Python handler
 * passes `len(parent.devices)` as the target index. Live's
 * `move_device` treats the index as the position before the source
 * is removed, so `count` (not `count - 1`) means "append" — using
 * `count - 1` would land on second-from-end after Live shifts the
 * source out first.
 */
export async function moveDeviceToEnd(devicePath: string): Promise<void> {
	try {
		await send(V3_DEVICE_MOVE_TO_END_ADDRESS, [devicePath]);
	} catch (error) {
		logger.error('Failed to move device to end:', {
			component: 'deviceMove',
			devicePath,
			error,
		});
		throw error;
	}
}


const V3_DEVICE_DELETE_ADDRESS = '/looping/v3/device/delete';

/**
 * Remove the device at `devicePath` from its chain (protocol 3.8.0,
 * `DeviceCommandsComponent.handle_delete`): `parent.delete_device(index)`
 * on the device's `canonical_parent` — a track, or a drum pad's chain —
 * with the index found by LOM identity, never by the path's own number.
 * Success is silent; the chain's device-structure listener carries the
 * news. Typed errors (`path-not-found`, `path-not-supported`,
 * `write-rejected`) arrive via `/looping/v3/error`.
 *
 * First UI sender (ADR-445, 2026-09-19): the Pedal view's Wah button,
 * held, takes the wah off the track — on a MIDI track that hands the
 * expression pedal back to the Expression Pedal rack.
 */
export async function deleteDevice(devicePath: string): Promise<void> {
	try {
		await send(V3_DEVICE_DELETE_ADDRESS, [devicePath]);
	} catch (error) {
		logger.error('Failed to delete device:', {
			component: 'deviceMove',
			devicePath,
			error,
		});
		throw error;
	}
}
