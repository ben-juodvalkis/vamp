/**
 * The momentary-toggle release rule — Solo (ADR-414) and mute (ADR-427
 * addendum 3) — and the case that was missing.
 *
 * Solo toggles at true finger-down, so a press that never gets a release
 * leaves the track soloed. `TrackStrip`'s `$effect` teardown used to drop the
 * window listeners and return — no restore — and the strip really can unmount
 * mid-press: `TracksPanelV6` renders `{#each visibleTracks as trackIndex (trackIndex)}`,
 * so folding a group, removing empty tracks, or any structural change that
 * reorders the list destroys the component under the finger.
 *
 * The failure is bad in a way the rest of the UI is not: one track soloed with
 * no finger on it means every other track is inaudible, mid-set, with no
 * gesture left that could undo it — the button that would release it has
 * unmounted.
 */

import { describe, it, expect } from 'vitest';
import {
	shouldRestoreOnRelease,
	MOMENTARY_HOLD_MS
} from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';

describe('solo release rule', () => {
	it('latches a short tap — the down-toggle stands', () => {
		expect(shouldRestoreOnRelease({ elapsedMs: 0, reason: 'up' })).toBe(false);
		expect(shouldRestoreOnRelease({ elapsedMs: MOMENTARY_HOLD_MS - 1, reason: 'up' })).toBe(false);
	});

	it('restores after a hold — momentary', () => {
		expect(shouldRestoreOnRelease({ elapsedMs: MOMENTARY_HOLD_MS, reason: 'up' })).toBe(true);
		expect(shouldRestoreOnRelease({ elapsedMs: 5000, reason: 'up' })).toBe(true);
	});

	it('puts the boundary at exactly MOMENTARY_HOLD_MS, inclusive', () => {
		expect(shouldRestoreOnRelease({ elapsedMs: 299, reason: 'up', holdMs: 300 })).toBe(false);
		expect(shouldRestoreOnRelease({ elapsedMs: 300, reason: 'up', holdMs: 300 })).toBe(true);
	});

	it('restores on pointercancel regardless of elapsed time', () => {
		// The browser claimed the gesture; the performer never released.
		for (const elapsedMs of [0, 1, MOMENTARY_HOLD_MS, 10_000]) {
			expect(shouldRestoreOnRelease({ elapsedMs, reason: 'cancel' })).toBe(true);
		}
	});

	it('restores on teardown regardless of elapsed time — the stuck-solo case', () => {
		// The regression. A strip unmounting mid-press is an interrupted
		// gesture, not a completed one. Short presses matter most here: under
		// the pointerup rule a 10ms press latches, which is correct for a tap
		// and catastrophic for an unmount.
		for (const elapsedMs of [0, 10, MOMENTARY_HOLD_MS - 1, MOMENTARY_HOLD_MS, 10_000]) {
			expect(shouldRestoreOnRelease({ elapsedMs, reason: 'teardown' })).toBe(true);
		}
	});

	it('never lets a teardown disagree with a cancel at the same instant', () => {
		// Both mean "no release happened". If these ever diverge, one of the
		// two exits is wrong.
		for (const elapsedMs of [0, 150, 299, 300, 900]) {
			expect(shouldRestoreOnRelease({ elapsedMs, reason: 'teardown' })).toBe(
				shouldRestoreOnRelease({ elapsedMs, reason: 'cancel' })
			);
		}
	});
});
