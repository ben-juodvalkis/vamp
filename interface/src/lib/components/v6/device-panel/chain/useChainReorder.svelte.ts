/**
 * Drops Live has not shown yet (2026-10-26; `utils/chainDrop`'s
 * `planReorder`): the order held on screen, and the one move on the wire.
 * A move is sent against the paths Live last reported, and the next waits
 * until Live shows the last, so two quick drops never send a path the
 * first has shifted. A move Live never shows runs out after `timeoutMs`
 * and the order falls back to Live's.
 *
 * Re-planned on events, never by an effect that reads and writes its own
 * state: a drop (`drop`), Live's report of the chain (the cells changing),
 * and the move in flight running out (its timer).
 */
import { untrack } from 'svelte';
import { planReorder, REORDER_IDLE, type ChainEntry, type ReorderState } from '$lib/utils/chainDrop';

export class ChainReorder {
	state = $state<ReorderState>(REORDER_IDLE);
	private timer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * `cells`: the chain as Live reports it, in its order. `send`: put the
	 * device at `path` at chain position `to` (as drawn in `cells`).
	 * Call during component initialisation: it owns an `$effect`.
	 */
	constructor(
		private cells: () => readonly ChainEntry[],
		private send: (path: string, to: number, cells: readonly ChainEntry[]) => Promise<unknown>,
		private timeoutMs: number
	) {
		// Live reported the chain: the move in flight landed (or not).
		$effect(() => {
			this.cells();
			untrack(() => this.replan());
		});
	}

	/** A drop: hold `desired` on screen and send the first move toward it. */
	drop(desired: ReorderState['desired']) {
		this.state = { desired, inflight: this.state.inflight };
		this.replan();
	}

	/** Forget every drop (another track or pad, or Live refused one). */
	reset() {
		this.clearTimer();
		this.state = REORDER_IDLE;
	}

	destroy() {
		this.clearTimer();
	}

	private replan() {
		this.clearTimer();
		const state = this.state;
		if (!state.desired) return;
		const cells = this.cells();
		const now = Date.now();
		const { state: next, send } = planReorder(state, cells, now, this.timeoutMs);
		if (send) void this.send(send.path, send.to, cells).catch(() => this.reset());
		if (next !== state) this.state = next;
		if (!next.inflight) return;
		// Wake when the move in flight runs out, if Live never shows it.
		this.timer = setTimeout(() => {
			this.timer = null;
			this.replan();
		}, Math.max(0, next.inflight.until - now));
	}

	private clearTimer() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
