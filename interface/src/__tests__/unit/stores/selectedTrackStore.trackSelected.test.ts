/**
 * closeout-0a tests — `selectedTrackStore.handleTrackSelected`.
 *
 * Covers the narrow writer of `_trackIndex` introduced by
 * closeout-0a so that track selection keeps working after
 * closeout-2 deletes `handleDeviceList`. Two cases:
 *
 * 1. Direct method call updates `trackIndex` + `selectedTrackPath`.
 * 2. End-to-end via `handleV3SelectedTrack` — the Python Surface
 *    `/looping/v3/selected_track` path drives the same narrow
 *    writer (PR-7d pr7d-7 retired the M4L branch).
 *
 * @see Looping's documentation/archive/m4l-to-python-v3/phase-5-checklist.md
 *   Row `closeout-0a-track-selection-bridge`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-scope mocks ------------------------------------------------

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

import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { handleV3SelectedTrack } from '$lib/api/handlers/v3SelectedTrack';

describe('selectedTrackStore.handleTrackSelected (closeout-0a)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset the singleton to track 0 via the narrow setter.
		selectedTrackStore.handleTrackSelected(0);
	});

	it('updates trackIndex and selectedTrackPath', () => {
		expect(selectedTrackStore.trackIndex).toBe(0);

		selectedTrackStore.handleTrackSelected(3);

		expect(selectedTrackStore.trackIndex).toBe(3);
		expect(selectedTrackStore.selectedTrackPath).toBe('tracks/3');
	});

	it('is a no-op when trackIndex is unchanged', () => {
		// Go to 5 first.
		selectedTrackStore.handleTrackSelected(5);
		expect(selectedTrackStore.trackIndex).toBe(5);

		// Re-dispatch 5 — should not re-enter side effects. The setter
		// returns early, so trackIndex stays 5 and no observable state
		// changes. We assert the stable value.
		selectedTrackStore.handleTrackSelected(5);
		expect(selectedTrackStore.trackIndex).toBe(5);
		expect(selectedTrackStore.selectedTrackPath).toBe('tracks/5');
	});

	it('handles master selection (trackIndex === -1)', () => {
		selectedTrackStore.handleTrackSelected(-1);
		expect(selectedTrackStore.trackIndex).toBe(-1);
		expect(selectedTrackStore.selectedTrackPath).toBe('master');
	});

	it('dispatching /looping/v3/selected_track drives selectedTrackStore._trackIndex (end-to-end)', () => {
		// PR-7d pr7d-7: the M4L `/looping/track/selected` branch was
		// retired; the Python Surface now owns selection via the v3
		// handler. This pins that the v3 handler drives the same
		// narrow writer.
		expect(selectedTrackStore.trackIndex).toBe(0);

		handleV3SelectedTrack(['tracks/7']);

		expect(selectedTrackStore.trackIndex).toBe(7);
		expect(selectedTrackStore.selectedTrackPath).toBe('tracks/7');
	});
});
