/**
 * trackCommands.test.ts — UI-write commands with optimistic store apply.
 *
 * Each command must do BOTH things atomically:
 * 1. Apply the value to the v3 store (optimistic — UI reads the store
 *    immediately, no waiting for surface listener echo).
 * 2. Emit the matching OSC address.
 *
 * The pair is load-bearing for the UI: the surface echo-suppresses
 * one fire per UI-initiated write, so without the local apply the
 * store would stay at the load-time value forever. See ADR-358.
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

import { send } from '$lib/api/simpleClient';
import {
	setMasterVolume,
	setTrackMute,
	setTrackName,
	setTrackSolo,
	setTrackVolume,
	setTrackVolumeByIndex,
	setTrackFoldState
} from '$lib/services/trackCommands';
import {
	applyMasterMetadata,
	applyTrackMetadata,
	replaceTree,
	v3Store
} from '$lib/stores/v3/normalized.svelte';

const sendMock = send as unknown as ReturnType<typeof vi.fn>;

function makeTrackRecord(
	trackPath: string,
	overrides: {
		name?: string;
		volume?: number;
		color?: number;
		isFoldable?: boolean;
		foldState?: boolean;
	} = {}
) {
	return {
		trackPath,
		name: overrides.name ?? trackPath,
		color: overrides.color ?? 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: trackPath !== 'master',
		hasAudioInput: false,
		hasArrangementClips: false,
		// ADR-410 — plain top-level track unless a group test says otherwise.
		isFoldable: overrides.isFoldable ?? false,
		foldState: overrides.foldState ?? false,
		groupTrackIndex: -1,
		role: '',
		panning: 0,
		volume: overrides.volume ?? 0.5,
		devices: new Map(),
		slots: new Map()
	};
}

function seedTracks(): void {
	// Seed the store with a master + two regular tracks so apply* succeeds.
	// `replaceTree` is the structural reset that state/full uses; it gives
	// us a clean tree without depending on handshake.
	replaceTree(1, [
		makeTrackRecord('master', { name: 'Main', volume: 0.85, color: 0xff8800 }),
		makeTrackRecord('tracks/0', { name: 'T0', volume: 0.5 }),
		makeTrackRecord('tracks/1', { name: 'T1', volume: 0.04 })
	]);
}

describe('trackCommands.setTrackVolume', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedTracks();
	});

	it('applies the value to the v3 store before sending OSC', () => {
		setTrackVolume('tracks/1', 0.75);

		// Store updated.
		expect(v3Store.tracks.get('tracks/1')?.volume).toBeCloseTo(0.75);

		// OSC emitted with the matching wire shape.
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/volume', [
			'tracks/1',
			0.75
		]);
	});

	it('emits one OSC send per call (no double-fire)', () => {
		setTrackVolume('tracks/0', 0.3);
		expect(sendMock).toHaveBeenCalledTimes(1);
	});

	it('survives rapid drag-shaped sequences without losing intermediate values', () => {
		// Simulates a drag: 5 writes in quick succession.
		const values = [0.1, 0.25, 0.4, 0.6, 0.8];
		for (const v of values) setTrackVolume('tracks/0', v);

		// Final store value matches the last write.
		expect(v3Store.tracks.get('tracks/0')?.volume).toBeCloseTo(0.8);
		// Every write hit the wire.
		expect(sendMock).toHaveBeenCalledTimes(values.length);
		expect(sendMock).toHaveBeenLastCalledWith('/looping/v3/track/volume', [
			'tracks/0',
			0.8
		]);
	});

	it('drops silently on a master path (use setMasterVolume instead)', () => {
		setTrackVolume('master', 0.5);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it('drops silently on a returns path', () => {
		setTrackVolume('returns/0', 0.5);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("emits even when the store doesn't know the path (apply is best-effort)", () => {
		// applyTrackMetadata returns false and logs at debug for unknown
		// paths, but the wire send still fires. The surface owns path
		// resolution and rejects with path-not-found if needed.
		setTrackVolume('tracks/99', 0.5);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/volume', [
			'tracks/99',
			0.5
		]);
	});
});

describe('trackCommands.setTrackVolumeByIndex', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedTracks();
	});

	it('builds tracks/<N> from the index and forwards', () => {
		setTrackVolumeByIndex(1, 0.42);
		expect(v3Store.tracks.get('tracks/1')?.volume).toBeCloseTo(0.42);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/volume', [
			'tracks/1',
			0.42
		]);
	});

	it('drops silently on a negative trackIndex', () => {
		setTrackVolumeByIndex(-1, 0.5);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it('drops silently on a non-integer trackIndex', () => {
		setTrackVolumeByIndex(1.5, 0.5);
		expect(sendMock).not.toHaveBeenCalled();
	});
});

describe('trackCommands.setMasterVolume', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedTracks();
	});

	it('applies the value to the master record before sending OSC', () => {
		setMasterVolume(0.6);

		expect(v3Store.tracks.get('master')?.volume).toBeCloseTo(0.6);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/master/volume', [0.6]);
	});

	it('uses the master wire shape (no trackPath arg)', () => {
		setMasterVolume(0.42);

		// Crucially: master rides /looping/v3/master/volume with a single
		// numeric arg, not the regular-track shape.
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/master/volume', [0.42]);
	});

	it('survives rapid drag-shaped sequences', () => {
		const values = [0.1, 0.3, 0.5, 0.7];
		for (const v of values) setMasterVolume(v);

		expect(v3Store.tracks.get('master')?.volume).toBeCloseTo(0.7);
		expect(sendMock).toHaveBeenCalledTimes(values.length);
	});
});

describe('snap-back regression (issue #399 follow-up)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedTracks();
	});

	it('store reflects the dragged value WITHOUT any inbound echo', () => {
		// Pre-condition: store has the load-time volume.
		expect(v3Store.tracks.get('tracks/1')?.volume).toBeCloseTo(0.04);

		// Simulate a drag: the user moves the slider to 0.85. No echo
		// from the surface arrives (echo-suppression is single-shot).
		setTrackVolume('tracks/1', 0.85);

		// Store must read 0.85 — without the optimistic apply, the slider
		// would snap back to 0.04 once the per-component optimistic state
		// cleared (or with the new design, the slider would render 0.04
		// directly because there's no parallel optimistic state).
		expect(v3Store.tracks.get('tracks/1')?.volume).toBeCloseTo(0.85);
	});

	it("an outside edit's echo still wins (reconciliation)", () => {
		// User drags to 0.5 — store reflects it.
		setTrackVolume('tracks/0', 0.5);
		expect(v3Store.tracks.get('tracks/0')?.volume).toBeCloseTo(0.5);

		// Live engineer turns the LOM fader to 0.9. Surface emits an
		// outside-edit echo (NOT suppressed — only UI-initiated writes
		// arm suppression). The echo lands via applyTrackMetadata.
		applyTrackMetadata('tracks/0', 'volume', 0.9);

		// Store reconciles to LOM truth.
		expect(v3Store.tracks.get('tracks/0')?.volume).toBeCloseTo(0.9);
	});

	it('mute toggle reflects in store immediately (no waiting for echo)', () => {
		expect(v3Store.tracks.get('tracks/0')?.mute).toBe(false);

		// Toggle mute — same shape that useTrackData.handleMuteToggle uses.
		setTrackMute('tracks/0', true);

		// Store mirrors the new value before any echo arrives.
		expect(v3Store.tracks.get('tracks/0')?.mute).toBe(true);
	});

	it('solo toggle reflects in store immediately (no waiting for echo)', () => {
		setTrackSolo('tracks/1', true);
		expect(v3Store.tracks.get('tracks/1')?.solo).toBe(true);
	});

	it('rename reflects in store immediately', () => {
		setTrackName('tracks/0', 'Renamed');
		expect(v3Store.tracks.get('tracks/0')?.name).toBe('Renamed');
	});
});

describe('trackCommands.setTrackName', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedTracks();
	});

	it('applies + sends with the regular wire shape', () => {
		setTrackName('tracks/1', 'Bass');
		expect(v3Store.tracks.get('tracks/1')?.name).toBe('Bass');
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/name', [
			'tracks/1',
			'Bass'
		]);
	});

	it('drops silently on a master path', () => {
		// Master rename isn't supported on the wire (path-not-supported);
		// we filter at the command boundary so we don't pollute the store
		// with a master-name write that the surface will reject anyway.
		setTrackName('master', 'Renamed Master');
		expect(sendMock).not.toHaveBeenCalled();
	});
});

describe('trackCommands.setTrackMute', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedTracks();
	});

	it('applies boolean to store and sends 0/1 on wire', () => {
		setTrackMute('tracks/0', true);
		expect(v3Store.tracks.get('tracks/0')?.mute).toBe(true);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/mute', [
			'tracks/0',
			1
		]);

		sendMock.mockClear();
		setTrackMute('tracks/0', false);
		expect(v3Store.tracks.get('tracks/0')?.mute).toBe(false);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/mute', [
			'tracks/0',
			0
		]);
	});

	it('drops silently on a master path', () => {
		setTrackMute('master', true);
		expect(sendMock).not.toHaveBeenCalled();
	});
});

describe('trackCommands.setTrackSolo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedTracks();
	});

	it('applies boolean to store and sends 0/1 on wire', () => {
		setTrackSolo('tracks/1', true);
		expect(v3Store.tracks.get('tracks/1')?.solo).toBe(true);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/solo', [
			'tracks/1',
			1
		]);
	});

	it('drops silently on a master path', () => {
		setTrackSolo('master', true);
		expect(sendMock).not.toHaveBeenCalled();
	});
});

describe('trackCommands.setTrackFoldState (ADR-410)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// tracks/0 is a Group Track; tracks/1 is a plain track.
		replaceTree(1, [
			makeTrackRecord('master', { name: 'Main' }),
			makeTrackRecord('tracks/0', { name: 'G', isFoldable: true }),
			makeTrackRecord('tracks/1', { name: 'T1' })
		]);
	});

	it('applies optimistically and sends the fold write', () => {
		// Optimism matters more here than for other writes: folding hides
		// every descendant strip, so a round-trip wait would show a lag
		// between tapping the triangle and the row closing.
		setTrackFoldState('tracks/0', true);
		expect(v3Store.tracks.get('tracks/0')?.foldState).toBe(true);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/set/fold_state', [
			'tracks/0',
			1
		]);
	});

	it('unfolds with flag 0', () => {
		setTrackFoldState('tracks/0', true);
		sendMock.mockClear();
		setTrackFoldState('tracks/0', false);
		expect(v3Store.tracks.get('tracks/0')?.foldState).toBe(false);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/set/fold_state', [
			'tracks/0',
			0
		]);
	});

	it('drops silently on a master path', () => {
		setTrackFoldState('master', true);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it('leaves the other track records untouched', () => {
		setTrackFoldState('tracks/0', true);
		expect(v3Store.tracks.get('tracks/1')?.foldState).toBe(false);
	});
});
