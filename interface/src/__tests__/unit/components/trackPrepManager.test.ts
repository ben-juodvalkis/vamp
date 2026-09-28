/**
 * TrackPrepManager — a failed prepare must not latch the browser.
 *
 * The manager's four flags all encode a past bug (their comments say so), but
 * the failure path never cleared any of them: `prepareTrack` set
 * `prepStatus = 'preparing'` and parked the promise in `prepPromise`, and the
 * catch arm only logged. `hasPendingOrReadyPrep()` reads `prepPromise !== null`,
 * so after ONE failed prepare it answers true forever — and
 * `DrillDownBrowser.ensureTrackPrepared()` treats true as "someone else is
 * already doing it", awaits the settled promise, and returns without preparing.
 *
 * On stage that is: the first preset after a failed prep has no landing-pad
 * track, and so does every preset after that, for the life of the tab.
 *
 * `recovers ...` and `does not report a pending prep after a failure` are the
 * regression pair — both fail against the pre-fix catch arm.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prepareForPreset = vi.fn();

vi.mock('$lib/services/trackPreparation', () => ({
	prepareForPreset: (...args: unknown[]) => prepareForPreset(...args)
}));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { TrackPrepManager } from '$lib/components/v6/browser/utils/presetLoader';

describe('TrackPrepManager — failure does not latch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reports a pending prep while one is in flight', async () => {
		const mgr = new TrackPrepManager();
		let release!: (r: { trackIndex: number; wasCreated: boolean }) => void;
		prepareForPreset.mockReturnValueOnce(new Promise((res) => { release = res; }));

		const inFlight = mgr.prepareTrack('instrument');
		expect(mgr.hasPendingOrReadyPrep()).toBe(true);
		expect(mgr.getStatus()).toBe('preparing');

		release({ trackIndex: 3, wasCreated: true });
		await inFlight;
		expect(mgr.getStatus()).toBe('ready');
		expect(mgr.getTrackIndex()).toBe(3);
	});

	it('does not report a pending prep after a failure', async () => {
		const mgr = new TrackPrepManager();
		prepareForPreset.mockRejectedValueOnce(new Error('surface timed out'));

		const index = await mgr.prepareTrack('instrument');

		expect(index).toBeUndefined();
		expect(mgr.hasPendingOrReadyPrep()).toBe(false);
		expect(mgr.getStatus()).toBe('idle');
	});

	it('recovers: the next prepare after a failure actually runs', async () => {
		const mgr = new TrackPrepManager();
		prepareForPreset.mockRejectedValueOnce(new Error('surface timed out'));
		await mgr.prepareTrack('instrument');

		// This is what DrillDownBrowser.ensureTrackPrepared() does: it only
		// prepares when nothing is pending or ready. Pre-fix this branch was
		// unreachable for the rest of the session.
		expect(mgr.hasPendingOrReadyPrep()).toBe(false);

		prepareForPreset.mockResolvedValueOnce({ trackIndex: 7, wasCreated: true });
		const index = await mgr.prepareTrack('instrument');

		expect(prepareForPreset).toHaveBeenCalledTimes(2);
		expect(index).toBe(7);
		expect(mgr.isPrepared()).toBe(true);
		expect(mgr.getTrackType()).toBe('midi');
	});

	it('a failure clears the resolved track index rather than keeping a stale one', async () => {
		const mgr = new TrackPrepManager();
		prepareForPreset.mockResolvedValueOnce({ trackIndex: 2, wasCreated: false });
		await mgr.prepareTrack('instrument');
		expect(mgr.getTrackIndex()).toBe(2);

		prepareForPreset.mockRejectedValueOnce(new Error('nope'));
		await mgr.prepareTrack('instrument');

		// A load must never be aimed at the track a PREVIOUS prep resolved.
		expect(mgr.getTrackIndex()).toBeUndefined();
		expect(mgr.isPrepared()).toBe(false);
	});

	it('awaitPrep after a failure resolves undefined instead of hanging', async () => {
		const mgr = new TrackPrepManager();
		prepareForPreset.mockRejectedValueOnce(new Error('nope'));
		await mgr.prepareTrack('audio');

		await expect(mgr.awaitPrep()).resolves.toBeUndefined();
	});

	it('leaves the deliberate skip latch alone', async () => {
		const mgr = new TrackPrepManager();
		mgr.skipPrepAndMarkReady();

		// prepSkipped survives markAsUsed() on purpose — the Audio vendor and
		// replace mode must not re-enable up-front prep on the 2nd load.
		mgr.markAsUsed();
		expect(mgr.hasPendingOrReadyPrep()).toBe(true);

		mgr.reset();
		expect(mgr.hasPendingOrReadyPrep()).toBe(false);
	});
});
