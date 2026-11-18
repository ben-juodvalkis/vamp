/**
 * landingEffects (ADR-540): one record per load, its held values written
 * to the device that lands — the new one found by count, never by path,
 * so a second Reverb's values never reach the first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { SvelteMap } from 'svelte/reactivity';
import { flushSync } from 'svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { landingEffects, LANDING_TIMEOUT_MS } from '$lib/stores/v6/landingEffects.svelte';
import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
import { _resetForTests, replaceTree, type DeviceRecord, type ParamRecord, type TrackRecord } from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';

const TRACK = 'tracks/1';

function device(devicePath: string, name: string, className: string): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	['Device On', 'Decay', 'Dry/Wet'].forEach((pname, i) => {
		const paramPath = `${devicePath}/params/${i}`;
		params.set(paramPath, { paramPath, name: pname, displayName: pname, min: 0, max: 1, value: 0.5, unit: '' });
	});
	return { devicePath, name, className, params, properties: new SvelteMap<string, OSCArg>() };
}

function track(...chain: [string, string][]): TrackRecord {
	const devices = new SvelteMap<string, DeviceRecord>();
	chain.forEach(([name, className], i) => devices.set(`${TRACK}/devices/${i}`, device(`${TRACK}/devices/${i}`, name, className)));
	return {
		trackPath: TRACK, name: 'Bass', color: 0, mute: false, solo: false, arm: false,
		hasMidiInput: false, hasAudioInput: true, hasArrangementClips: false, isFoldable: false,
		foldState: false, groupTrackIndex: -1, role: '', devices, slots: new SvelteMap()
	};
}

const REVERB: [string, string] = ['Reverb', 'Hybrid'];
const COMP: [string, string] = ['Compressor', 'Compressor2'];
const reverbLoad = { trackPath: TRACK, target: '', type: 'reverb' as const, loadKey: 'native:Hybrid' };

let setParam: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	_resetForTests();
	landingEffects.clear();
	replaceTree(3, [track(REVERB, COMP)]);
	flushSync();
	setParam = vi.spyOn(selectedTrackStore, 'setParamValue').mockResolvedValue();
});
afterEach(() => {
	setParam.mockRestore();
	vi.useRealTimers();
});

describe('a load on its way', () => {
	it('writes a second Reverb\'s held values to the new Reverb, never the first', () => {
		const id = landingEffects.start(reverbLoad);
		expect(landingEffects.get(id)?.before).toBe(1); // one Reverb already there
		landingEffects.setPending(id, 1, 0.9);
		expect(landingEffects.pendingValue(id, 1)).toBe(0.9);
		// Something else changes: not the landing.
		replaceTree(4, [track(REVERB, COMP, ['Echo', 'Echo'])]);
		flushSync();
		expect(landingEffects.get(id)).toBeDefined();
		// The new Reverb arrives at the end.
		replaceTree(5, [track(REVERB, COMP, ['Echo', 'Echo'], REVERB)]);
		flushSync();
		expect(landingEffects.get(id)).toBeUndefined();
		expect(setParam).toHaveBeenCalledTimes(1);
		expect(setParam).toHaveBeenCalledWith(`${TRACK}/devices/3/params/1`, 0.9);
	});

	it('lands two of a type in order, each with its own values', () => {
		const a = landingEffects.start(reverbLoad);
		const b = landingEffects.start(reverbLoad);
		expect([landingEffects.get(a)?.before, landingEffects.get(b)?.before]).toEqual([1, 2]);
		landingEffects.setPending(a, 2, 0.2);
		landingEffects.setPending(b, 2, 0.7);
		replaceTree(4, [track(REVERB, COMP, REVERB)]);
		flushSync();
		expect(landingEffects.all().map((l) => l.id)).toEqual([b]);
		expect(setParam).toHaveBeenLastCalledWith(`${TRACK}/devices/2/params/2`, 0.2);
		replaceTree(5, [track(REVERB, COMP, REVERB, REVERB)]);
		flushSync();
		expect(landingEffects.all()).toEqual([]);
		expect(setParam).toHaveBeenLastCalledWith(`${TRACK}/devices/3/params/2`, 0.7);
	});

	it('drops a refused load, and the next of its type expects one fewer', () => {
		const a = landingEffects.start(reverbLoad);
		const b = landingEffects.start(reverbLoad);
		landingEffects.fail('native:Hybrid');
		expect(landingEffects.get(a)).toBeUndefined();
		expect(landingEffects.get(b)?.before).toBe(1);
		landingEffects.fail('native:Hybrid', `${TRACK}/devices/0/pads/38`); // a pad's failure is not this one
		expect(landingEffects.get(b)).toBeDefined();
	});

	it('gives up on a load Live never answers', () => {
		vi.useFakeTimers();
		const id = landingEffects.start(reverbLoad);
		vi.advanceTimersByTime(LANDING_TIMEOUT_MS);
		expect(landingEffects.get(id)).toBeUndefined();
	});

	it('names the loads on their way into a chain, oldest first', () => {
		const a = landingEffects.start(reverbLoad);
		const b = landingEffects.start({ ...reverbLoad, type: 'echo', loadKey: 'native:Echo' });
		landingEffects.start({ ...reverbLoad, trackPath: 'tracks/2' });
		expect(landingEffects.inChain(TRACK).map((l) => l.id)).toEqual([a, b]);
	});

	it('stops naming a load in its chain the moment its device is there, before the record is finished', () => {
		const id = landingEffects.start(reverbLoad);
		expect(landingEffects.inChain(TRACK).map((l) => l.id)).toEqual([id]);
		// The second Reverb arrives; read before any effect has run, as a
		// render in the same tick would. Its ghost must already be gone, or
		// the chain draws the Reverb twice for a frame.
		replaceTree(4, [track(REVERB, COMP, REVERB)]);
		expect(landingEffects.inChain(TRACK)).toEqual([]);
	});

	it('moves the hand put on a ghost onto the device it becomes, and back if it never lands', () => {
		fxChainStore.observeAppointed(`${TRACK}/devices/1`);
		const id = landingEffects.start(reverbLoad);
		const ghost = landingEffects.ghostPath(TRACK, id);
		fxChainStore.observeAppointed(ghost);
		expect(landingEffects.resolve(ghost)).toBe(ghost);
		replaceTree(4, [track(REVERB, COMP, REVERB)]);
		// Resolved in the same tick the device arrives, before the record finishes.
		expect(landingEffects.resolve(ghost)).toBe(`${TRACK}/devices/2`);
		flushSync();
		expect(fxChainStore.appointed).toBe(`${TRACK}/devices/2`);

		fxChainStore.observeAppointed(`${TRACK}/devices/1`);
		const lost = landingEffects.start(reverbLoad);
		fxChainStore.observeAppointed(landingEffects.ghostPath(TRACK, lost));
		landingEffects.cancel(lost);
		expect(fxChainStore.appointed).toBe(`${TRACK}/devices/1`);
	});
});
