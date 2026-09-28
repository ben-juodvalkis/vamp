/**
 * PR-3.5.1 tests — `selectedTrackStore` path-keyed parameter API.
 *
 * Covers the three new public methods that replace the deprecated
 * `(deviceId, paramIndex)` surface:
 *
 * - `paramValue(paramPath)` — reads directly from
 *   `v3Store.paramByPath`; no v2 fallback.
 * - `setParamValue(paramPath, value)` — emits
 *   `/looping/v3/param/set [paramPath, value, generation]` directly;
 *   drops silently when `generation` is still UNSET.
 * - `paramPath(deviceOrPath, paramIndex)` — composes the canonical
 *   `<trackPath>/devices/<N>/params/<N>` shape, accepting either a
 *   `Device` record (composes against the selected track) or a
 *   pre-built `devicePath` string.
 *
 * The deprecated `getParameterValue` / `setParameter` methods still
 * exist at this PR boundary (they're deleted in PR-4a); those are
 * covered by `deviceParameterStorageV3.test.ts` and are not
 * re-tested here.
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
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { send } from '$lib/api/simpleClient';
import {
	replaceTree,
	_resetForTests,
	v3Store,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import type { Device } from '$lib/types/device';
import type { OSCArg } from '$lib/types/osc';

// ------------------------------------------------------------------
// Fixture helpers
// ------------------------------------------------------------------

function mkTrack(
	trackIdx: number,
	deviceIdx: number,
	paramIdx: number,
	value = 0.5
): TrackRecord {
	const trackPath = `tracks/${trackIdx}`;
	const devicePath = `${trackPath}/devices/${deviceIdx}`;
	const paramPath = `${devicePath}/params/${paramIdx}`;
	return {
		trackPath,
		name: `t${trackIdx}`,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		// PR-3.5.3 — default fixture to MIDI-only.
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		// ADR-002 (2026-04-16): SvelteMap, not plain Map. `applyParamValue`
		// mutates via `params.set(path, ...)` and relies on SvelteMap's
		// reactive `.set()` signal to fire `$derived` consumers (in real
		// components and in the paramByPath derived view this test
		// observes through `paramValue`). A plain-Map fixture worked
		// pre-ADR-002 only because the old code mutated `param.value` on
		// the POJO in place and the test read the same record by
		// reference — that was the bug the snap-back fix was hunting.
		devices: new SvelteMap([
			[
				devicePath,
				{
					devicePath,
					name: `d${deviceIdx}`,
					className: 'AudioEffect',
					params: new SvelteMap([
						[
							paramPath,
							{
								paramPath,
								name: `p${paramIdx}`,
								displayName: `P${paramIdx}`,
								min: 0,
								max: 1,
								value,
								unit: ''
							}
						]
					]),
					properties: new SvelteMap()
				}
			]
		]),
		slots: new SvelteMap()
	};
}

// Sync the singleton store's selected track to a known index via
// the narrow setter shipped by closeout-0a.
// closeout-2 (2026-04-17): handleDeviceList is gone; the v2 `devices`
// arg is dropped on the floor.
function setSelectedTrack(trackIndex: number, _devices: Device[]): void {
	selectedTrackStore.handleTrackSelected(trackIndex);
}

// ------------------------------------------------------------------
// Suite
// ------------------------------------------------------------------

describe('selectedTrackStore path-keyed API (PR-3.5.1)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		selectedTrackStore.handleTrackSelected(0);
	});

	describe('paramPath()', () => {
		it('composes tracks/<N>/devices/<N>/params/<N> from a Device and paramIndex', () => {
			const device: Device = {
				id: 42,
				index: 2,
				name: 'Filter',
				className: 'AutoFilter'
			};
			setSelectedTrack(3, [device]);

			expect(selectedTrackStore.paramPath(device, 7)).toBe(
				'tracks/3/devices/2/params/7'
			);
		});

		it('composes from a pre-built devicePath string without touching selected track', () => {
			// Even if selected track is some other value, a string
			// devicePath is used verbatim — callers that already
			// resolved a full path (master, returns/N, etc.) stay in
			// control of the trackRef.
			setSelectedTrack(9, []);

			expect(selectedTrackStore.paramPath('master/devices/0', 4)).toBe(
				'master/devices/0/params/4'
			);
			expect(
				selectedTrackStore.paramPath('returns/1/devices/0', 2)
			).toBe('returns/1/devices/0/params/2');
		});
	});

	describe('paramValue()', () => {
		it('reads the value from v3Store.paramByPath', () => {
			replaceTree(5, [mkTrack(3, 2, 7, 0.87)]);

			expect(
				selectedTrackStore.paramValue('tracks/3/devices/2/params/7')
			).toBe(0.87);
		});

		it('returns undefined when the paramPath is not in the tree', () => {
			replaceTree(5, [mkTrack(3, 2, 7, 0.87)]);

			expect(
				selectedTrackStore.paramValue('tracks/99/devices/0/params/0')
			).toBeUndefined();
		});

		it('returns undefined when no state/full has landed yet', () => {
			// No replaceTree — tree is empty, generation is UNSET.
			expect(
				selectedTrackStore.paramValue('tracks/0/devices/0/params/0')
			).toBeUndefined();
		});

		// closeout-6 (2026-04-17): the "does not fall back to v2 cache"
		// test is no longer meaningful. `selectedTrackStore.setParameter`
		// was deleted in this closeout, and DeviceParameterStorage is now
		// devicePath-keyed rather than deviceId-keyed — there is no v2
		// cache branch to fall back to. The miss behaviour is covered by
		// the "returns undefined when tree has no entry" case above.
	});

	describe('setParamValue()', () => {
		it('emits /looping/v3/param/set with [paramPath, value, generation]', () => {
			replaceTree(42, [mkTrack(3, 2, 7, 0)]);

			selectedTrackStore.setParamValue(
				'tracks/3/devices/2/params/7',
				0.75
			);

			expect(send).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/3/devices/2/params/7',
				0.75,
				42
			]);
		});

		it('drops silently when generation is still UNSET', () => {
			// No replaceTree call — generation remains UNSET_GENERATION.
			selectedTrackStore.setParamValue(
				'tracks/0/devices/0/params/0',
				0.5
			);

			expect(send).not.toHaveBeenCalled();
		});

		it('does not pre-validate the path against the tree (surface decides)', () => {
			// The write path intentionally doesn't consult paramByPath
			// before emitting. A path that isn't in the tree yet can
			// still be emitted — the surface responds with an error
			// message if the path is unknown, and the tree will
			// reconcile on the next state/full. This keeps the UI
			// from having to mirror surface state transitions.
			replaceTree(11, [mkTrack(0, 0, 0, 0)]);

			selectedTrackStore.setParamValue('tracks/5/devices/9/params/3', 1);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/5/devices/9/params/3',
				1,
				11
			]);
		});

		it('optimistically updates the v3 store before emitting (XY snap-back fix)', () => {
			// Mirrors v2's `deviceParameterStorage.sendParameter` pattern:
			// the surface suppresses echoes for UI-armed pids
			// (MutationComponent.on_param_value_changed), so without a
			// local pre-emit the store stays stuck at the pre-write
			// value for the duration of a drag. The XY widget's
			// `$effect` re-runs on pointerup `isDragging` flip and
			// reassigns `localX = xValue` — to the stale value, which
			// shows up as the "snap to starting position" symptom.
			//
			// ADR-002 (2026-04-16): the read must be asserted against the
			// tree directly (`v3Store.tracks → devices → params`) rather
			// than the `paramByPath` `$derived.by`. Svelte 5 evaluates
			// `$derived` lazily but only re-runs when read inside a
			// tracking scope (component, `$effect`, `$derived`). In a
			// raw vitest assertion the first read caches the result;
			// mutating a nested `SvelteMap` in production re-fires
			// `$derived` inside components but not here. The business
			// invariant — "the write landed in the store before emit"
			// — is what matters; reading the tree directly asserts that
			// without requiring a reactive root in the test harness.
			replaceTree(7, [mkTrack(0, 0, 0, /* initial */ 0.1)]);

			expect(
				v3Store.tracks
					.get('tracks/0')!
					.devices.get('tracks/0/devices/0')!
					.params.get('tracks/0/devices/0/params/0')!.value
			).toBe(0.1);

			selectedTrackStore.setParamValue(
				'tracks/0/devices/0/params/0',
				0.9
			);

			expect(
				v3Store.tracks
					.get('tracks/0')!
					.devices.get('tracks/0/devices/0')!
					.params.get('tracks/0/devices/0/params/0')!.value
			).toBe(0.9);
			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/0/params/0',
				0.9,
				7
			]);
		});

		it('optimistic write no-ops when path is not in the tree', () => {
			// Same drop-on-missing posture as the echo handler: an
			// unknown path can't be optimistically written either, but
			// we still emit so the surface gets a chance to respond.
			replaceTree(11, [mkTrack(0, 0, 0, 0.1)]);

			selectedTrackStore.setParamValue('tracks/5/devices/9/params/3', 1);

			// Existing path untouched.
			expect(
				selectedTrackStore.paramValue('tracks/0/devices/0/params/0')
			).toBe(0.1);
			// Unknown path still not in store.
			expect(
				selectedTrackStore.paramValue('tracks/5/devices/9/params/3')
			).toBeUndefined();
			expect(send).toHaveBeenCalledTimes(1);
		});
	});

	// ----------------------------------------------------------------
	// PR-3.5.4 — `paramName` / `paramNamesForDevice` (path-keyed
	// parameter-name reads).
	//
	// `mkTrack` only stitches a single param per device, which isn't
	// rich enough to exercise the multi-param ordering contract that
	// `paramNamesForDevice` makes. The helper below builds a
	// many-params-per-device fixture that mirrors how state/full would
	// emit `P` records depth-first in chain order.
	// ----------------------------------------------------------------

	function mkTrackWithParams(
		trackIdx: number,
		deviceIdx: number,
		paramNames: string[]
	): TrackRecord {
		const trackPath = `tracks/${trackIdx}`;
		const devicePath = `${trackPath}/devices/${deviceIdx}`;
		// ADR-002: SvelteMap so params participate in reactivity.
		const params = new SvelteMap<
			string,
			{
				paramPath: string;
				name: string;
				displayName: string;
				min: number;
				max: number;
				value: number;
				unit: string;
			}
		>();
		paramNames.forEach((name, paramIdx) => {
			const paramPath = `${devicePath}/params/${paramIdx}`;
			params.set(paramPath, {
				paramPath,
				name,
				displayName: name,
				min: 0,
				max: 1,
				value: 0,
				unit: ''
			});
		});
		return {
			trackPath,
			name: `t${trackIdx}`,
			color: 0,
			mute: false,
			solo: false,
			arm: false,
			hasMidiInput: true,
			hasAudioInput: false,
			hasArrangementClips: false,
			// ADR-410: plain top-level track (not a group, not folded, no parent).
			isFoldable: false,
			foldState: false,
			groupTrackIndex: -1,
			role: '',
			devices: new SvelteMap([
				[
					devicePath,
					{
						devicePath,
						name: `d${deviceIdx}`,
						className: 'AudioEffect',
						params,
						properties: new SvelteMap()
					}
				]
			]),
			slots: new SvelteMap()
		};
	}

	describe('paramName() (PR-3.5.4)', () => {
		it('returns the name for a paramPath in the tree', () => {
			replaceTree(7, [
				mkTrackWithParams(2, 1, ['Macro', 'Cutoff', 'Resonance'])
			]);

			expect(
				selectedTrackStore.paramName('tracks/2/devices/1/params/1')
			).toBe('Cutoff');
			expect(
				selectedTrackStore.paramName('tracks/2/devices/1/params/2')
			).toBe('Resonance');
		});

		it('returns undefined when the paramPath is not in the tree', () => {
			replaceTree(7, [mkTrackWithParams(0, 0, ['Macro'])]);

			expect(
				selectedTrackStore.paramName('tracks/9/devices/0/params/0')
			).toBeUndefined();
		});

		it('returns undefined before any state/full has landed (cold start)', () => {
			expect(
				selectedTrackStore.paramName('tracks/0/devices/0/params/0')
			).toBeUndefined();
		});
	});

	describe('paramNamesForDevice() (PR-3.5.4)', () => {
		it('returns names indexed by paramIndex for a devicePath', () => {
			replaceTree(7, [
				mkTrackWithParams(2, 1, ['Macro', 'Cutoff', 'Resonance', 'Drive'])
			]);

			expect(
				selectedTrackStore.paramNamesForDevice('tracks/2/devices/1')
			).toEqual(['Macro', 'Cutoff', 'Resonance', 'Drive']);
		});

		it('preserves wire/chain order (insertion order of params Map)', () => {
			// Build with shuffled keys via a Map literal — insertion
			// order is what wire emission gave us, and that's what
			// `paramNamesForDevice` must hand back.
			replaceTree(7, [
				mkTrackWithParams(0, 0, ['p0', 'p1', 'p2', 'p3', 'p4'])
			]);

			expect(
				selectedTrackStore.paramNamesForDevice('tracks/0/devices/0')
			).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
		});

		it('returns [] when the devicePath is not in the tree', () => {
			replaceTree(7, [mkTrackWithParams(0, 0, ['Macro'])]);

			expect(
				selectedTrackStore.paramNamesForDevice('tracks/9/devices/0')
			).toEqual([]);
		});

		it('returns [] before any state/full has landed (cold start)', () => {
			expect(
				selectedTrackStore.paramNamesForDevice('tracks/0/devices/0')
			).toEqual([]);
		});

		it('accepts a v2 Device — composes against the selected track', () => {
			replaceTree(7, [
				mkTrackWithParams(3, 2, ['Macro', 'FX1', 'FX2'])
			]);
			const device: Device = {
				id: 999,
				index: 2,
				name: 'd2',
				className: 'AudioEffect'
			};
			setSelectedTrack(3, [device]);

			expect(selectedTrackStore.paramNamesForDevice(device)).toEqual([
				'Macro',
				'FX1',
				'FX2'
			]);
		});

		it('accepts a DeviceRecord — uses its own devicePath, not _trackIndex', () => {
			// Selected track is track 0, but the DeviceRecord points at
			// track 5. The DeviceRecord's devicePath is the canonical
			// trackRef — `_trackIndex` is ignored on this path.
			replaceTree(7, [
				mkTrackWithParams(5, 0, ['Macro', 'Cutoff'])
			]);
			setSelectedTrack(0, []);

			const record: DeviceRecord = {
				devicePath: 'tracks/5/devices/0',
				name: 'd0',
				className: 'AudioEffect',
				params: new SvelteMap<string, ParamRecord>(), // not consulted by paramNamesForDevice
				properties: new SvelteMap<string, OSCArg>()
			};

			expect(selectedTrackStore.paramNamesForDevice(record)).toEqual([
				'Macro',
				'Cutoff'
			]);
		});

		it('refreshes on tree mutation (preset swap simulation)', () => {
			// Initial preset.
			replaceTree(1, [
				mkTrackWithParams(0, 0, ['Macro', 'Old1', 'Old2'])
			]);
			expect(
				selectedTrackStore.paramNamesForDevice('tracks/0/devices/0')
			).toEqual(['Macro', 'Old1', 'Old2']);

			// Preset swap — same devicePath, new param names, bumped
			// generation. Models what state/full does after a rack
			// preset reload.
			replaceTree(2, [
				mkTrackWithParams(0, 0, ['Macro', 'New1', 'New2', 'New3'])
			]);
			expect(
				selectedTrackStore.paramNamesForDevice('tracks/0/devices/0')
			).toEqual(['Macro', 'New1', 'New2', 'New3']);
		});

		it('all three overloads agree on the same device', () => {
			replaceTree(7, [
				mkTrackWithParams(3, 2, ['Macro', 'A', 'B', 'C'])
			]);
			const device: Device = {
				id: 1,
				index: 2,
				name: 'd2',
				className: 'AudioEffect'
			};
			setSelectedTrack(3, [device]);
			const record: DeviceRecord = {
				devicePath: 'tracks/3/devices/2',
				name: 'd2',
				className: 'AudioEffect',
				params: new SvelteMap<string, ParamRecord>(),
				properties: new SvelteMap<string, OSCArg>()
			};

			const expected = ['Macro', 'A', 'B', 'C'];
			expect(selectedTrackStore.paramNamesForDevice(device)).toEqual(
				expected
			);
			expect(selectedTrackStore.paramNamesForDevice(record)).toEqual(
				expected
			);
			expect(
				selectedTrackStore.paramNamesForDevice('tracks/3/devices/2')
			).toEqual(expected);
		});
	});

	// ----------------------------------------------------------------
	// PR-3.5.5 — `audioEffectRackByPath` / `sequencerByPath` (class-keyed
	// device scans off the v3 tree, replacing the `classifiedDevices`
	// filter used by the deprecated `audioEffectRack` / `sequencer`
	// getters).
	//
	// Unlike `mkTrackWithParams`, these tests stitch a multi-device
	// track so the getter's "first match wins" scan can be exercised.
	// ----------------------------------------------------------------

	type TestDeviceSpec = { index: number; name: string; className: string };

	function mkTrackWithDevices(
		trackIdx: number,
		specs: TestDeviceSpec[]
	): TrackRecord {
		const trackPath = `tracks/${trackIdx}`;
		// ADR-002: tree-shape Maps must be SvelteMap for mutation reactivity.
		const devices = new SvelteMap<string, {
			devicePath: string;
			name: string;
			className: string;
			params: Map<string, never>;
			properties: Map<string, never>;
		}>();
		for (const spec of specs) {
			const devicePath = `${trackPath}/devices/${spec.index}`;
			devices.set(devicePath, {
				devicePath,
				name: spec.name,
				className: spec.className,
				params: new SvelteMap(),
				properties: new SvelteMap()
			});
		}
		return {
			trackPath,
			name: `t${trackIdx}`,
			color: 0,
			mute: false,
			solo: false,
			arm: false,
			hasMidiInput: true,
			hasAudioInput: false,
			hasArrangementClips: false,
			// ADR-410: plain top-level track (not a group, not folded, no parent).
			isFoldable: false,
			foldState: false,
			groupTrackIndex: -1,
			role: '',
			devices,
			slots: new SvelteMap()
		};
	}

	describe('audioEffectRackByPath (PR-3.5.5)', () => {
		it('returns undefined before any state/full has landed (cold start)', () => {
			expect(selectedTrackStore.audioEffectRackByPath).toBeUndefined();
		});

		it('returns undefined when no device on the selected track matches', () => {
			replaceTree(1, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'Operator', className: 'Operator' },
					{ index: 1, name: 'Delay', className: 'Delay' }
				])
			]);
			setSelectedTrack(0, []);

			expect(selectedTrackStore.audioEffectRackByPath).toBeUndefined();
		});

		it('returns the DeviceRecord with className === AudioEffectGroupDevice', () => {
			replaceTree(1, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'Operator', className: 'Operator' },
					{ index: 1, name: 'My Rack', className: 'AudioEffectGroupDevice' },
					{ index: 2, name: 'Delay', className: 'Delay' }
				])
			]);
			setSelectedTrack(0, []);

			const rack = selectedTrackStore.audioEffectRackByPath;
			expect(rack).toBeDefined();
			expect(rack?.devicePath).toBe('tracks/0/devices/1');
			expect(rack?.name).toBe('My Rack');
			expect(rack?.className).toBe('AudioEffectGroupDevice');
		});

		it('composes against selectedTrackPath (track switch re-derives)', () => {
			replaceTree(1, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'Operator', className: 'Operator' }
				]),
				mkTrackWithDevices(1, [
					{ index: 0, name: 'Master Rack', className: 'AudioEffectGroupDevice' }
				])
			]);

			// Track 0: no rack
			setSelectedTrack(0, []);
			expect(selectedTrackStore.audioEffectRackByPath).toBeUndefined();

			// Track 1: has rack
			setSelectedTrack(1, []);
			const rack = selectedTrackStore.audioEffectRackByPath;
			expect(rack?.devicePath).toBe('tracks/1/devices/0');
			expect(rack?.name).toBe('Master Rack');
		});

		it('returns first matching device when multiple racks are present', () => {
			// Contract: the scan walks the devices Map in LOM chain order
			// (insertion order). First match at chain position 1 wins.
			replaceTree(1, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'Operator', className: 'Operator' },
					{ index: 1, name: 'First Rack', className: 'AudioEffectGroupDevice' },
					{ index: 2, name: 'Second Rack', className: 'AudioEffectGroupDevice' }
				])
			]);
			setSelectedTrack(0, []);

			expect(selectedTrackStore.audioEffectRackByPath?.name).toBe(
				'First Rack'
			);
		});

		it('refreshes on tree mutation (preset swap / device add)', () => {
			// Initial: rack present.
			replaceTree(1, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'Old Rack', className: 'AudioEffectGroupDevice' }
				])
			]);
			setSelectedTrack(0, []);
			expect(selectedTrackStore.audioEffectRackByPath?.name).toBe('Old Rack');

			// Preset swap: same chain position, different rack name + new gen.
			replaceTree(2, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'New Rack', className: 'AudioEffectGroupDevice' }
				])
			]);
			expect(selectedTrackStore.audioEffectRackByPath?.name).toBe('New Rack');

			// Structural swap: rack removed, only a plain FX remains.
			replaceTree(3, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'Delay', className: 'Delay' }
				])
			]);
			expect(selectedTrackStore.audioEffectRackByPath).toBeUndefined();
		});
	});

	describe('sequencerByPath (PR-3.5.5)', () => {
		it('returns undefined before any state/full has landed (cold start)', () => {
			expect(selectedTrackStore.sequencerByPath).toBeUndefined();
		});

		it('matches className === MxDeviceAudioEffect AND name === Permute', () => {
			// `DEVICE_PRESETS.sequencer.defaultName` is 'Permute' — the
			// sequencer predicate is a composite (class + name), so both
			// must match. This mirrors the v2 `classifyDevice` predicate
			// at line 1207 of selectedTrackStore.
			replaceTree(1, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'Operator', className: 'Operator' },
					{ index: 1, name: 'Permute', className: 'MxDeviceAudioEffect' }
				])
			]);
			setSelectedTrack(0, []);

			const seq = selectedTrackStore.sequencerByPath;
			expect(seq).toBeDefined();
			expect(seq?.devicePath).toBe('tracks/0/devices/1');
			expect(seq?.name).toBe('Permute');
		});

		it('returns undefined for MxDeviceAudioEffect with a different name', () => {
			// Other Max devices share the className but aren't the
			// sequencer (e.g. movement-filter / movement-tremolo — both
			// MxDeviceAudioEffect per devicePresets.ts).
			replaceTree(1, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'movement-filter', className: 'MxDeviceAudioEffect' }
				])
			]);
			setSelectedTrack(0, []);

			expect(selectedTrackStore.sequencerByPath).toBeUndefined();
		});

		it('returns undefined for matching name but wrong className', () => {
			// A device renamed to "Permute" but not actually the Max
			// sequencer — predicate requires both.
			replaceTree(1, [
				mkTrackWithDevices(0, [
					{ index: 0, name: 'Permute', className: 'Delay' }
				])
			]);
			setSelectedTrack(0, []);

			expect(selectedTrackStore.sequencerByPath).toBeUndefined();
		});
	});
});
