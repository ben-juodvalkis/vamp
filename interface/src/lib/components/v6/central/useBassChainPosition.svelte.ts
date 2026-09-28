/**
 * useBassChainPosition — the Bass amp goes to the HEAD of the chain when
 * the app is what loaded it.
 *
 * The Bass is a plug-in preset loaded through the browser, and Live
 * appends a browser load to the END of the chain — behind the amp and
 * every pedal, which is the wrong voice for it. The wah has exactly this
 * problem and answers it with a one-shot flag armed at load time
 * (`WahPedalComponent._pending_move_to_top`); this is that rule at the UI
 * layer, because the load is triggered from a control and nothing on the
 * surface knows the bass slot exists. The move cannot be inline: the load
 * is async, so the device does not exist yet when we ask for it.
 *
 * Two controls drive that slot now — the Bass panel in
 * `GuitarCentralView` and the `BassControl` tile in the audio track's fx1
 * column (2026-09-14) — so the rule lives here rather than in either of
 * them. It was a view-local `let` + `$effect` until the tile needed the
 * same twenty lines.
 *
 * `arm()` is called by the gesture that MIGHT load, before the write that
 * triggers it: it only latches when the slot is a ghost on the track, so
 * a gesture on a device that already exists arms nothing. Arm only where a
 * load can actually follow — a latch left standing after a gesture that
 * loaded nothing would fire on the next bass device to arrive from
 * anywhere, including one the user dragged in by hand.
 */

import { moveDeviceToTop } from '$lib/services/deviceMoveService';
import { logger } from '$lib/utils/logger';
import type { FxGridSlotHandle } from './useFxGridSlot.svelte';

export interface BassChainPosition {
	/** Arm the move if this gesture is the one that loads the device. */
	arm(): void;
}

export function useBassChainPosition(
	bass: FxGridSlotHandle,
	component: string
): BassChainPosition {
	// A plain `let`, not `$state`: nothing renders it, and the effect below
	// must key on the device ARRIVING rather than re-run when it is cleared.
	let pending = false;

	function arm(): void {
		// Never under a pad scope: a pad's chain is its instrument and an
		// effect or two, so "first position" there would put an audio effect
		// ahead of the instrument — the same rule the reorder arrows follow.
		if (bass.isGhost && bass.scope === null) pending = true;
	}

	$effect(() => {
		const path = bass.devicePath;
		if (!path || !pending) return;
		pending = false;
		moveDeviceToTop(path).catch((error) =>
			logger.error('Failed to move loaded bass to the head of the chain', { component, error })
		);
	});

	return { arm };
}
