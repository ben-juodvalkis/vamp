/**
 * Optimistic-write latches must self-heal (audit item 10 / action item 11).
 *
 * Each optimistic write records a pending value so that the ONE stale echo
 * from a rapid A→B tap is swallowed. The mismatch branch used to `return`
 * without clearing the latch, and nothing else writes these back to null —
 * there is no timer and no other reset. A confirming echo can legitimately
 * never arrive, because the surface emits only on an actual change: a write
 * that lands on the value Live is already on produces no echo at all.
 *
 * So one missed echo latched the store permanently, and every subsequent
 * Live-initiated change was dropped. The strip highlight and foot-pedal
 * target froze on a track the performer had left, and only a reconnect
 * recovered it.
 *
 * Each test below delivers TWO echoes. The first is the stale one and is
 * still dropped — that behaviour is deliberate and preserved. The second is
 * Live speaking for itself, and must land. Against the pre-fix store the
 * second echo is dropped too, because the latch is still set.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('$lib/stores/v6/centralDisplayStore.svelte', () => ({
	centralDisplayStore: { setView: vi.fn() }
}));

import { session, handleSessionUpdate } from '$lib/stores/session.svelte';

const at = () => Date.now();

describe('optimistic latches self-heal after a mismatched echo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Land each latch on a known value via a matching echo, so no test
		// inherits a pending write from the one before it.
		handleSessionUpdate({ type: 'track-selection', trackIndex: 0, timestamp: at() });
		handleSessionUpdate({ type: 'transport', isPlaying: false, timestamp: at() });
		handleSessionUpdate({ type: 'metronome', enabled: false, timestamp: at() });
	});

	it('track selection: a later Live-initiated selection still lands', () => {
		session.selectTrackOptimistically(5);
		expect(session.selectedTrackIndex).toBe(5);

		// Stale echo for an earlier tap — dropped, and it must not wedge the latch.
		handleSessionUpdate({ type: 'track-selection', trackIndex: 2, timestamp: at() });
		expect(session.selectedTrackIndex).toBe(5);

		// Live selects track 2 itself. This has to apply.
		handleSessionUpdate({ type: 'track-selection', trackIndex: 2, timestamp: at() });
		expect(session.selectedTrackIndex).toBe(2);
	});

	it('transport: a later Live-initiated play/stop still lands', () => {
		session.toggleTransportOptimistically(); // → true, pending true
		expect(session.isPlaying).toBe(true);

		handleSessionUpdate({ type: 'transport', isPlaying: false, timestamp: at() });
		expect(session.isPlaying).toBe(true); // stale echo dropped

		handleSessionUpdate({ type: 'transport', isPlaying: false, timestamp: at() });
		expect(session.isPlaying).toBe(false); // Live stopped; must apply
	});

	it('metronome: a later Live-initiated toggle still lands', () => {
		session.toggleMetronomeOptimistically(); // → true, pending true
		expect(session.metronome).toBe(true);

		handleSessionUpdate({ type: 'metronome', enabled: false, timestamp: at() });
		expect(session.metronome).toBe(true); // stale echo dropped

		handleSessionUpdate({ type: 'metronome', enabled: false, timestamp: at() });
		expect(session.metronome).toBe(false); // Live's own change; must apply
	});

	it('still swallows the single stale echo a rapid A→B tap produces', () => {
		session.selectTrackOptimistically(7);
		handleSessionUpdate({ type: 'track-selection', trackIndex: 3, timestamp: at() });
		// The whole point of the latch: B's optimistic value survives A's echo.
		expect(session.selectedTrackIndex).toBe(7);
	});
});
