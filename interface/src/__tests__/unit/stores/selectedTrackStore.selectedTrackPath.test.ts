/**
 * PR-3.5.2 tests — `selectedTrackStore` selected-track-path + v3
 * device list API.
 *
 * Covers the two new public members that migrate the `devices` +
 * track-identity capability off v2-populated state onto a `$derived`
 * over `v3Store`:
 *
 * - `selectedTrackPath: string` — canonical trackPath for the current
 *   selection. `tracks/<N>` for normal tracks, `master` for
 *   `_trackIndex === -1`. UI-owned; sourced from the v2 selection
 *   pipeline today (per PR-3.5.0 gap-table row 4).
 * - `devicesByPath: DeviceRecord[]` — `$derived` over
 *   `v3Store.tracks.get(selectedTrackPath).devices`. No v2 fallback,
 *   returns `[]` on cold start. Indexing mirrors LOM chain order.
 *
 * The deprecated `devices` getter still exists at this PR boundary
 * (it's deleted in PR-4a once all callsites migrate in PR-3.5.2a..n).
 *
 * @see Looping's documentation/archive/m4l-to-python-v3/05-migration-plan.md §3.5
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

// Imports after the mocks so the real modules see the shims.
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord
} from '$lib/stores/v3/normalized.svelte';
import type { Device } from '$lib/types/device';

// ------------------------------------------------------------------
// Fixture helpers
// ------------------------------------------------------------------

/** Build a minimal TrackRecord with `deviceCount` devices in chain
 *  order. Each device carries zero params — not under test here. */
function mkTrackWithDevices(
	trackPath: string,
	deviceCount: number
): TrackRecord {
	const devices = new Map<string, DeviceRecord>();
	for (let i = 0; i < deviceCount; i++) {
		const devicePath = `${trackPath}/devices/${i}`;
		devices.set(devicePath, {
			devicePath,
			name: `d${i}`,
			className: `Class${i}`,
			params: new Map(),
			properties: new Map()
		});
	}
	return {
		trackPath,
		name: trackPath,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		// PR-3.5.3 — default fixture to MIDI-only. Tests that need a
		// specific I/O shape build their own TrackRecord directly.
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices,
		slots: new Map()
	};
}

// Drive the singleton store's `_trackIndex` via the supported public
// entry point. closeout-2 (2026-04-17): handleDeviceList is gone;
// track selection now rides on handleTrackSelected (shipped by
// closeout-0a).
function setSelectedTrack(trackIndex: number, _devices: Device[]): void {
	selectedTrackStore.handleTrackSelected(trackIndex);
}

// ------------------------------------------------------------------
// Suite
// ------------------------------------------------------------------

