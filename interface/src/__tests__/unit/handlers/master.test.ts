/**
 * vitest coverage for the PR-5b master metadata wire (`handleV3MasterMetadata`).
 *
 * Mirrors the structure of trackMetadata.test.ts but for the
 * five-attribute master family. Wire shape is flat — no trackPath
 * arg, just `[value]`. Receive-side dispatcher writes into the v3
 * normalized store via `applyMasterMetadata`; the master strip reads
 * those fields through `$derived` off `v3Store.tracks.get('master')`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import {
	handleV3MasterMetadata,
	isV3MasterMetadataAddress,
	V3_MASTER_COLOR_ADDRESS,
	V3_MASTER_MUTE_ADDRESS,
	V3_MASTER_NAME_ADDRESS,
	V3_MASTER_PAN_ADDRESS,
	V3_MASTER_VOLUME_ADDRESS
} from '$lib/api/handlers/v3MasterMetadata';
import {
	v3Store,
	_resetForTests,
	replaceTree,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { SvelteMap } from 'svelte/reactivity';

describe('isV3MasterMetadataAddress', () => {
	it('recognizes all 5 master addresses', () => {
		const addrs = [
			V3_MASTER_NAME_ADDRESS,
			V3_MASTER_COLOR_ADDRESS,
			V3_MASTER_VOLUME_ADDRESS,
			V3_MASTER_PAN_ADDRESS,
			V3_MASTER_MUTE_ADDRESS
		];
		for (const a of addrs) expect(isV3MasterMetadataAddress(a)).toBe(true);
	});

	it('rejects unrelated v3 addresses', () => {
		expect(isV3MasterMetadataAddress('/looping/v3/track/name')).toBe(false);
		expect(isV3MasterMetadataAddress('/looping/v3/master/devices/0')).toBe(false);
		expect(isV3MasterMetadataAddress('/tracks/master/volume')).toBe(false);
		expect(isV3MasterMetadataAddress('')).toBe(false);
	});
});

describe('handleV3MasterMetadata', () => {
	function seedMaster(): TrackRecord {
		return {
			trackPath: 'master',
			name: 'Master',
			color: 0xff8800,
			mute: false,
			solo: false,
			arm: false,
			hasMidiInput: false,
			hasAudioInput: true,
			hasArrangementClips: false,
			// ADR-410: plain top-level track (not a group, not folded, no parent).
			isFoldable: false,
			foldState: false,
			groupTrackIndex: -1,
			role: '',
			devices: new SvelteMap(),
			slots: new SvelteMap(),
			volume: 0.85,
			panning: 0
		};
	}

	beforeEach(() => {
		_resetForTests();
		// `replaceTree` keys by trackPath, so the seeded master record
		// lands at v3Store.tracks.get('master').
		replaceTree(1, [seedMaster()]);
	});

	it('writes name fires into TrackRecord.name on master', () => {
		handleV3MasterMetadata(V3_MASTER_NAME_ADDRESS, ['Renamed']);
		expect(v3Store.tracks.get('master')?.name).toBe('Renamed');
	});

	it('writes color with integer value', () => {
		handleV3MasterMetadata(V3_MASTER_COLOR_ADDRESS, [0x112233]);
		expect(v3Store.tracks.get('master')?.color).toBe(0x112233);
	});

	it('writes volume into the master-only volume field', () => {
		handleV3MasterMetadata(V3_MASTER_VOLUME_ADDRESS, [0.5]);
		expect(v3Store.tracks.get('master')?.volume).toBe(0.5);
	});

	it('maps /pan → TrackRecord.panning field (LOM attr name)', () => {
		handleV3MasterMetadata(V3_MASTER_PAN_ADDRESS, [-0.25]);
		expect(v3Store.tracks.get('master')?.panning).toBe(-0.25);
	});

	it('coerces mute 0/1 wire values to boolean on the record', () => {
		handleV3MasterMetadata(V3_MASTER_MUTE_ADDRESS, [1]);
		expect(v3Store.tracks.get('master')?.mute).toBe(true);
		handleV3MasterMetadata(V3_MASTER_MUTE_ADDRESS, [0]);
		expect(v3Store.tracks.get('master')?.mute).toBe(false);
	});

	it('routes each of the 5 addresses to the right TrackRecord field', () => {
		const cases: Array<[string, keyof TrackRecord, unknown, unknown]> = [
			[V3_MASTER_NAME_ADDRESS, 'name', 'Alpha', 'Alpha'],
			[V3_MASTER_COLOR_ADDRESS, 'color', 42, 42],
			[V3_MASTER_VOLUME_ADDRESS, 'volume', 0.7, 0.7],
			[V3_MASTER_PAN_ADDRESS, 'panning', 0.25, 0.25],
			[V3_MASTER_MUTE_ADDRESS, 'mute', 1, true]
		];
		for (const [addr, field, wire, expected] of cases) {
			handleV3MasterMetadata(addr, [wire as string | number]);
			expect(v3Store.tracks.get('master')?.[field]).toEqual(expected);
		}
	});

	it('drops silently when master record not in tree (benign race)', () => {
		_resetForTests();
		// No replaceTree → no master record.
		handleV3MasterMetadata(V3_MASTER_NAME_ADDRESS, ['x']);
		expect(v3Store.tracks.get('master')).toBeUndefined();
	});

	it('drops silently when args are too short', () => {
		const before = v3Store.tracks.get('master')?.name;
		handleV3MasterMetadata(V3_MASTER_NAME_ADDRESS, []);
		expect(v3Store.tracks.get('master')?.name).toBe(before);
	});

	it('drops silently for unknown address', () => {
		const before = v3Store.tracks.get('master')?.name;
		handleV3MasterMetadata('/looping/v3/master/bogus', ['x']);
		expect(v3Store.tracks.get('master')?.name).toBe(before);
	});

	it('re-insert preserves nested Map identity (ADR-003)', () => {
		const prev = v3Store.tracks.get('master');
		const prevDevices = prev?.devices;
		const prevSlots = prev?.slots;
		handleV3MasterMetadata(V3_MASTER_NAME_ADDRESS, ['Renamed']);
		const next = v3Store.tracks.get('master');
		expect(next?.devices).toBe(prevDevices);
		expect(next?.slots).toBe(prevSlots);
	});
});
