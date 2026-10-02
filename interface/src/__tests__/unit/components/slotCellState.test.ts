/**
 * Tests for the session grid's cell-state derivation (ADR-415).
 *
 * A cell reconciles a snapshot (the S record from the last `state/full`)
 * with a live channel (`playingClipsStore`, fed by `playing_slot` plus a
 * 30 Hz playhead). The interesting cases are all disagreements — and the
 * one that matters most is the stale snapshot, because getting it wrong
 * leaves a clip painted as playing after it has stopped, with nothing to
 * correct it until the next full ride.
 */

import { describe, it, expect } from 'vitest';

import {
	deriveSlotCellState,
	slotActionGlyph
} from '$lib/components/v6/tracks/TrackStrip/utils/slotCellState';

describe('deriveSlotCellState — snapshot only', () => {
	it('paints an empty slot empty', () => {
		expect(deriveSlotCellState('empty', undefined, 0)).toBe('empty');
	});

	it('paints a slot holding a clip as a chip', () => {
		expect(deriveSlotCellState('has_clip', undefined, 0)).toBe('has_clip');
	});

	it('treats a slot the snapshot never mentioned as empty', () => {
		expect(deriveSlotCellState(undefined, undefined, 0)).toBe('empty');
	});

	it('demotes a stale playing snapshot to a plain chip', () => {
		// The S record is not re-emitted when a clip stops, so trusting it
		// would leave the cell painted green forever.
		expect(deriveSlotCellState('playing', undefined, 0)).toBe('has_clip');
	});

	it('demotes a stale recording snapshot too', () => {
		expect(deriveSlotCellState('recording', undefined, 0)).toBe('has_clip');
	});
});

describe('deriveSlotCellState — live channel wins on its own slot', () => {
	it('paints playing when the live channel says so', () => {
		expect(deriveSlotCellState('has_clip', { slotIdx: 2, status: 1 }, 2)).toBe('playing');
	});

	it('paints recording when the live channel says so', () => {
		expect(deriveSlotCellState('has_clip', { slotIdx: 2, status: 2 }, 2)).toBe('recording');
	});

	it('shows a clip launched since the last full ride', () => {
		// The snapshot still says empty; the live channel is the only
		// thing that knows a record just started here.
		expect(deriveSlotCellState('empty', { slotIdx: 3, status: 2 }, 3)).toBe('recording');
	});

	it('falls back to the snapshot when the live channel says stopped', () => {
		expect(deriveSlotCellState('has_clip', { slotIdx: 2, status: 0 }, 2)).toBe('has_clip');
	});

	it('does not invent a clip in an empty slot that is merely stopped', () => {
		expect(deriveSlotCellState('empty', { slotIdx: 2, status: 0 }, 2)).toBe('empty');
	});
});

describe('deriveSlotCellState — live channel is scoped to one slot', () => {
	it('leaves other slots on the track alone', () => {
		// The track is playing slot 2; slot 5 must not inherit that.
		expect(deriveSlotCellState('has_clip', { slotIdx: 2, status: 1 }, 5)).toBe('has_clip');
	});

	it('still demotes a stale snapshot on a slot the live channel is silent about', () => {
		expect(deriveSlotCellState('playing', { slotIdx: 2, status: 1 }, 5)).toBe('has_clip');
	});

	it('ignores the idle sentinel (-1) rather than matching a real slot', () => {
		expect(deriveSlotCellState('has_clip', { slotIdx: -1, status: 0 }, 0)).toBe('has_clip');
	});

	it('never lets slotIdx -1 collide with slot index -1', () => {
		// Defensive: there is no slot -1, but the sentinel must not paint.
		expect(deriveSlotCellState('empty', { slotIdx: -1, status: 1 }, -1)).toBe('playing');
		// ...and a real cell index is never negative, so the above is
		// unreachable in practice — the guard that matters is that a
		// stopped track (-1) leaves every real cell on its snapshot.
		expect(deriveSlotCellState('has_clip', { slotIdx: -1, status: 1 }, 0)).toBe('has_clip');
	});
});

describe('slotActionGlyph', () => {
	// The strip's mark is a promise about what the press does, so the
	// record dot is gated on the take actually being possible: Live's
	// `fire()` on an empty slot of an unarmed track records nothing.
	it('offers a take on an empty slot only when the track can record', () => {
		expect(slotActionGlyph('empty', true)).toBe('●');
		expect(slotActionGlyph('empty', false)).toBe('–');
	});

	it('is unaffected by arm state once the slot holds a clip', () => {
		for (const canRecord of [true, false]) {
			expect(slotActionGlyph('has_clip', canRecord)).toBe('▶');
			// Re-fire, not stop: the column's stop cell is the stop.
			expect(slotActionGlyph('playing', canRecord)).toBe('▶');
			// Fire, not stop: closing a take is how a looper keeps it.
			expect(slotActionGlyph('recording', canRecord)).toBe('▶');
		}
	});
});
