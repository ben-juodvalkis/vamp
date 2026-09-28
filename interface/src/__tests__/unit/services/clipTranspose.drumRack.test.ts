/**
 * clipTranspose — the ±12 buttons on a Drum Rack write `vm.pitch`
 * (ADR-428, Milestone 1b).
 *
 * Before this milestone `transposeDevice` found the rack's transpose macro
 * by NAME (`Pitch` / `Transpose` / `Custom E` …) and wrote it in macro
 * units — inert on the 2,503-kit pipeline family, whose transpose macro
 * is "Macro 4", and on every unmapped kit. The contract now:
 *
 *  1. DRUM RACK → `vm.pitch`: read the surface-held semitones back from
 *     the property store, add ±12, clamp to ±48, write through
 *     `setPropertyValue` (optimistic store write + `property/set`).
 *  2. NEVER NOTES — on a Drum Rack the clip-transpose path lands on the
 *     same property; `/looping/v3/clip/transpose` is never sent, because
 *     +12 on a kit triggers different pads, not a higher pitch.
 *  3. HELD / NONE → no write: when the `vm.members` census says every
 *     pitch member is macro-held, or the kit has none, the press is
 *     refused rather than storing a pitch nothing has.
 *  4. NO COLD READ YET → no write: nothing to add ±12 to.
 *  5. INSTRUMENT RACK asks the surface first (`/looping/v3/track/transpose`,
 *     which finds a Drum Rack wrapped inside it by class, as Permute's
 *     pitch route does). `drum` / `none` end the press; `not-drum` keeps
 *     the name scan and macro units, then the notes; `held` gets the
 *     macro but never the notes; no answer at all falls back as
 *     `not-drum`.
 *
 * Real v3 store, real selectedTrackStore; `getClipContext` is mocked so
 * the routing inputs are explicit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// The surface's answer to `/looping/v3/track/transpose`, delivered on the
// inbound bus as soon as the request goes out; `null` = never answers.
const { surface } = vi.hoisted(() => ({ surface: { reply: 'not-drum' as string | null } }));

vi.mock('$lib/api/simpleClient', async () => {
	const bus = await import('$lib/api/connection/oscMessageBus');
	return {
		send: vi.fn((address: string, args: unknown[]) => {
			if (address !== '/looping/v3/track/transpose' || surface.reply === null) return;
			const reply = surface.reply;
			queueMicrotask(() =>
				bus.dispatchOscMessage({
					address: '/looping/v3/track/transpose/reply',
					args: [args[0], reply, '', 0]
				})
			);
		})
	};
});

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

const { ctx } = vi.hoisted(() => ({
	ctx: {
		trackType: 'midi' as 'midi' | 'audio' | null,
		trackIndex: 0,
		instrumentType: 'drumrack' as string | null,
		deviceIndex: 0 as number | null,
		hasDetailClip: true,
		detailClipIndices: { track: 0, scene: 0 } as { track: number; scene: number } | null
	}
}));

vi.mock('$lib/services/clipContext', () => ({
	getClipContext: () => ({ ...ctx })
}));

vi.mock('$lib/stores/session.svelte', () => ({
	session: {
		get focusedClipPath() {
			return 'tracks/0/slots/0/clip';
		}
	},
	requireFocusedClip: vi.fn(() => 'tracks/0/slots/0/clip')
}));

import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { send } from '$lib/api/simpleClient';
import { logger } from '$lib/utils/logger';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	replaceTree,
	applyPropertyValue,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import {
	transposeDeviceUp,
	transposeDeviceDown,
	transposeClipUp,
	TRACK_TRANSPOSE_TIMEOUT_MS
} from '$lib/services/clipTranspose';
import { oscMessageListenerCount } from '$lib/api/connection/oscMessageBus';

const sendMock = send as unknown as ReturnType<typeof vi.fn>;
const warnMock = logger.warn as unknown as ReturnType<typeof vi.fn>;

const GENERATION = 5;
const DEVICE = 'tracks/0/devices/0';
const PROPERTY_SET = '/looping/v3/property/set';
const PARAM_SET = '/looping/v3/param/set';
const CLIP_TRANSPOSE = '/looping/v3/clip/transpose';

function censusWith(pitch: { members: number; held: number }): string {
	const fns: Record<string, { members: number; held: number }> = {};
	for (const fn of ['fx1', 'fx2', 'fxType', 'attack', 'decay', 'start']) fns[fn] = { members: 24, held: 0 };
	fns.pitch = pitch;
	return JSON.stringify({
		family: true,
		functions: fns,
		hasMacroMappings: pitch.held > 0,
		padClasses: { DrumCell: 24 },
		padCount: 24
	});
}

function mkTrack(
	className: string,
	paramNames: Array<[string, number]> = [],
	properties: Record<string, OSCArg> = {}
): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	paramNames.forEach(([name, value], i) => {
		const paramPath = `${DEVICE}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min: 0, max: 127, value, unit: '' });
	});
	const device: DeviceRecord = {
		devicePath: DEVICE,
		name: className,
		className,
		params,
		properties: new SvelteMap<string, OSCArg>(Object.entries(properties))
	};
	return {
		trackPath: 'tracks/0',
		name: 'Drums',
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
		// Protocol 3.7.0: the persisted rail; nothing recorded.
		role: '',
		devices: new SvelteMap<string, DeviceRecord>([[DEVICE, device]]),
		slots: new SvelteMap()
	};
}

function seedDrumRack(pitch: OSCArg | undefined, census: string | undefined) {
	const props: Record<string, OSCArg> = {};
	if (pitch !== undefined) props['vm.pitch'] = pitch;
	if (census !== undefined) props['vm.members'] = census;
	replaceTree(GENERATION, [mkTrack('DrumGroupDevice', [['Device On', 1]], props)]);
	selectedTrackStore.handleTrackSelected(0);
}

function propertySets() {
	return sendMock.mock.calls.filter(([addr]) => addr === PROPERTY_SET).map(([, args]) => args);
}

describe('clipTranspose — Drum Rack ±12 through vm.pitch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		ctx.trackType = 'midi';
		ctx.instrumentType = 'drumrack';
		ctx.deviceIndex = 0;
	});

	it('+12 reads the held pitch, adds an octave and writes vm.pitch', async () => {
		seedDrumRack(0, censusWith({ members: 24, held: 0 }));
		await transposeDeviceUp();
		expect(propertySets()).toEqual([[DEVICE, 'vm.pitch', 12, GENERATION]]);
		expect(selectedTrackStore.propertyValue(DEVICE, 'vm.pitch')).toBe(12);
	});

	it('−12 from a transposed kit lands on the new value, not on a macro unit', async () => {
		seedDrumRack(7, censusWith({ members: 24, held: 0 }));
		await transposeDeviceDown();
		expect(propertySets()).toEqual([[DEVICE, 'vm.pitch', -5, GENERATION]]);
	});

	it('clamps to the ±48 rail and no-ops once pinned there', async () => {
		seedDrumRack(40, censusWith({ members: 24, held: 0 }));
		await transposeDeviceUp();
		expect(propertySets()).toEqual([[DEVICE, 'vm.pitch', 48, GENERATION]]);
		await transposeDeviceUp();
		expect(propertySets()).toHaveLength(1); // 48 + 12 → 48: nothing to send
	});

	it('works without a census (Milestone 1 rendering) — unknown accepts writes', async () => {
		seedDrumRack(0, undefined);
		await transposeDeviceUp();
		expect(propertySets()).toEqual([[DEVICE, 'vm.pitch', 12, GENERATION]]);
	});

	it('refuses when every pitch member is macro-held (the still-mapped Jazz kit)', async () => {
		seedDrumRack(0, censusWith({ members: 32, held: 32 }));
		await transposeDeviceUp();
		expect(propertySets()).toEqual([]);
		expect(selectedTrackStore.propertyValue(DEVICE, 'vm.pitch')).toBe(0);
		expect(warnMock).toHaveBeenCalledWith(
			expect.stringContaining('not writable'),
			expect.objectContaining({ state: 'held' })
		);
	});

	it('refuses when the kit has no pitch member at all', async () => {
		seedDrumRack(0, censusWith({ members: 0, held: 0 }));
		await transposeDeviceUp();
		expect(propertySets()).toEqual([]);
		expect(warnMock).toHaveBeenCalledWith(
			expect.stringContaining('not writable'),
			expect.objectContaining({ state: 'none' })
		);
	});

	it('refuses before the vm.pitch cold read has landed', async () => {
		seedDrumRack(undefined, censusWith({ members: 24, held: 0 }));
		await transposeDeviceUp();
		expect(propertySets()).toEqual([]);
		expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('no cached vm.pitch'), expect.anything());
	});

	it('the clip-transpose path on a Drum Rack lands on vm.pitch and never shifts notes', async () => {
		seedDrumRack(0, censusWith({ members: 24, held: 0 }));
		await transposeClipUp();
		expect(propertySets()).toEqual([[DEVICE, 'vm.pitch', 12, GENERATION]]);
		expect(sendMock.mock.calls.some(([addr]) => addr === CLIP_TRANSPOSE)).toBe(false);
	});

	it('never falls back to note-shifting on a Drum Rack, even with nothing to write', async () => {
		seedDrumRack(undefined, undefined);
		await transposeClipUp();
		expect(sendMock.mock.calls.some(([addr]) => addr === CLIP_TRANSPOSE)).toBe(false);
	});

	it('ignores a Drum Rack macro literally named Transpose — the name scan is retired for racks', async () => {
		// Jazz kit shape: macro 1 = Transpose, still mapped. The old code
		// would have written param 1 in macro units.
		const props = { 'vm.pitch': 0, 'vm.members': censusWith({ members: 32, held: 0 }) };
		replaceTree(GENERATION, [mkTrack('DrumGroupDevice', [['Device On', 1], ['Transpose', 63.5], ['Release', 63.5]], props)]);
		selectedTrackStore.handleTrackSelected(0);
		await transposeDeviceUp();
		expect(sendMock.mock.calls.some(([addr]) => addr === PARAM_SET)).toBe(false);
		expect(propertySets()).toEqual([[DEVICE, 'vm.pitch', 12, GENERATION]]);
	});
});

describe('clipTranspose — instrument racks: the surface looks for a wrapped kit first', () => {
	const TRACK_TRANSPOSE = '/looping/v3/track/transpose';
	const sent = (addr: string) => sendMock.mock.calls.filter(([a]) => a === addr);

	function seedRack(macros: Array<[string, number]>) {
		replaceTree(GENERATION, [mkTrack('InstrumentGroupDevice', [['Device On', 1], ...macros])]);
		selectedTrackStore.handleTrackSelected(0);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		_resetForTests();
		ctx.trackType = 'midi';
		ctx.instrumentType = 'instrument-rack';
		ctx.deviceIndex = 0;
		surface.reply = 'not-drum';
	});

	it('asks the surface with the track path and the semitones', async () => {
		seedRack([['Transpose', 64]]);
		await transposeDeviceUp();
		expect(sent(TRACK_TRANSPOSE)).toHaveLength(1);
		const [, args] = sent(TRACK_TRANSPOSE)[0];
		expect(args.slice(1)).toEqual(['tracks/0', 12]);
	});

	it('a wrapped kit the surface moved: no macro write, no note shift', async () => {
		surface.reply = 'drum';
		seedRack([['Transpose', 64]]);
		await transposeClipUp();
		expect(sent(PARAM_SET)).toEqual([]);
		expect(sent(CLIP_TRANSPOSE)).toEqual([]);
	});

	it('no kit: +12 writes the rack Transpose macro by 16 units, as before', async () => {
		seedRack([['Transpose', 64]]);
		await transposeDeviceUp();
		expect(sendMock).toHaveBeenCalledWith(PARAM_SET, [`${DEVICE}/params/1`, 80, GENERATION]);
		expect(propertySets()).toEqual([]);
	});

	it('no kit and no pitch macro: the clip path shifts the notes', async () => {
		seedRack([['Cutoff', 64]]);
		await transposeClipUp();
		expect(sent(CLIP_TRANSPOSE)).toHaveLength(1);
	});

	it('a macro-held kit gets the named macro, and never the notes', async () => {
		surface.reply = 'held';
		seedRack([['Transpose', 64]]);
		await transposeClipUp();
		expect(sendMock).toHaveBeenCalledWith(PARAM_SET, [`${DEVICE}/params/1`, 80, GENERATION]);
		vi.clearAllMocks();
		seedRack([['Cutoff', 64]]);
		await transposeClipUp();
		expect(sent(PARAM_SET)).toEqual([]);
		expect(sent(CLIP_TRANSPOSE)).toEqual([]);
	});

	it('a kit with no pitch to move ends the press', async () => {
		surface.reply = 'none';
		seedRack([['Transpose', 64]]);
		await transposeClipUp();
		expect(sent(PARAM_SET)).toEqual([]);
		expect(sent(CLIP_TRANSPOSE)).toEqual([]);
	});

	it('a surface that never answers falls back to the old path after the timeout', async () => {
		vi.useFakeTimers();
		surface.reply = null;
		seedRack([['Transpose', 64]]);
		const done = transposeDeviceUp();
		await vi.advanceTimersByTimeAsync(TRACK_TRANSPOSE_TIMEOUT_MS);
		await done;
		expect(sendMock).toHaveBeenCalledWith(PARAM_SET, [`${DEVICE}/params/1`, 80, GENERATION]);
		expect(oscMessageListenerCount()).toBe(0);
		vi.useRealTimers();
	});
});
