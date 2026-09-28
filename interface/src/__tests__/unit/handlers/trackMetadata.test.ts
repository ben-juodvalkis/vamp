/**
 * vitest coverage for the PR-5a wire / PR-5d-first UI reshape.
 *
 * Receive-side dispatcher (`handleV3TrackMetadata` +
 * `isV3TrackMetadataAddress`) — writes `/looping/v3/track/<attr>` fires
 * into the v3 normalized store via `applyTrackMetadata`. No CustomEvent
 * dispatch: TrackStrip reads the store directly via `$derived`.
 *
 * This file used to carry a second half asserting UI senders emitted on
 * the v3 address. Both of its subjects have since been deleted as dead
 * code — `trackOSCService` in ROW 7e, and `trackArming.armTrackWithRetry`
 * in audit item 33, which had no production caller at all. The address
 * itself is still live and still covered on the surface side.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

import {
	handleV3TrackMetadata,
	isV3TrackMetadataAddress,
	V3_TRACK_ARM_ADDRESS,
	V3_TRACK_COLOR_ADDRESS,
	V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS,
	V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS,
	V3_TRACK_MUTE_ADDRESS,
	V3_TRACK_NAME_ADDRESS,
	V3_TRACK_PAN_ADDRESS,
	V3_TRACK_ROLE_ADDRESS,
	V3_TRACK_SOLO_ADDRESS,
	V3_TRACK_VOLUME_ADDRESS
} from '$lib/api/handlers/v3TrackMetadata';
import { send } from '$lib/api/simpleClient';
import {
	v3Store,
	_resetForTests,
	replaceTree,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { SvelteMap } from 'svelte/reactivity';

// ---------------------------------------------------------------------
// receive-side dispatcher
// ---------------------------------------------------------------------

describe('isV3TrackMetadataAddress', () => {
	it('recognizes all 9 metadata addresses', () => {
		const addrs = [
			V3_TRACK_NAME_ADDRESS,
			V3_TRACK_COLOR_ADDRESS,
			V3_TRACK_ARM_ADDRESS,
			V3_TRACK_MUTE_ADDRESS,
			V3_TRACK_SOLO_ADDRESS,
			V3_TRACK_PAN_ADDRESS,
			V3_TRACK_VOLUME_ADDRESS,
			V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS,
			V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS
		];
		for (const a of addrs) expect(isV3TrackMetadataAddress(a)).toBe(true);
	});

	it('rejects unrelated v3 addresses', () => {
		expect(isV3TrackMetadataAddress('/looping/v3/param/value')).toBe(false);
		expect(isV3TrackMetadataAddress('/looping/v3/track/select')).toBe(false);
		expect(isV3TrackMetadataAddress('/live/track/set/name')).toBe(false);
		expect(isV3TrackMetadataAddress('')).toBe(false);
	});
});

describe('handleV3TrackMetadata', () => {
	function seedTrack(trackPath: string): TrackRecord {
		const rec: TrackRecord = {
			trackPath,
			name: 'seed',
			color: 0,
			mute: false,
			solo: false,
			arm: false,
			hasMidiInput: true,
			hasAudioInput: true,
			hasArrangementClips: false,
			// ADR-410: plain top-level track (not a group, not folded, no parent).
			isFoldable: false,
			foldState: false,
			groupTrackIndex: -1,
			// Protocol 3.7.0: no role recorded — the pre-3.7.0 shape, and
			// what every track made outside this app still carries.
			role: '',
			devices: new SvelteMap(),
			slots: new SvelteMap()
		};
		return rec;
	}

	beforeEach(() => {
		_resetForTests();
		replaceTree(1, [seedTrack('tracks/0'), seedTrack('tracks/2')]);
	});

	// --- protocol 3.7.0: the role echo ------------------------------------
	//
	// The surface writes the role into Live's per-track store and echoes
	// it here. Cold start rides the T record; this is the mid-session
	// update, and the path by which a SECOND client (the iPad) learns a
	// role the Mac just recorded.

	it('routes the role echo like any other track attr', () => {
		expect(isV3TrackMetadataAddress(V3_TRACK_ROLE_ADDRESS)).toBe(true);
	});

	it('applies the role echo to the store', () => {
		handleV3TrackMetadata(V3_TRACK_ROLE_ADDRESS, ['tracks/0', 'drum']);
		expect(v3Store.tracks.get('tracks/0')?.role).toBe('drum');
	});

	it('accepts an empty role as a clear', () => {
		handleV3TrackMetadata(V3_TRACK_ROLE_ADDRESS, ['tracks/0', 'drum']);
		handleV3TrackMetadata(V3_TRACK_ROLE_ADDRESS, ['tracks/0', '']);
		expect(v3Store.tracks.get('tracks/0')?.role).toBe('');
	});

	it('coerces a non-string role to a string', () => {
		// Tier 0 of the rail gate returns this value verbatim as the
		// answer, so a number arriving here becomes a role named `42`.
		handleV3TrackMetadata(V3_TRACK_ROLE_ADDRESS, ['tracks/0', 42]);
		expect(v3Store.tracks.get('tracks/0')?.role).toBe('42');
	});

	it('writes name fires into v3 store TrackRecord.name', () => {
		handleV3TrackMetadata(V3_TRACK_NAME_ADDRESS, ['tracks/2', 'Guitar']);
		expect(v3Store.tracks.get('tracks/2')?.name).toBe('Guitar');
		// Untouched tracks unchanged.
		expect(v3Store.tracks.get('tracks/0')?.name).toBe('seed');
	});

	it('writes color with integer value', () => {
		handleV3TrackMetadata(V3_TRACK_COLOR_ADDRESS, ['tracks/0', 0xff8800]);
		expect(v3Store.tracks.get('tracks/0')?.color).toBe(0xff8800);
	});

	it('maps /pan → TrackRecord.panning field (LOM attr name)', () => {
		handleV3TrackMetadata(V3_TRACK_PAN_ADDRESS, ['tracks/0', -0.5]);
		expect(v3Store.tracks.get('tracks/0')?.panning).toBe(-0.5);
	});

	it('coerces arm/mute/solo 0/1 wire values to boolean on the record', () => {
		handleV3TrackMetadata(V3_TRACK_ARM_ADDRESS, ['tracks/0', 1]);
		handleV3TrackMetadata(V3_TRACK_MUTE_ADDRESS, ['tracks/0', 0]);
		handleV3TrackMetadata(V3_TRACK_SOLO_ADDRESS, ['tracks/0', 1]);
		const t = v3Store.tracks.get('tracks/0');
		expect(t?.arm).toBe(true);
		expect(t?.mute).toBe(false);
		expect(t?.solo).toBe(true);
	});

	it('writes input_routing_type/_channel into the reserved optional fields', () => {
		handleV3TrackMetadata(V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS, [
			'tracks/0',
			'Ext. In'
		]);
		handleV3TrackMetadata(V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS, [
			'tracks/0',
			'1/2'
		]);
		const t = v3Store.tracks.get('tracks/0');
		expect(t?.inputRoutingType).toBe('Ext. In');
		expect(t?.inputRoutingChannel).toBe('1/2');
	});

	it('routes each of the 8 addresses to the right TrackRecord field', () => {
		const cases: Array<[string, keyof TrackRecord, unknown, unknown]> = [
			[V3_TRACK_NAME_ADDRESS, 'name', 'Alpha', 'Alpha'],
			[V3_TRACK_COLOR_ADDRESS, 'color', 42, 42],
			[V3_TRACK_ARM_ADDRESS, 'arm', 1, true],
			[V3_TRACK_MUTE_ADDRESS, 'mute', 1, true],
			[V3_TRACK_SOLO_ADDRESS, 'solo', 1, true],
			[V3_TRACK_PAN_ADDRESS, 'panning', 0.25, 0.25],
			[V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS, 'inputRoutingType', 'Ext. In', 'Ext. In'],
			[V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS, 'inputRoutingChannel', '1/2', '1/2']
		];
		for (const [addr, field, wire, expected] of cases) {
			handleV3TrackMetadata(addr, ['tracks/0', wire as string | number]);
			expect(v3Store.tracks.get('tracks/0')?.[field]).toEqual(expected);
		}
	});

	it('does not re-insert when path is master (PR-5b owns it)', () => {
		const sizeBefore = v3Store.tracks.size;
		handleV3TrackMetadata(V3_TRACK_NAME_ADDRESS, ['master', 'x']);
		expect(v3Store.tracks.size).toBe(sizeBefore);
		expect(v3Store.tracks.get('master')).toBeUndefined();
	});

	it('does not re-insert when path is returns (PR-5e owns it)', () => {
		handleV3TrackMetadata(V3_TRACK_NAME_ADDRESS, ['returns/0', 'x']);
		expect(v3Store.tracks.get('returns/0')).toBeUndefined();
	});

	it('drops silently for unknown trackPath (benign race)', () => {
		const before = v3Store.tracks.get('tracks/0');
		handleV3TrackMetadata(V3_TRACK_NAME_ADDRESS, ['tracks/99', 'x']);
		// Seeded tracks unchanged.
		expect(v3Store.tracks.get('tracks/0')).toBe(before);
		expect(v3Store.tracks.get('tracks/99')).toBeUndefined();
	});

	it('drops silently when args are too short', () => {
		const before = v3Store.tracks.get('tracks/0')?.name;
		handleV3TrackMetadata(V3_TRACK_NAME_ADDRESS, ['tracks/0']);
		expect(v3Store.tracks.get('tracks/0')?.name).toBe(before);
	});

	it('drops silently for unknown address', () => {
		const before = v3Store.tracks.get('tracks/0')?.name;
		handleV3TrackMetadata('/looping/v3/track/bogus', ['tracks/0', 'x']);
		expect(v3Store.tracks.get('tracks/0')?.name).toBe(before);
	});

	it('re-insert preserves nested Map identity (ADR-003)', () => {
		const prev = v3Store.tracks.get('tracks/0');
		const prevDevices = prev?.devices;
		const prevSlots = prev?.slots;
		handleV3TrackMetadata(V3_TRACK_NAME_ADDRESS, ['tracks/0', 'Renamed']);
		const next = v3Store.tracks.get('tracks/0');
		expect(next?.devices).toBe(prevDevices);
		expect(next?.slots).toBe(prevSlots);
	});
});