describe('selectedTrackStore selectedTrackPath (PR-3.5.2)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		// Reset selected-track state to track 0 via the narrow setter
		// shipped by closeout-0a. No-op when the singleton is already
		// at 0, otherwise drives the state back to the default before
		// the next test runs.
		selectedTrackStore.handleTrackSelected(0);
	});

	describe('selectedTrackPath', () => {
		it('returns tracks/<N> for a normal track index', () => {
			setSelectedTrack(3, []);
			expect(selectedTrackStore.selectedTrackPath).toBe('tracks/3');
		});

		it('returns tracks/0 by default (store defaults _trackIndex to 0)', () => {
			// beforeEach already set track 0 via handleDeviceList, but
			// make the expectation explicit here so this test stands
			// alone when reading the file top-to-bottom.
			setSelectedTrack(0, []);
			expect(selectedTrackStore.selectedTrackPath).toBe('tracks/0');
		});

		it('returns master for trackIndex === -1', () => {
			setSelectedTrack(-1, []);
			expect(selectedTrackStore.selectedTrackPath).toBe('master');
		});

		it('updates reactively when the selection handler fires', () => {
			setSelectedTrack(2, []);
			expect(selectedTrackStore.selectedTrackPath).toBe('tracks/2');

			setSelectedTrack(7, []);
			expect(selectedTrackStore.selectedTrackPath).toBe('tracks/7');

			setSelectedTrack(-1, []);
			expect(selectedTrackStore.selectedTrackPath).toBe('master');
		});
	});

	describe('devicesByPath', () => {
		it('returns [] when v3Store has no tree yet (cold start)', () => {
			// No replaceTree call — v3Store.tracks is empty.
			setSelectedTrack(0, []);
			expect(selectedTrackStore.devicesByPath).toEqual([]);
		});

		it('returns [] when the selected track is not in the v3 tree', () => {
			// Tree has tracks/0 only; selection points at tracks/5.
			replaceTree(1, [mkTrackWithDevices('tracks/0', 2)]);
			setSelectedTrack(5, []);
			expect(selectedTrackStore.devicesByPath).toEqual([]);
		});

		it('returns the v3 devices for the selected track in LOM order', () => {
			replaceTree(1, [mkTrackWithDevices('tracks/3', 3)]);
			setSelectedTrack(3, []);

			const got = selectedTrackStore.devicesByPath;
			expect(got).toHaveLength(3);
			expect(got[0].devicePath).toBe('tracks/3/devices/0');
			expect(got[1].devicePath).toBe('tracks/3/devices/1');
			expect(got[2].devicePath).toBe('tracks/3/devices/2');
		});

		it('exposes DeviceRecord shape (no v2 .id / .index)', () => {
			replaceTree(1, [mkTrackWithDevices('tracks/0', 1)]);
			setSelectedTrack(0, []);

			const device = selectedTrackStore.devicesByPath[0];
			expect(device).toBeDefined();
			expect(device.devicePath).toBe('tracks/0/devices/0');
			expect(device.name).toBe('d0');
			expect(device.className).toBe('Class0');
			expect(device.params).toBeInstanceOf(Map);
			// v2 Device fields are NOT on a DeviceRecord. `legacyId` was
			// a transitional 4th D-record field (closeout-0b) retired
			// in ROW 5 (2026-04-21, protocol 3.3.0); left off the
			// record entirely.
			expect((device as unknown as Device).id).toBeUndefined();
			expect((device as unknown as Device).index).toBeUndefined();
		});

		it('updates when the selection switches to a different v3-populated track', () => {
			replaceTree(1, [
				mkTrackWithDevices('tracks/0', 1),
				mkTrackWithDevices('tracks/1', 4)
			]);

			setSelectedTrack(0, []);
			expect(selectedTrackStore.devicesByPath).toHaveLength(1);

			setSelectedTrack(1, []);
			expect(selectedTrackStore.devicesByPath).toHaveLength(4);
		});

		it('resolves master when trackIndex === -1', () => {
			replaceTree(1, [mkTrackWithDevices('master', 2)]);
			setSelectedTrack(-1, []);

			const got = selectedTrackStore.devicesByPath;
			expect(got).toHaveLength(2);
			expect(got[0].devicePath).toBe('master/devices/0');
			expect(got[1].devicePath).toBe('master/devices/1');
		});

		it('picks up devices appearing in v3 after a replaceTree', () => {
			setSelectedTrack(2, []);
			expect(selectedTrackStore.devicesByPath).toEqual([]);

			replaceTree(5, [mkTrackWithDevices('tracks/2', 2)]);
			expect(selectedTrackStore.devicesByPath).toHaveLength(2);
			expect(selectedTrackStore.devicesByPath[0].devicePath).toBe(
				'tracks/2/devices/0'
			);
		});

		it('picks up device removal via a narrower replaceTree', () => {
			replaceTree(1, [mkTrackWithDevices('tracks/0', 3)]);
			setSelectedTrack(0, []);
			expect(selectedTrackStore.devicesByPath).toHaveLength(3);

			// Surface republishes the tree with fewer devices on tracks/0.
			replaceTree(2, [mkTrackWithDevices('tracks/0', 1)]);
			expect(selectedTrackStore.devicesByPath).toHaveLength(1);
		});
	});

	// ----------------------------------------------------------------
	// PR-3.5.2a — `paramPath(DeviceRecord, paramIndex)` overload
	// ----------------------------------------------------------------
	//
	// Prerequisite for the PR-3.5.2a..n consumer drain: migrated
	// callsites hold a `DeviceRecord` (from `devicesByPath`) and need
	// to thread it into `paramPath()` without reopening the v2 Device
	// lookup. The overload composes against `DeviceRecord.devicePath`,
	// so the trackRef encoded in the path is authoritative — master /
	// returns / tracks all land correctly without consulting
	// `_trackIndex`.
	describe('paramPath(DeviceRecord)', () => {
		it('composes against DeviceRecord.devicePath for a tracks path', () => {
			const track = mkTrackWithDevices('tracks/5', 1);
			const device = Array.from(track.devices.values())[0];

			expect(selectedTrackStore.paramPath(device, 3)).toBe(
				'tracks/5/devices/0/params/3'
			);
		});

		it('composes against DeviceRecord.devicePath for master', () => {
			const track = mkTrackWithDevices('master', 2);
			const device = Array.from(track.devices.values())[1];

			expect(selectedTrackStore.paramPath(device, 11)).toBe(
				'master/devices/1/params/11'
			);
		});

		it('ignores _trackIndex — DeviceRecord.devicePath is authoritative', () => {
			// Selection points at track 9, but we pass a DeviceRecord
			// minted against tracks/2. The returned path must honor the
			// record, not the selected track. This is the contract
			// migrated consumers rely on when the UI selection and the
			// device under control diverge.
			setSelectedTrack(9, []);
			const track = mkTrackWithDevices('tracks/2', 1);
			const device = Array.from(track.devices.values())[0];

			expect(selectedTrackStore.paramPath(device, 0)).toBe(
				'tracks/2/devices/0/params/0'
			);
		});

		it('composes identical paths to the pre-built string overload', () => {
			// Equivalence property: a DeviceRecord whose devicePath is X
			// and the string overload for X must agree. This is what
			// lets migration swap `paramPath(v2Device, N)` for
			// `paramPath(deviceRecord, N)` without relitigating every
			// caller's trackRef assumption.
			const track = mkTrackWithDevices('tracks/7', 1);
			const device = Array.from(track.devices.values())[0];

			expect(selectedTrackStore.paramPath(device, 42)).toBe(
				selectedTrackStore.paramPath('tracks/7/devices/0', 42)
			);
		});

		it('still accepts a v2 Device (overload preserved)', () => {
			// Drain is incremental — the v2 Device overload stays until
			// the last .devices consumer migrates. Smoke-test that the
			// DeviceRecord addition didn't break the old signature.
			setSelectedTrack(3, []);
			const v2Device: Device = {
				id: 42,
				index: 2,
				name: 'Filter',
				className: 'AutoFilter'
			};
			expect(selectedTrackStore.paramPath(v2Device, 7)).toBe(
				'tracks/3/devices/2/params/7'
			);
		});
	});

	// ----------------------------------------------------------------
	// PR-3.5.3 — trackType derives from v3Store.tracks
	// ----------------------------------------------------------------
	describe('trackType (PR-3.5.3)', () => {
		// Build a minimal TrackRecord directly; the helper above defaults
		// to MIDI-only and we want to exercise every I/O combination here.
		function mkTrackWithIO(
			trackPath: string,
			hasMidiInput: boolean,
			hasAudioInput: boolean
		): TrackRecord {
			return {
				trackPath,
				name: trackPath,
				color: 0,
				mute: false,
				solo: false,
				arm: false,
				hasMidiInput,
				hasAudioInput,
				hasArrangementClips: false,
				// ADR-410: plain top-level track (not a group, not folded, no parent).
				isFoldable: false,
				foldState: false,
				groupTrackIndex: -1,
				role: '',
				devices: new Map(),
				slots: new Map()
			};
		}

		it('returns null on cold start (v3 tree empty)', () => {
			// _resetForTests in beforeEach clears the tree.
			setSelectedTrack(0, []);
			expect(selectedTrackStore.trackType).toBeNull();
		});

		it('returns null when the selected track is not in the v3 tree', () => {
			replaceTree(1, [mkTrackWithIO('tracks/0', true, false)]);
			setSelectedTrack(5, []);
			expect(selectedTrackStore.trackType).toBeNull();
		});

		it('returns "midi" for a MIDI-only track', () => {
			replaceTree(1, [mkTrackWithIO('tracks/0', true, false)]);
			setSelectedTrack(0, []);
			expect(selectedTrackStore.trackType).toBe('midi');
		});

		it('returns "audio" for an audio-only track', () => {
			replaceTree(1, [mkTrackWithIO('tracks/0', false, true)]);
			setSelectedTrack(0, []);
			expect(selectedTrackStore.trackType).toBe('audio');
		});

		it('returns "midi" for an External Instrument track (both flags true)', () => {
			// The doctrine: wire carries raw LOM bits (both 1); UI
			// classification treats hasMidiInput as dominant for view
			// routing — a track that can host an instrument is MIDI.
			replaceTree(1, [mkTrackWithIO('tracks/0', true, true)]);
			setSelectedTrack(0, []);
			expect(selectedTrackStore.trackType).toBe('midi');
		});

		it('returns null for a track with neither flag (e.g. group/master fallback)', () => {
			replaceTree(1, [mkTrackWithIO('tracks/0', false, false)]);
			setSelectedTrack(0, []);
			expect(selectedTrackStore.trackType).toBeNull();
		});

		it('reads master when trackIndex === -1 — LOM reports has_audio_input=true', () => {
			// Live's master track sums audio, so the LOM exposes
			// has_audio_input=True (verified live 2026-04-16). trackType
			// reports the raw classification ("audio"); view routing
			// treats master specially in the central-display coordinator
			// independent of trackType, so a master-specific FX grid +
			// central view still render correctly.
			replaceTree(1, [mkTrackWithIO('master', false, true)]);
			setSelectedTrack(-1, []);
			expect(selectedTrackStore.trackType).toBe('audio');
		});

		it('returns null when master has neither flag (defensive — synthesized fixture)', () => {
			// Defensive case for the rare LOM configuration where a
			// "master-like" track exposes no I/O flags. Real Live master
			// reports has_audio_input=true (see prior test); this case is
			// kept to prove the null branch still works.
			replaceTree(1, [mkTrackWithIO('master', false, false)]);
			setSelectedTrack(-1, []);
			expect(selectedTrackStore.trackType).toBeNull();
		});

		it('updates reactively when selection switches between tracks of different types', () => {
			replaceTree(1, [
				mkTrackWithIO('tracks/0', true, false),  // MIDI
				mkTrackWithIO('tracks/1', false, true),  // audio
				mkTrackWithIO('tracks/2', true, true)    // External Instrument
			]);

			setSelectedTrack(0, []);
			expect(selectedTrackStore.trackType).toBe('midi');

			setSelectedTrack(1, []);
			expect(selectedTrackStore.trackType).toBe('audio');

			setSelectedTrack(2, []);
			expect(selectedTrackStore.trackType).toBe('midi');
		});
	});
});
