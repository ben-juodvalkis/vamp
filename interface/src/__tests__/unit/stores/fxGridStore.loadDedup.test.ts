/**
 * fxGridStore.loadDevice — duplicate-trigger de-dup.
 *
 * A slot can have several live consumers at once: the FX-grid control and
 * a central view. `VariationControl` mounts its central view on the *first*
 * drag frame (`setView` inside `onInteraction`), so mid-drag a second
 * consumer appears and starts driving the same slot.
 *
 * Regression (2026-07-29): each consumer used to own a private
 * `loadingInitiated` flag. The freshly-mounted view saw `isGhost` still
 * true (the load hadn't resolved yet), reset its own flag, and re-entered
 * `loadDevice` on later drag frames. That second call hit the `loading`
 * early-return, so the load was silently dropped and the preset never
 * appeared — while the drag's params still queued as pending. Dragging the
 * VAR slider therefore never loaded the Variation preset, though tapping
 * (no mid-drag remount) worked fine.
 *
 * The de-dup now lives solely in the slot's `loadState`, so repeated calls
 * from any number of consumers are a no-op instead of a lost load.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Module-scope mocks ------------------------------------------------

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/services/trackCommands', () => ({
	setTrackName: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
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

// Imports after the mocks so the real modules see the shims. See the
// sibling rename test for why both come from selectedTrackStore.
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { send } from '$lib/api/simpleClient';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import { replaceTree, _resetForTests, type TrackRecord } from '$lib/stores/v3/normalized.svelte';

const sendMock = vi.mocked(send);

function mkTrack(trackPath: string): TrackRecord {
	return {
		trackPath,
		name: trackPath,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: false,
		hasAudioInput: true,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new Map(),
		slots: new Map()
	};
}

/** The `/looping/v3/device/load` sends only, ignoring other traffic. */
function loadSends() {
	return sendMock.mock.calls.filter((c) => c[0] === '/looping/v3/device/load');
}

describe('fxGridStore.loadDevice — duplicate-trigger de-dup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		fxGrid.resetForTrackChange();
		replaceTree(1, [mkTrack('tracks/0')]);
		selectedTrackStore.handleTrackSelected(0);
	});

	afterEach(() => {
		// Drop the 10s load-timeout the final loadDevice armed.
		fxGrid.resetForTrackChange();
	});

	it('issues exactly one load when two consumers trigger the same ghost slot', async () => {
		// Consumer 1: the FX-grid control's first drag frame.
		// Consumer 2: the central view that just mounted mid-drag.
		await fxGrid.loadDevice('variation');
		await fxGrid.loadDevice('variation');
		await fxGrid.loadDevice('variation');

		const loads = loadSends();
		expect(loads).toHaveLength(1);
		expect(loads[0][1]).toEqual([
			'tracks/0',
			'',
			DEVICE_PRESETS.variation.presetPath
		]);
	});

	it('keeps the slot in `loading` after a duplicate trigger (load not dropped)', async () => {
		await fxGrid.loadDevice('variation');
		await fxGrid.loadDevice('variation');

		// The regression left the slot loading-but-never-sent; the guard must
		// leave a genuine in-flight load intact so checkLoadingCompletion can
		// still land the arriving device.
		expect(fxGrid.getSlot('variation').state).toBe('loading');
	});

	it('applies pending params from both consumers once the device arrives', async () => {
		// Mirrors the real gesture: the drag queues params through whichever
		// consumer is live at the time, across the ghost → loading handoff.
		fxGrid.storePendingParam('variation', 6, 7);
		await fxGrid.loadDevice('variation');
		fxGrid.storePendingParam('variation', 2, 5);
		await fxGrid.loadDevice('variation');

		expect(loadSends()).toHaveLength(1);

		const device = {
			devicePath: 'tracks/0/devices/0',
			className: DEVICE_PRESETS.variation.expectedClassName,
			name: DEVICE_PRESETS.variation.defaultName
		};
		fxGrid.checkLoadingCompletion(device as never);

		// Both queued params reach the now-real device.
		expect(fxGrid.getSlot('variation').pendingParams).toBeUndefined();
	});

	it('does not re-load a slot whose device is already present', async () => {
		const device = {
			devicePath: 'tracks/0/devices/0',
			className: DEVICE_PRESETS.variation.expectedClassName,
			name: DEVICE_PRESETS.variation.defaultName
		};
		replaceTree(1, [
			{ ...mkTrack('tracks/0'), devices: new Map([[device.devicePath, device as never]]) }
		]);
		selectedTrackStore.handleTrackSelected(0);

		// An active slot must never be flipped back to `loading` — that would
		// strand it until the 10s timeout.
		await fxGrid.loadDevice('variation');

		expect(loadSends()).toHaveLength(0);
		expect(fxGrid.getSlot('variation').state).toBe('active');
	});
});
