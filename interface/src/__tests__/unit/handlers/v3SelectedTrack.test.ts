/**
 * vitest coverage for the PR-7d pr7d-6 focused-address handler.
 *
 * `/looping/v3/selected_track [trackPath]` — emit from
 * `SelectedTrackComponent` on the Python surface. Parses the
 * canonical path (`tracks/<N>` | `master`) and forwards the numeric
 * index to `selectedTrackStore.handleTrackSelected` (the same
 * narrow writer the M4L `/looping/track/selected` branch already
 * drives).
 *
 * Pins:
 * - path → index mapping for `tracks/<N>` and `master`
 * - unknown / returns / short-args paths skip without touching state
 * - end-to-end dispatch via `simpleClient.ts` Priority 1.4 drives
 *   the same store field (covered by `trackSelected.test.ts` via
 *   the M4L branch; here we just pin the handler in isolation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

vi.mock('$lib/services/instrumentService', () => ({
	instrumentService: {
		identifyInstrumentType: vi.fn(() => 'unknown')
	}
}));

vi.mock('$lib/stores/v6/slotRegistry.svelte', () => ({
	slotRegistry: {
		resetForTrackChange: vi.fn(),
		getAllSlots: vi.fn(() => new Map()),
		getPositionForDeviceType: vi.fn(() => null),
		getDeviceTypeForPosition: vi.fn(() => null)
	}
}));

vi.mock('$lib/stores/session.svelte', () => ({
	handleSessionUpdate: vi.fn(),
	handleTrackListUpdate: vi.fn(),
	handleRootNoteUpdate: vi.fn(),
	handleScaleNameUpdate: vi.fn()
}));

import {
	handleV3SelectedTrack,
	V3_SELECTED_TRACK_ADDRESS
} from '$lib/api/handlers/v3SelectedTrack';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';

describe('handleV3SelectedTrack (pr7d-6)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset the singleton to track 0 via the narrow setter.
		selectedTrackStore.handleTrackSelected(0);
	});

	it('exposes the focused address as a module constant', () => {
		expect(V3_SELECTED_TRACK_ADDRESS).toBe('/looping/v3/selected_track');
	});

	it('maps "tracks/<N>" to the numeric index', () => {
		handleV3SelectedTrack(['tracks/4']);
		expect(selectedTrackStore.trackIndex).toBe(4);
		expect(selectedTrackStore.selectedTrackPath).toBe('tracks/4');
	});

	it('maps "master" to -1', () => {
		handleV3SelectedTrack(['master']);
		expect(selectedTrackStore.trackIndex).toBe(-1);
		expect(selectedTrackStore.selectedTrackPath).toBe('master');
	});

	it('is idempotent on repeat (handleTrackSelected short-circuits)', () => {
		handleV3SelectedTrack(['tracks/3']);
		expect(selectedTrackStore.trackIndex).toBe(3);
		handleV3SelectedTrack(['tracks/3']);
		expect(selectedTrackStore.trackIndex).toBe(3);
	});

	it('drops silently on "returns/<N>" path (surface never emits this, but guard defends)', () => {
		handleV3SelectedTrack(['tracks/2']);
		const before = selectedTrackStore.trackIndex;
		handleV3SelectedTrack(['returns/0']);
		expect(selectedTrackStore.trackIndex).toBe(before);
	});

	it('drops silently on unknown path shape', () => {
		handleV3SelectedTrack(['tracks/1']);
		const before = selectedTrackStore.trackIndex;
		handleV3SelectedTrack(['garbage']);
		expect(selectedTrackStore.trackIndex).toBe(before);
	});

	it('drops silently on non-integer index', () => {
		handleV3SelectedTrack(['tracks/2']);
		const before = selectedTrackStore.trackIndex;
		handleV3SelectedTrack(['tracks/abc']);
		expect(selectedTrackStore.trackIndex).toBe(before);
	});

	it('drops silently on negative index (compose_track_path never emits this)', () => {
		handleV3SelectedTrack(['tracks/2']);
		const before = selectedTrackStore.trackIndex;
		handleV3SelectedTrack(['tracks/-1']);
		expect(selectedTrackStore.trackIndex).toBe(before);
	});

	it('drops silently on empty args', () => {
		handleV3SelectedTrack(['tracks/2']);
		const before = selectedTrackStore.trackIndex;
		handleV3SelectedTrack([]);
		expect(selectedTrackStore.trackIndex).toBe(before);
	});

	it('coerces non-string arg via String() (defensive — wire contract is string)', () => {
		// The wire contract pins trackPath as a string. Defend against a
		// bridge-side type smear that arrives numeric; we String() it and
		// then the path parser rejects it.
		handleV3SelectedTrack(['tracks/7']);
		const before = selectedTrackStore.trackIndex;
		handleV3SelectedTrack([123 as unknown as string]);
		expect(selectedTrackStore.trackIndex).toBe(before);
	});
});
