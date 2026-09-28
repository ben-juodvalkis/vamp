/**
 * ADR-003 reconciling replaceTree — identity-preservation tests.
 *
 * Goal: prove that `replaceTree` no longer churns identity on every
 * state/full. The bug this fixes is the Omnisphere XY snap-back:
 * VST preset loads trigger 2–3 state/fulls in ~500ms; if each one
 * blows away the `ParamRecord` identity, any in-flight optimistic
 * `applyParamValue` write lands on an orphaned record and the `$derived`
 * consumer upstream reads the newly-installed (wire-shipped) value
 * instead.
 *
 * These tests exercise the reconciler directly via the exported
 * `replaceTree` primitive. They assert on object identity, not just
 * value equality, because identity preservation *is* the contract.
 *
 * No ADR-003 was ever written — only adr-001 and adr-002 exist under
 * Looping's `documentation/archive/m4l-to-python-v3/`. The contract is the header
 * above plus `replaceTree` in `stores/v3/normalized.svelte.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import {
	_resetForTests,
	applyParamDisplay,
	applyParamValue,
	replaceTree,
	v3Store,
	type ClipRecord,
	type DeviceRecord,
	type ParamRecord,
	type SlotRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';

// ============================================
// Fixture builders
// ============================================

function mkParam(
	trackIdx: number,
	deviceIdx: number,
	paramIdx: number,
	overrides: Partial<ParamRecord> = {}
): ParamRecord {
	return {
		paramPath: `tracks/${trackIdx}/devices/${deviceIdx}/params/${paramIdx}`,
		name: `p${paramIdx}`,
		displayName: `P${paramIdx}`,
		min: 0,
		max: 1,
		value: 0.5,
		unit: '',
		...overrides
	};
}

function mkDevice(
	trackIdx: number,
	deviceIdx: number,
	params: ParamRecord[],
	overrides: Partial<DeviceRecord> = {}
): DeviceRecord {
	const devicePath = `tracks/${trackIdx}/devices/${deviceIdx}`;
	return {
		devicePath,
		name: `d${deviceIdx}`,
		className: 'AudioEffect',
		params: new SvelteMap(params.map((p) => [p.paramPath, p])),
		properties: new SvelteMap(),
		...overrides
	};
}

function mkTrack(
	trackIdx: number,
	devices: DeviceRecord[],
	slots: SlotRecord[] = [],
	overrides: Partial<TrackRecord> = {}
): TrackRecord {
	return {
		trackPath: `tracks/${trackIdx}`,
		name: `t${trackIdx}`,
		color: 0xff0000,
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
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])),
		slots: new SvelteMap(slots.map((s) => [s.slotPath, s])),
		...overrides
	};
}

function mkSlot(
	trackIdx: number,
	slotIdx: number,
	overrides: Partial<SlotRecord> = {}
): SlotRecord {
	return {
		slotPath: `tracks/${trackIdx}/slots/${slotIdx}`,
		state: 'empty',
		...overrides
	};
}

function mkClip(
	trackIdx: number,
	slotIdx: number,
	overrides: Partial<ClipRecord> = {}
): ClipRecord {
	return {
		clipPath: `tracks/${trackIdx}/slots/${slotIdx}/clip`,
		name: 'clip',
		length: 4,
		color: 0x00ff00,
		pitch: 0,
		properties: new SvelteMap(),
		...overrides
	};
}

beforeEach(() => {
	_resetForTests();
});

// ============================================
// Track-level identity preservation
// ============================================

describe('ADR-003 reconciling replaceTree — tracks', () => {
	it('preserves TrackRecord nested-Map identity across identical replaces', () => {
		const t0 = mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])]);
		replaceTree(1, [t0]);
		const beforeTrack = v3Store.tracks.get('tracks/0')!;
		const beforeDevices = beforeTrack.devices;
		const beforeSlots = beforeTrack.slots;

		// Second state/full with same data but *fresh* incoming records.
		const t0b = mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])]);
		replaceTree(2, [t0b]);

		const afterTrack = v3Store.tracks.get('tracks/0')!;
		// Nested Map references must be the same — components iterating
		// `track.devices` depend on this for $derived stability.
		expect(afterTrack.devices).toBe(beforeDevices);
		expect(afterTrack.slots).toBe(beforeSlots);
	});

	it('inserts new tracks without perturbing existing ones', () => {
		const t0 = mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])]);
		replaceTree(1, [t0]);
		const beforeT0Devices = v3Store.tracks.get('tracks/0')!.devices;

		replaceTree(2, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])]),
			mkTrack(1, [mkDevice(1, 0, [mkParam(1, 0, 0)])])
		]);

		// t0's nested Map identity holds; t1 is freshly inserted.
		expect(v3Store.tracks.get('tracks/0')!.devices).toBe(beforeT0Devices);
		expect(v3Store.tracks.has('tracks/1')).toBe(true);
	});

	it('deletes tracks absent from the incoming stream', () => {
		replaceTree(1, [mkTrack(0, []), mkTrack(1, [])]);
		replaceTree(2, [mkTrack(0, [])]);
		expect(v3Store.tracks.has('tracks/0')).toBe(true);
		expect(v3Store.tracks.has('tracks/1')).toBe(false);
	});

	it('re-inserts TrackRecord when scalar fields change (reactivity signal)', () => {
		replaceTree(1, [mkTrack(0, [], [], { name: 'old' })]);
		const beforeDevices = v3Store.tracks.get('tracks/0')!.devices;

		replaceTree(2, [mkTrack(0, [], [], { name: 'NEW' })]);

		const after = v3Store.tracks.get('tracks/0')!;
		expect(after.name).toBe('NEW');
		// Even when the TrackRecord was re-inserted, its .devices Map
		// identity is preserved — components iterating `track.devices`
		// are not re-keyed.
		expect(after.devices).toBe(beforeDevices);
	});
});

// ============================================
// Device-level identity preservation
// ============================================

describe('ADR-003 reconciling replaceTree — devices', () => {
	it('preserves DeviceRecord.params SvelteMap identity across identical replaces', () => {
		replaceTree(1, [mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])])]);
		const beforeParams = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!.params;

		replaceTree(2, [mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])])]);
		const afterParams = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!.params;

		expect(afterParams).toBe(beforeParams);
	});

	it('replaces identity when className differs (device hot-swap)', () => {
		replaceTree(1, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)], { className: 'Reverb' })])
		]);
		const beforeDevice = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!;

		replaceTree(2, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)], { className: 'Delay' })])
		]);
		const afterDevice = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!;

		// Different device in same slot — identity *must* change because
		// param semantics are stale by definition.
		expect(afterDevice).not.toBe(beforeDevice);
		expect(afterDevice.className).toBe('Delay');
	});

	it('deletes devices absent from the incoming stream', () => {
		replaceTree(1, [
			mkTrack(0, [
				mkDevice(0, 0, [mkParam(0, 0, 0)]),
				mkDevice(0, 1, [mkParam(0, 1, 0)])
			])
		]);

		replaceTree(2, [mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])])]);

		expect(
			v3Store.tracks.get('tracks/0')!.devices.has('tracks/0/devices/0')
		).toBe(true);
		expect(
			v3Store.tracks.get('tracks/0')!.devices.has('tracks/0/devices/1')
		).toBe(false);
	});
});

// ============================================
// Param-level identity preservation
// ============================================

describe('ADR-003 reconciling replaceTree — params', () => {
	it('preserves ParamRecord identity when value and metadata are unchanged', () => {
		replaceTree(1, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.3 })])])
		]);
		const beforeParam = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!
			.params.get('tracks/0/devices/0/params/0')!;

		replaceTree(2, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.3 })])])
		]);
		const afterParam = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!
			.params.get('tracks/0/devices/0/params/0')!;

		expect(afterParam).toBe(beforeParam);
	});

	it('Option A: surface wins when incoming value differs from existing', () => {
		// Mimic: user drags XY, optimistic write sets value to 0.9, then
		// a subsequent state/full arrives with the pre-drag 0.1 still on
		// the wire. Surface wins — existing (0.9) is overwritten.
		replaceTree(1, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.1 })])])
		]);
		applyParamValue('tracks/0/devices/0/params/0', 0.9);
		expect(
			v3Store.tracks
				.get('tracks/0')!
				.devices.get('tracks/0/devices/0')!
				.params.get('tracks/0/devices/0/params/0')!.value
		).toBe(0.9);

		// State/full arrives still shipping 0.1 — overwrite happens.
		replaceTree(2, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.1 })])])
		]);
		expect(
			v3Store.tracks
				.get('tracks/0')!
				.devices.get('tracks/0/devices/0')!
				.params.get('tracks/0/devices/0/params/0')!.value
		).toBe(0.1);
	});

	it('does NOT overwrite when incoming value matches existing (optimistic win held)', () => {
		// More realistic drag sequence: by the time the next state/full
		// arrives, the surface has observed the optimistic write, so the
		// wire ships 0.9 — which matches existing. No overwrite, identity
		// preserved.
		replaceTree(1, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.1 })])])
		]);
		applyParamValue('tracks/0/devices/0/params/0', 0.9);
		const afterOptimistic = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!
			.params.get('tracks/0/devices/0/params/0')!;
		expect(afterOptimistic.value).toBe(0.9);

		// Surface catches up — state/full ships 0.9.
		replaceTree(2, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.9 })])])
		]);
		const afterReconcile = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!
			.params.get('tracks/0/devices/0/params/0')!;
		// Identity preserved because value (and metadata) are unchanged.
		expect(afterReconcile).toBe(afterOptimistic);
		expect(afterReconcile.value).toBe(0.9);
	});

	it('preserves in-flight displayValue across a value-changing reconcile (ADR-352)', () => {
		// Mid-drag scenario: surface fires `param/display`, populating
		// the optional displayValue slot. Then a structural state/full
		// arrives (preset reload, device add) carrying the same param
		// but with a different value (and never carrying displayValue
		// on the wire). Without explicit preservation, the readout
		// would briefly go dark until the next param/set landed.
		replaceTree(1, [mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.1 })])])]);
		applyParamDisplay('tracks/0/devices/0/params/0', '440 Hz');
		expect(
			v3Store.tracks
				.get('tracks/0')!
				.devices.get('tracks/0/devices/0')!
				.params.get('tracks/0/devices/0/params/0')!.displayValue
		).toBe('440 Hz');

		// Structural state/full reconciles with a different value.
		replaceTree(2, [mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.6 })])])]);
		const after = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!
			.params.get('tracks/0/devices/0/params/0')!;
		expect(after.value).toBe(0.6);
		expect(after.displayValue).toBe('440 Hz');
	});

	it('preserves displayValue when metadata changes too', () => {
		// Same preservation contract on the metadata-changed branch —
		// device rename, range change, unit change all hit the same
		// re-insert path.
		replaceTree(1, [
			mkTrack(0, [
				mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.5, name: 'Cutoff' })])
			])
		]);
		applyParamDisplay('tracks/0/devices/0/params/0', '880 Hz');
		replaceTree(2, [
			mkTrack(0, [
				mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.5, name: 'Frequency' })])
			])
		]);
		const after = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!
			.params.get('tracks/0/devices/0/params/0')!;
		expect(after.name).toBe('Frequency');
		expect(after.displayValue).toBe('880 Hz');
	});

	it('re-inserts ParamRecord when metadata changes (name, range, unit)', () => {
		replaceTree(1, [
			mkTrack(0, [
				mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.5, name: 'Cutoff' })])
			])
		]);
		const beforeParam = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!
			.params.get('tracks/0/devices/0/params/0')!;

		replaceTree(2, [
			mkTrack(0, [
				mkDevice(0, 0, [mkParam(0, 0, 0, { value: 0.5, name: 'Frequency' })])
			])
		]);
		const afterParam = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!
			.params.get('tracks/0/devices/0/params/0')!;

		expect(afterParam).not.toBe(beforeParam);
		expect(afterParam.name).toBe('Frequency');
		expect(afterParam.value).toBe(0.5);
	});

	it('deletes params absent from the incoming stream', () => {
		replaceTree(1, [
			mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0), mkParam(0, 0, 1)])])
		]);

		replaceTree(2, [mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])])]);

		const params = v3Store.tracks
			.get('tracks/0')!
			.devices.get('tracks/0/devices/0')!.params;
		expect(params.has('tracks/0/devices/0/params/0')).toBe(true);
		expect(params.has('tracks/0/devices/0/params/1')).toBe(false);
	});
});

// ============================================
// Slot / clip identity preservation
// ============================================

describe('ADR-003 reconciling replaceTree — slots and clips', () => {
	it('preserves ClipRecord.properties SvelteMap identity across identical replaces', () => {
		replaceTree(1, [
			mkTrack(
				0,
				[],
				[mkSlot(0, 0, { state: 'has_clip', clip: mkClip(0, 0) })]
			)
		]);
		const beforeProps = v3Store.tracks
			.get('tracks/0')!
			.slots.get('tracks/0/slots/0')!.clip!.properties;

		replaceTree(2, [
			mkTrack(
				0,
				[],
				[mkSlot(0, 0, { state: 'has_clip', clip: mkClip(0, 0) })]
			)
		]);
		const afterProps = v3Store.tracks
			.get('tracks/0')!
			.slots.get('tracks/0/slots/0')!.clip!.properties;

		expect(afterProps).toBe(beforeProps);
	});

	it('clears clip when incoming slot has none', () => {
		replaceTree(1, [
			mkTrack(
				0,
				[],
				[mkSlot(0, 0, { state: 'has_clip', clip: mkClip(0, 0) })]
			)
		]);
		replaceTree(2, [mkTrack(0, [], [mkSlot(0, 0, { state: 'empty' })])]);

		const slot = v3Store.tracks
			.get('tracks/0')!
			.slots.get('tracks/0/slots/0')!;
		expect(slot.state).toBe('empty');
		expect(slot.clip).toBeUndefined();
	});
});
