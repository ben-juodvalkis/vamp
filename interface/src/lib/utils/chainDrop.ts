/**
 * Where a device dragged in the chain overview lands, and the order the
 * overview shows while it is in flight.
 *
 * `to` is the index the device ends up at, in the chain as it is after
 * the move — the cell position under the finger in the previewed order.
 *
 * The instrument stays put and nothing crosses it: Live keeps MIDI
 * effects before the instrument and audio effects after it, so a position
 * on the far side clamps to the instrument's near edge.
 */
export function clampChainIndex(input: {
	from: number;
	to: number;
	count: number;
	/** The instrument's index on a MIDI track (or a pad), or null. */
	instrument: number | null;
}): number | null {
	const { from, count, instrument } = input;
	if (from === instrument) return null;
	let to = Math.max(0, Math.min(count - 1, input.to));
	if (instrument !== null) {
		// Before the instrument it shifts left by one once the device leaves.
		to = from < instrument ? Math.min(to, instrument - 1) : Math.max(to, instrument + 1);
	}
	return to;
}

/** `items` with the one at `from` moved to `to`. */
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
	const out = items.slice();
	const [item] = out.splice(from, 1);
	out.splice(to, 0, item);
	return out;
}
