/**
 * Similar-sound swap on a Drum Rack, from the interface (ADR-439 phase 3).
 *
 * Sends `/looping/v3/drum/swap_similar [requestId, rackPath, scope, direction]`
 * to the bridge, which presses Live's own swap button through the AX helper
 * (the whole kit's Swap All, or the pad's Drum Sampler's own, which swaps
 * without playing the pad) and replies to this client
 * on `/looping/v3/drum/swap_similar/reply [requestId, ok, code, detail, result]`.
 * The ranking and the reference sample are Live's.
 *
 * Kept per rack and scope (`kit`, `pad:<note>`): whether a swap is in flight,
 * and the named error when one could not happen (`ax-untrusted`,
 * `ax-helper-down`, `ax-control-missing`, `swap-not-a-drum-rack`, …) — never a
 * silent no-op.
 */

import { SvelteMap } from 'svelte/reactivity';
import { holdSwapError, dropSwapError } from './swapErrors';
import { send } from '$lib/api/simpleClient';
import {
	addOscMessageListener,
	removeOscMessageListener,
	type OscBusMessage
} from '$lib/api/connection/oscMessageBus';
import { logger } from '$lib/utils/logger';

export const SWAP_SIMILAR_ADDRESS = '/looping/v3/drum/swap_similar';
export const SWAP_SIMILAR_REPLY_ADDRESS = '/looping/v3/drum/swap_similar/reply';

/**
 * A cold first kit pass takes ~5 s. This 45 s is the client's ceiling on ONE
 * request; it is not the worst a press can wait. Swaps are serialized across
 * every rack (one queue in `drumSwapSimilar.js`, because each selects its own
 * track), so a request queued behind another waits that one out first — the
 * audit put the real ceiling at 72 s for two and 119 s in the tail. What bounds
 * the *bridge* side is its own 45 s deadline over `swap()` (swap audit M5),
 * under the surface's 60 s undo-step expiry; a second request for the same rack
 * is refused outright with `swap-busy` (M8) rather than queued.
 */
const REPLY_TIMEOUT_MS = 45_000;

export type SwapDirection = 'next' | 'prev';

export interface SimilarSwapState {
	working: boolean;
	error: string | null;
}

const IDLE: SimilarSwapState = Object.freeze({ working: false, error: null });

type Sender = (address: string, args: Array<string | number>) => void;

function requestId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `swap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** `kit`, or `pad:<note>` for a held pad. */
export function swapScope(note: number | null): string {
	return note === null ? 'kit' : `pad:${note}`;
}

class SimilarSwapStore {
	#states = new SvelteMap<string, SimilarSwapState>();
	#send: Sender = (address, args) => send(address, args);
	#timeoutMs = REPLY_TIMEOUT_MS;

	state(rackPath: string, scope: string): SimilarSwapState {
		return this.#states.get(`${rackPath}|${scope}`) ?? IDLE;
	}

	async run(rackPath: string, scope: string, direction: SwapDirection): Promise<void> {
		const key = `${rackPath}|${scope}`;
		if (this.state(rackPath, scope).working) return;
		dropSwapError(key);
		this.#states.set(key, { working: true, error: null });
		try {
			const [, ok, code, detail] = await this.#request([rackPath, scope, direction]);
			if (Number(ok) === 1) {
				this.#states.delete(key);
				return;
			}
			const error = detail ? `${code}: ${detail}` : String(code || 'swap-failed');
			logger.warn('Similar swap refused', { component: 'similarSwap', rackPath, scope, direction, error });
			this.#fail(key, error);
		} catch (err) {
			this.#fail(key, err instanceof Error ? err.message : String(err));
		}
	}

	/**
	 * Wear the reason, then go back to naming the kit. The pill's key is
	 * positional, so a message left on it outlives the rack it was about —
	 * see `swapErrors`.
	 */
	#fail(key: string, error: string): void {
		this.#states.set(key, { working: false, error });
		holdSwapError(key, () => this.#states.delete(key));
	}

	#request(args: Array<string | number>): Promise<unknown[]> {
		const id = requestId();
		return new Promise((resolve, reject) => {
			const listener = (message: OscBusMessage) => {
				if (message.address !== SWAP_SIMILAR_REPLY_ADDRESS || !message.args) return;
				if (String(message.args[0]) !== id) return;
				clearTimeout(timer);
				removeOscMessageListener(listener);
				resolve(message.args);
			};
			const timer = setTimeout(() => {
				removeOscMessageListener(listener);
				reject(new Error(`swap-timeout: no reply within ${Math.round(this.#timeoutMs / 1000)} s`));
			}, this.#timeoutMs);
			addOscMessageListener(listener);
			this.#send(SWAP_SIMILAR_ADDRESS, [id, ...args]);
		});
	}

	_setForTests(deps: { send?: Sender; timeoutMs?: number }): void {
		if (deps.send) this.#send = deps.send;
		if (deps.timeoutMs !== undefined) this.#timeoutMs = deps.timeoutMs;
	}

	_resetForTests(): void {
		this.#states.clear();
		this.#send = (address, args) => send(address, args);
		this.#timeoutMs = REPLY_TIMEOUT_MS;
	}
}

export const similarSwap = new SimilarSwapStore();
