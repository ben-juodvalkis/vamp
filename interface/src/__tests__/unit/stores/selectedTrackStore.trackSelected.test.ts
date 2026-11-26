/**
 * The selected track has one owner: `session.selectedTrackIndex`, with its
 * optimistic write and stale-echo latch. `selectedTrackStore.trackIndex`
 * reads it, and the track-change side effects (FX grid reset, param arms,
 * the `track-changed` window event) run once per real change — never for
 * an echo the latch drops.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const { resetParamArmingSpy } = vi.hoisted(() => ({ resetParamArmingSpy: vi.fn() }));
vi.mock('$lib/stores/v3/paramArming.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/stores/v3/paramArming.svelte')>();
	return {
		...actual,
		resetParamArming: () => {
			resetParamArmingSpy();
			actual.resetParamArming();
		}
	};
});

import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { session, handleTrackSelectionUpdate } from '$lib/stores/session.svelte';
import { handleV3SelectedTrack } from '$lib/api/handlers/v3SelectedTrack';

/** Put the selection at `index` with nothing pending. */
function settleAt(index: number): void {
	selectedTrackStore.selectTrackLocally(index);
	handleTrackSelectionUpdate(index);
}

describe('selected track: one source of truth', () => {
	const changes: number[] = [];
	const onChange = (e: Event) => changes.push((e as CustomEvent).detail.trackIndex);
	let fxReset: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		settleAt(0);
		changes.length = 0;
		resetParamArmingSpy.mockClear();
		fxReset = vi.spyOn(fxGrid, 'resetForTrackChange');
		window.addEventListener('track-changed', onChange);
	});

	afterEach(() => {
		window.removeEventListener('track-changed', onChange);
		fxReset.mockRestore();
	});

	it('selectTrackLocally moves both readers at once', () => {
		selectedTrackStore.selectTrackLocally(3);
		expect(session.selectedTrackIndex).toBe(3);
		expect(selectedTrackStore.trackIndex).toBe(3);
		expect(selectedTrackStore.selectedTrackPath).toBe('tracks/3');
	});

	it('runs the track-change side effects once per real change', () => {
		selectedTrackStore.selectTrackLocally(5);
		// The confirming echo and a repeat are not changes.
		handleV3SelectedTrack(['tracks/5']);
		selectedTrackStore.selectTrackLocally(5);
		expect(changes).toEqual([5]);
		expect(fxReset).toHaveBeenCalledTimes(1);
		expect(resetParamArmingSpy).toHaveBeenCalledTimes(1);
	});

	it('a late echo for A after a quick A→B tap changes nothing', () => {
		selectedTrackStore.selectTrackLocally(1); // A
		selectedTrackStore.selectTrackLocally(2); // B
		changes.length = 0;
		fxReset.mockClear();
		resetParamArmingSpy.mockClear();

		handleV3SelectedTrack(['tracks/1']); // A's echo, late

		expect(selectedTrackStore.trackIndex).toBe(2);
		expect(session.selectedTrackIndex).toBe(2);
		expect(changes).toEqual([]);
		expect(fxReset).not.toHaveBeenCalled();
		expect(resetParamArmingSpy).not.toHaveBeenCalled();
	});

	it('the deprecated handleTrackSelected is a no-op after selectTrackOptimistically', () => {
		session.selectTrackOptimistically(4);
		selectedTrackStore.handleTrackSelected(4);
		expect(changes).toEqual([4]);
	});

	it('handles master selection (trackIndex === -1)', () => {
		selectedTrackStore.selectTrackLocally(-1);
		expect(selectedTrackStore.trackIndex).toBe(-1);
		expect(selectedTrackStore.selectedTrackPath).toBe('master');
	});

	it('a Live-initiated selection drives the store (end-to-end)', () => {
		handleV3SelectedTrack(['tracks/7']);
		expect(selectedTrackStore.trackIndex).toBe(7);
		expect(selectedTrackStore.selectedTrackPath).toBe('tracks/7');
		expect(changes).toEqual([7]);
	});
});
