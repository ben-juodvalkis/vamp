/**
 * deviceParams.ts — the one write path for a device parameter from a
 * control.
 *
 * Two copies of this lived in components (`useFxGridSlot`'s and
 * `BaseDeviceControl`'s `sendParam`), and they differed in exactly one
 * respect, which is now the `pending` argument:
 *
 * - **With `pending`** (a central view's FX-grid slot): a write to a slot
 *   that is still a ghost or still loading is held in the slot's pending
 *   table (`storePendingParam`) and drained into the device when it
 *   arrives; a ghost also starts its load. A write to a loaded device goes
 *   to the wire.
 * - **Without it** (a strip tile): a write with no device is dropped. The
 *   tile stores pending values itself, through its own `storePendingParam`.
 *
 * Either way the wire write is `selectedTrackStore.setParamValue`, which
 * applies optimistically to the v3 store and arms the value for the
 * gesture's round-trip (paramArming). That is why this goes through the
 * store and not `send`: a raw send would leave the control snapping back
 * to the store's stale value until Live echoed.
 */

import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import type { DeviceRecord, SlotKey } from '$lib/stores/v6/selectedTrackStore.svelte';

export interface ParamTarget {
	device: DeviceRecord | null | undefined;
	/** The FX-grid slot the device lives in, when a ghost or loading slot should hold the write. */
	pending?: {
		slotKey: SlotKey;
		/** The pad scope's path (issue #491), or `''` for the track. */
		scopeKey: string;
		isGhost: boolean;
		isLoading: boolean;
	};
}

/** Write `value` to parameter `paramIndex` of the target's device. */
export function sendParam(target: ParamTarget, paramIndex: number, value: number): Promise<void> | void {
	const { device, pending } = target;
	if (pending && (pending.isGhost || pending.isLoading)) {
		selectedTrackStore.storePendingParam(pending.slotKey, paramIndex, value, pending.scopeKey);
		// De-dup lives in the slot (`loadState`), not here — several
		// consumers share one slot. See fxGridStore.loadDevice.
		if (pending.isGhost) {
			selectedTrackStore.loadFxGridDevice(pending.slotKey, pending.scopeKey);
		}
		return;
	}
	if (device) {
		return selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, paramIndex), value);
	}
}
