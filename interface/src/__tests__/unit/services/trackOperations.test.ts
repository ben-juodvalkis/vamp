/**
 * trackOperations.test.ts — the Dup Trk (variation track) orchestration.
 *
 * The interesting part is what the UI is allowed to believe about
 * `tracks/<N+1>` immediately after a duplicate. A duplicate re-indexes
 * every track below the source, so until the next `state/full` the record
 * at that path still describes the DISPLACED neighbour — a record that
 * answers instantly and usually carries a Permute of its own. Reading the
 * copy's chain off it aimed the Permute reset at whatever device happened
 * to occupy that chain index.
 *
 * Emptying the clips is no longer here at all: it rides the duplicate
 * itself (`clear_clips`), server-side, where the copy is in hand. These
 * tests pin the flag and the freshness gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn(),
	sendClipDelete: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('$lib/stores/v6/sequencerStore.svelte', () => ({
	resetParamsToDefaultsForDevice: vi.fn()
}));

import { send } from '$lib/api/simpleClient';
import { resetParamsToDefaultsForDevice } from '$lib/stores/v6/sequencerStore.svelte';
import { duplicateTrackAndReset } from '$lib/services/trackOperations';
import { dispatchOscMessage, resetOscMessageBusForTests } from '$lib/api/connection/oscMessageBus';
import {
	replaceTree,
	type DeviceRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';

const sendMock = send as unknown as ReturnType<typeof vi.fn>;
const resetMock = resetParamsToDefaultsForDevice as unknown as ReturnType<typeof vi.fn>;

function mkDevice(trackIdx: number, deviceIdx: number, name: string): DeviceRecord {
	return {
		devicePath: `tracks/${trackIdx}/devices/${deviceIdx}`,
		name,
		className: name,
		params: new SvelteMap(),
		properties: new SvelteMap()
	};
}

function mkTrack(trackIdx: number, deviceNames: string[]): TrackRecord {
	const devices = deviceNames.map((n, i) => mkDevice(trackIdx, i, n));
	return {
		trackPath: `tracks/${trackIdx}`,
		name: `T${trackIdx}`,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		volume: 0.5,
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])),
		slots: new SvelteMap()
	};
}

/** Answer the duplicate request currently in flight with an ack. */
function ackDuplicate(newTrackPath: string) {
	const call = sendMock.mock.calls.find(
		(c) => c[0] === '/looping/v3/track/duplicate'
	);
	if (!call) throw new Error('no duplicate sent');
	const requestId = call[1][0];
	dispatchOscMessage({
		address: '/looping/v3/track/duplicate/ack',
		args: [requestId, newTrackPath]
	});
}

/** Let pending promises and one poll interval run. */
async function tick(ms = 60) {
	await vi.advanceTimersByTimeAsync(ms);
}

describe('duplicateTrackAndReset', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		resetOscMessageBusForTests();
	});

	afterEach(() => {
		vi.useRealTimers();
		resetOscMessageBusForTests();
	});

	it('asks the surface to clear every clip on the copy', async () => {
		replaceTree(1, [mkTrack(0, ['Instrument', 'Permute'])]);

		const pending = duplicateTrackAndReset('tracks/0');
		await tick(0);
		ackDuplicate('tracks/1');
		// The post-duplicate tree lands: two tracks now.
		replaceTree(2, [
			mkTrack(0, ['Instrument', 'Permute']),
			mkTrack(1, ['Instrument', 'Permute'])
		]);
		await tick();
		await pending;

		const call = sendMock.mock.calls.find(
			(c) => c[0] === '/looping/v3/track/duplicate'
		);
		// [request_id, source_track_path, clear_clips]
		expect(call?.[1][1]).toBe('tracks/0');
		expect(call?.[1][2]).toBe(1);
	});

	it('waits for the tree to grow before reading the new track Permute', async () => {
		// Source is track 0; tracks/1 ALREADY exists (the neighbour the
		// duplicate is about to push down to tracks/2) and its chain puts
		// Permute at a different index than the copy will have.
		replaceTree(1, [
			mkTrack(0, ['Instrument', 'Permute']),
			mkTrack(1, ['Permute', 'Instrument', 'Reverb'])
		]);

		const pending = duplicateTrackAndReset('tracks/0');
		await tick(0);
		ackDuplicate('tracks/1');

		// Stale window: the store still holds the pre-duplicate tree. The
		// neighbour's record is sitting right there at tracks/1 with a
		// Permute — nothing may be reset off it.
		await tick(200);
		expect(resetMock).not.toHaveBeenCalled();

		// The post-duplicate state/full lands: three tracks, the copy at 1.
		replaceTree(2, [
			mkTrack(0, ['Instrument', 'Permute']),
			mkTrack(1, ['Instrument', 'Permute']),
			mkTrack(2, ['Permute', 'Instrument', 'Reverb'])
		]);
		await tick();
		await pending;

		expect(resetMock).toHaveBeenCalledWith('tracks/1/devices/1');
	});

	it('gives up the Permute reset rather than resetting a stale one', async () => {
		replaceTree(1, [
			mkTrack(0, ['Instrument', 'Permute']),
			mkTrack(1, ['Permute', 'Instrument'])
		]);

		const pending = duplicateTrackAndReset('tracks/0');
		await tick(0);
		ackDuplicate('tracks/1');
		// Tree never grows — the echo is lost. Poll ceiling is 3s.
		await tick(3500);
		const result = await pending;

		expect(result.newTrackPath).toBe('tracks/1');
		expect(resetMock).not.toHaveBeenCalled();
	});
});
