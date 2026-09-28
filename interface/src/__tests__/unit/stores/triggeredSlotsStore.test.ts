/**
 * triggeredSlotsStore + the `/looping/v3/clip/triggered` handler.
 *
 * The launch-queued channel is edge-triggered on BOTH edges, so the
 * contracts worth pinning are the ones that would otherwise leave a
 * cell blinking with nothing left to stop it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { triggeredSlotsStore } from '$lib/stores/v6/triggeredSlotsStore.svelte';
import {
	handleV3Clip,
	isV3ClipAddress,
	V3_CLIP_TRIGGERED_ADDRESS
} from '$lib/api/handlers/v3Clip';

beforeEach(() => {
	triggeredSlotsStore.clear();
});

describe('triggeredSlotsStore', () => {
	it('holds a slot from the rising edge to the falling one', () => {
		triggeredSlotsStore.set('tracks/0/slots/1', true);
		expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(true);

		triggeredSlotsStore.set('tracks/0/slots/1', false);
		expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(false);
	});

	it('tracks slots independently', () => {
		triggeredSlotsStore.set('tracks/0/slots/1', true);
		triggeredSlotsStore.set('tracks/2/slots/0', true);
		triggeredSlotsStore.set('tracks/0/slots/1', false);

		expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(false);
		expect(triggeredSlotsStore.has('tracks/2/slots/0')).toBe(true);
	});

	it('ignores an empty slotPath', () => {
		triggeredSlotsStore.set('', true);
		expect(triggeredSlotsStore.size).toBe(0);
	});

	it('clear() drops everything', () => {
		// A queue that resolved while the socket was down has no
		// falling edge left to arrive — resync has to clear it or the
		// cell blinks forever.
		triggeredSlotsStore.set('tracks/0/slots/1', true);
		triggeredSlotsStore.set('tracks/1/slots/1', true);

		triggeredSlotsStore.clear();

		expect(triggeredSlotsStore.size).toBe(0);
	});
});

describe('optimistic mark', () => {
	it('marks the slot immediately, before any wire answer', () => {
		triggeredSlotsStore.markPending('tracks/0/slots/1');
		expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(true);
	});

	it('resolve() ends it — the launch landed', () => {
		triggeredSlotsStore.markPending('tracks/0/slots/1');
		triggeredSlotsStore.resolve('tracks/0/slots/1');
		expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(false);
	});

	it('a falling edge from the surface ends it', () => {
		triggeredSlotsStore.markPending('tracks/0/slots/1');
		triggeredSlotsStore.set('tracks/0/slots/1', false);
		expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(false);
	});

	it('expires on its own — an unarmed empty slot never launches', () => {
		vi.useFakeTimers();
		try {
			triggeredSlotsStore.markPending('tracks/0/slots/1');
			// Longer than any grid interval the tempo maths can produce.
			vi.advanceTimersByTime(60_000);
			expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('survives a full bar at the default tempo', () => {
		// The bug this replaced: a fixed 1.5s timeout stopped the pulse
		// mid-wait, so the cell went quiet while the clip was still
		// queued. 1 bar at 120 BPM is 2s.
		vi.useFakeTimers();
		try {
			triggeredSlotsStore.markPending('tracks/0/slots/1');
			vi.advanceTimersByTime(1900);
			expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a real rising edge supersedes the guess and does not expire', () => {
		vi.useFakeTimers();
		try {
			triggeredSlotsStore.markPending('tracks/0/slots/1');
			triggeredSlotsStore.set('tracks/0/slots/1', true);
			vi.advanceTimersByTime(60_000);
			// Only the surface's own falling edge (or a resolve) may
			// clear a surface-confirmed queue — an 8-bar wait at a slow
			// tempo must not time out under it.
			expect(triggeredSlotsStore.has('tracks/0/slots/1')).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('clip/triggered wire handler', () => {
	it('is routed as a v3 clip address', () => {
		expect(isV3ClipAddress(V3_CLIP_TRIGGERED_ADDRESS)).toBe(true);
	});

	it('applies both edges', () => {
		handleV3Clip(V3_CLIP_TRIGGERED_ADDRESS, ['tracks/3/slots/2', 1]);
		expect(triggeredSlotsStore.has('tracks/3/slots/2')).toBe(true);

		handleV3Clip(V3_CLIP_TRIGGERED_ADDRESS, ['tracks/3/slots/2', 0]);
		expect(triggeredSlotsStore.has('tracks/3/slots/2')).toBe(false);
	});

	it('drops a short payload rather than guessing', () => {
		handleV3Clip(V3_CLIP_TRIGGERED_ADDRESS, ['tracks/3/slots/2']);
		expect(triggeredSlotsStore.size).toBe(0);
	});

	it('treats any non-1 flag as cleared', () => {
		handleV3Clip(V3_CLIP_TRIGGERED_ADDRESS, ['tracks/3/slots/2', 1]);
		handleV3Clip(V3_CLIP_TRIGGERED_ADDRESS, ['tracks/3/slots/2', 0]);
		expect(triggeredSlotsStore.has('tracks/3/slots/2')).toBe(false);
	});
});
