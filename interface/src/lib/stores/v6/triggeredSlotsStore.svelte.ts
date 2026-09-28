/**
 * triggeredSlotsStore — launch-queued slots.
 *
 * A slot is "triggered" between the moment it is fired and the moment
 * the transport reaches the launch-quantization boundary. At 1-bar
 * quantization that is most of a bar in which the clip is neither
 * playing nor recording, and before this channel existed the grid had
 * nothing to show for it: the cell you tapped looked exactly like the
 * cell you didn't, until the bar turned. That reads as a missed tap,
 * and the reflex is to tap again — which in Live cancels the launch.
 *
 * Fed by `/looping/v3/clip/triggered [slotPath, 0|1]`, which the
 * surface emits from a per-slot `is_triggered` listener. Both edges
 * are on the wire, so nothing here has to time a blink out.
 *
 * Deliberately a bare set of paths rather than an entry in the S
 * record or in `playingClipsStore`:
 *
 *  - it is transient, so it must never ride a snapshot that outlives
 *    it (a stale `state/full` would leave a cell blinking forever);
 *  - it is slot-scoped, not track-scoped — an EMPTY slot queued to
 *    record is exactly the case that most needs the signal, and
 *    `playingClipsStore` is keyed by track and describes a clip.
 */

import { SvelteSet } from 'svelte/reactivity';
import { logger } from '$lib/utils/logger';
import { session } from '$lib/stores/session.svelte';

/**
 * Beats of wait per `song.clip_trigger_quantization` value — Live's
 * enum, coarse → fine, indexes matching `LAUNCH_QUANTIZATIONS`.
 *
 * Bar-relative entries are filled in from the time signature at read
 * time (a "1 Bar" launch in 3/4 waits three beats, not four), so the
 * bar rows carry their length in BARS and the rest in beats.
 */
const QUANT_BARS: Readonly<Record<number, number>> = { 1: 8, 2: 4, 3: 2, 4: 1 };
const QUANT_BEATS: Readonly<Record<number, number>> = {
	0: 0, // None — launches immediately
	5: 2, // 1/2
	6: 4 / 3, // 1/2T
	7: 1, // 1/4
	8: 2 / 3, // 1/4T
	9: 0.5, // 1/8
	10: 1 / 3, // 1/8T
	11: 0.25, // 1/16
	12: 1 / 6, // 1/16T
	13: 0.125 // 1/32
};

/** Round-trip allowance on top of the musical wait. */
const WIRE_SLACK_MS = 400;
/** Never shorter than this — a "None" launch still has a round trip. */
const MIN_OPTIMISTIC_MS = 500;
/** Never longer than this, whatever the tempo maths says. */
const MAX_OPTIMISTIC_MS = 40_000;

/**
 * How long an optimistic mark survives with nothing to confirm it.
 *
 * Derived, not guessed. A tap can land anywhere inside the launch
 * grid, so the longest honest wait is one full interval of that grid
 * at the current tempo — a fixed timeout is wrong at both ends (it
 * stops mid-wait at 8 bars / 60 BPM, and hangs around for seconds at
 * 1/16). The mark still has to expire at all, because firing an empty
 * slot on an unarmed track is a silent no-op in Live: no launch is
 * coming and no edge will arrive to clear it.
 *
 * In the normal case none of this is reached — the surface's own
 * `is_triggered` falling edge, or the slot starting to play, ends the
 * pulse first.
 */
function optimisticLifetimeMs(): number {
	const bpm = session.tempo > 0 ? session.tempo : 120;
	const beatsPerBar = session.timeSignature?.numerator || 4;
	const quant = session.clipTriggerQuantization;
	const beats =
		QUANT_BARS[quant] !== undefined
			? QUANT_BARS[quant] * beatsPerBar
			: (QUANT_BEATS[quant] ?? beatsPerBar);
	const ms = (beats * 60_000) / bpm + WIRE_SLACK_MS;
	return Math.min(MAX_OPTIMISTIC_MS, Math.max(MIN_OPTIMISTIC_MS, ms));
}

function createTriggeredSlotsStore() {
	const triggered = new SvelteSet<string>();
	/** Expiry timers for optimistic marks, keyed by slotPath. */
	const pending = new Map<string, ReturnType<typeof setTimeout>>();

	function cancelPending(slotPath: string): void {
		const timer = pending.get(slotPath);
		if (timer !== undefined) {
			clearTimeout(timer);
			pending.delete(slotPath);
		}
	}

	return {
		/** True while `slotPath` is fired but not yet launched. */
		has(slotPath: string): boolean {
			return triggered.has(slotPath);
		},

		/** Wire fire: `[slotPath, 0|1]`. Authoritative — it also ends
		 *  any optimistic guess for that slot, in either direction. */
		set(slotPath: string, isTriggered: boolean): void {
			if (!slotPath) return;
			cancelPending(slotPath);
			if (isTriggered) triggered.add(slotPath);
			else triggered.delete(slotPath);
		},

		/**
		 * Optimistic mark, made by the launch gesture itself.
		 *
		 * Everything about a launch is remote — the wire, the LOM
		 * listener, the transport boundary — so without this the cell
		 * shows nothing at all between the finger lifting and the
		 * surface answering. Self-expires (see {@link OPTIMISTIC_MS});
		 * a real `set()` supersedes it.
		 */
		markPending(slotPath: string): void {
			if (!slotPath) return;
			cancelPending(slotPath);
			triggered.add(slotPath);
			pending.set(
				slotPath,
				setTimeout(() => {
					pending.delete(slotPath);
					triggered.delete(slotPath);
				}, optimisticLifetimeMs())
			);
		},

		/**
		 * The launch resolved — this slot is playing or recording now,
		 * so it is no longer queued. Called from the `playing_slot`
		 * echo, which is the same event that repaints the cell, so the
		 * pulse ends exactly as the clip starts.
		 */
		resolve(slotPath: string): void {
			if (!slotPath) return;
			cancelPending(slotPath);
			triggered.delete(slotPath);
		},

		/**
		 * Drop everything. Called on reconnect / state resync: the
		 * surface only emits `is_triggered` on CHANGE, so a queue that
		 * resolved while the socket was down has no falling edge to
		 * arrive, and the cell would blink until the next launch.
		 */
		clear(): void {
			for (const timer of pending.values()) clearTimeout(timer);
			pending.clear();
			if (triggered.size === 0) return;
			logger.debug('triggeredSlotsStore: clearing', {
				component: 'triggeredSlotsStore',
				count: triggered.size
			});
			triggered.clear();
		},

		get size(): number {
			return triggered.size;
		}
	};
}

export const triggeredSlotsStore = createTriggeredSlotsStore();
