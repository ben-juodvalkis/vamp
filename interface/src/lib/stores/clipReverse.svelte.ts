/**
 * Clip Reverse Store
 *
 * Tracks the in-flight state of `/cmd/clip/reverse` (the AX-click path,
 * see ADR-368). The bridge sends `/cmd/clip/reverse/ack` with [1] on
 * success or [0, "<stderr>"] on failure; the simpleClient handler
 * forwards both into this store. UI reads `isReversing` to disable the
 * button while the osascript click is in flight (up to 3 s).
 *
 * Why a store and not a local component flag: the original
 * implementation used a 200 ms setTimeout, which detached the lock from
 * actual completion (PR-411 review). The ack-driven flag here can't
 * desync because the bridge owns the lifecycle.
 */
import { logger } from '$lib/utils/logger';

class ClipReverseStore {
	isReversing = $state(false);
	lastError = $state<string | null>(null);

	begin() {
		this.isReversing = true;
		this.lastError = null;
	}

	handleAck(ok: boolean, detail?: string) {
		this.isReversing = false;
		if (!ok) {
			this.lastError = detail ?? 'unknown';
			logger.warn('Clip reverse failed', {
				component: 'clipReverseStore',
				detail: detail ?? null,
			});
		} else {
			this.lastError = null;
		}
	}
}

export const clipReverseStore = new ClipReverseStore();
