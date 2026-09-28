/**
 * vitest coverage for the preset load-state store the track strip reads.
 *
 * This store exists because the browser closes optimistically — it no longer
 * holds itself open until Live confirms a load, so the whole report (in flight,
 * then landed) has to be deliverable *after* the browser is gone. These are the
 * properties that have to hold for the strip to mean what it claims:
 *
 *   - both phases expire on their own; a stuck "pending" would read as a load
 *     that never finished, which is worse than no feedback at all;
 *   - a newer load supersedes an older one rather than stacking, because two
 *     lit strips would say two things are arriving, which is never true;
 *   - the ack may land on a DIFFERENT track than the one marked pending (Python
 *     owns reuse-vs-create), and the entry has to follow it without leaving the
 *     old strip lit;
 *   - non-track paths are ignored, so a master/return ack can't mark a strip
 *     that never received anything.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
	presetLandingStore,
	LANDING_PULSE_MS,
	PENDING_MAX_MS
} from '$lib/stores/v6/presetLandingStore.svelte';

describe('presetLandingStore', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		presetLandingStore.clear();
	});

	afterEach(() => {
		presetLandingStore.clear();
		vi.useRealTimers();
	});

	it('starts empty', () => {
		expect(presetLandingStore.entry).toBeNull();
		expect(presetLandingStore.pendingTrackPath).toBeNull();
		expect(presetLandingStore.landedTrackPath).toBeNull();
	});

	describe('pending', () => {
		it('markPending() names the target track and the incoming preset', () => {
			presetLandingStore.markPending('tracks/2', 'Fender Rhodes');
			expect(presetLandingStore.pendingTrackPath).toBe('tracks/2');
			expect(presetLandingStore.pendingName).toBe('Fender Rhodes');
			// Pending is not landed — the strip sweeps, it doesn't pulse.
			expect(presetLandingStore.landedTrackPath).toBeNull();
		});

		it('expires on its own so a dropped ack cannot strand a strip', () => {
			presetLandingStore.markPending('tracks/2', 'Fender Rhodes');
			vi.advanceTimersByTime(PENDING_MAX_MS - 1);
			expect(presetLandingStore.pendingTrackPath).toBe('tracks/2');
			vi.advanceTimersByTime(2);
			expect(presetLandingStore.entry).toBeNull();
		});

		it('outlives the prepare timeout, so the banner always reports first', () => {
			// PREPARE_TIMEOUT_MS is 8s; the safety net must sit above it or the
			// strip would clear itself before anything explained why.
			expect(PENDING_MAX_MS).toBeGreaterThan(8000);
		});
	});

	describe('landing', () => {
		it('markLanded() flips the phase and carries the preset name forward', () => {
			presetLandingStore.markPending('tracks/2', 'Fender Rhodes');
			presetLandingStore.markLanded('tracks/2');
			expect(presetLandingStore.landedTrackPath).toBe('tracks/2');
			expect(presetLandingStore.pendingTrackPath).toBeNull();
			expect(presetLandingStore.entry!.presetName).toBe('Fender Rhodes');
		});

		it('follows the ack onto a different track than the one marked pending', () => {
			presetLandingStore.markPending('tracks/2', 'Fender Rhodes');
			// Python reused tracks/5 instead of the pre-prepped landing pad.
			presetLandingStore.markLanded('tracks/5');
			expect(presetLandingStore.landedTrackPath).toBe('tracks/5');
			// The landing pad must not be left lit.
			expect(presetLandingStore.pendingTrackPath).toBeNull();
			expect(presetLandingStore.entry!.trackPath).toBe('tracks/5');
		});

		it('works without a pending phase (a load that created its own track)', () => {
			presetLandingStore.markLanded('tracks/7');
			expect(presetLandingStore.landedTrackPath).toBe('tracks/7');
			expect(presetLandingStore.entry!.presetName).toBe('');
		});

		it('expires after LANDING_PULSE_MS, and shortens a pending window', () => {
			presetLandingStore.markPending('tracks/0', 'Kit');
			vi.advanceTimersByTime(300);
			presetLandingStore.markLanded('tracks/0');
			vi.advanceTimersByTime(LANDING_PULSE_MS - 1);
			expect(presetLandingStore.landedTrackPath).toBe('tracks/0');
			vi.advanceTimersByTime(2);
			expect(presetLandingStore.entry).toBeNull();
		});
	});

	it('a second load supersedes the first and restarts the window', () => {
		presetLandingStore.markLanded('tracks/0');
		vi.advanceTimersByTime(LANDING_PULSE_MS - 200);
		presetLandingStore.markLanded('tracks/1');
		expect(presetLandingStore.landedTrackPath).toBe('tracks/1');
		// The first mark's expiry must not cut the second one short.
		vi.advanceTimersByTime(201);
		expect(presetLandingStore.landedTrackPath).toBe('tracks/1');
		vi.advanceTimersByTime(LANDING_PULSE_MS);
		expect(presetLandingStore.entry).toBeNull();
	});

	it('ignores non-track paths in both phases', () => {
		presetLandingStore.markPending('master', 'X');
		expect(presetLandingStore.entry).toBeNull();
		presetLandingStore.markLanded('returns/0');
		expect(presetLandingStore.entry).toBeNull();
	});

	it('a rejected path leaves an existing entry alone', () => {
		presetLandingStore.markPending('tracks/2', 'Rhodes');
		presetLandingStore.markLanded('master');
		expect(presetLandingStore.pendingTrackPath).toBe('tracks/2');
	});

	it('clear() retires the strip immediately — the failure path', () => {
		presetLandingStore.markPending('tracks/4', 'Rhodes');
		presetLandingStore.clear();
		expect(presetLandingStore.entry).toBeNull();
	});
});
