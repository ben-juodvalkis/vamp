/**
 * Where a device dragged in the chain overview lands.
 *
 * A drop is a slot between cells, 0..count (before the first .. after
 * the last). The device's final index is the slot, less one when the
 * slot is past where it started (it leaves its old place first).
 *
 * The instrument stays put and nothing crosses it: Live keeps MIDI
 * effects before the instrument and audio effects after it, so a drop on
 * the far side clamps to the instrument's near edge.
 */
export function chainDropIndex(input: {
	from: number;
	slot: number;
	count: number;
	/** The instrument's index on a MIDI track, or null. */
	instrument: number | null;
}): number | null {
	const { from, count, instrument } = input;
	if (from === instrument) return null;
	let slot = Math.max(0, Math.min(count, input.slot));
	if (instrument !== null) {
		slot = from < instrument ? Math.min(slot, instrument) : Math.max(slot, instrument + 1);
	}
	const to = slot > from ? slot - 1 : slot;
	return to === from ? null : to;
}
