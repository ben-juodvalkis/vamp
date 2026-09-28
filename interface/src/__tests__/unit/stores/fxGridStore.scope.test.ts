/**
 * FX-grid slots under a pad scope (issue #491, 2026-09-10).
 *
 * One slot table per pad path beside the track's: a scoped slot matches
 * against the pad's chain devices (or, before the pad's records land,
 * the stand-ins the presence row describes), a scoped load names the pad
 * as its target, pending values drain into the device that arrives on
 * the pad and never into the track's copy, a failure carrying the scope
 * resets only that scope's slot, and a track change drops every scope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/services/trackCommands', () => ({ setTrackName: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { SvelteMap } from 'svelte/reactivity';
import { flushSync } from 'svelte';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { send } from '$lib/api/simpleClient';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import {
	_resetForTests,
	applyPropertyValue,
	mergePadChain,
	replaceTree,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';
import { setPropertySender } from '$lib/stores/v3/propertySubscriptions.svelte';

const sendMock = vi.mocked(send);
// The property wire, for the chain-row holds the store keeps on loading pads.
const propertyWire = vi.fn();
setPropertySender(propertyWire);
const TRACK = 'tracks/2';
const RACK = `${TRACK}/devices/0`;
const PAD = `${RACK}/pads/38`;

function device(devicePath: string, name: string, className: string, paramNames: string[] = ['Device On', 'Dry/Wet']): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	paramNames.forEach((pname, i) => {
		const paramPath = `${devicePath}/params/${i}`;
		params.set(paramPath, { paramPath, name: pname, displayName: pname, min: 0, max: 1, value: 0.5, unit: '' });
	});
	return { devicePath, name, className, params, properties: new SvelteMap<string, OSCArg>() };
}

function drums(withTrackReverb = false): TrackRecord {
	const devices = new SvelteMap<string, DeviceRecord>([[RACK, device(RACK, 'Drum Rack', 'DrumGroupDevice', ['Device On'])]]);
	if (withTrackReverb) devices.set(`${TRACK}/devices/1`, device(`${TRACK}/devices/1`, 'Reverb', 'Hybrid'));
	return {
		trackPath: TRACK,
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
		role: 'drum',
		devices,
		slots: new SvelteMap()
	};
}

const reverbConfig = DEVICE_PRESETS.reverb;

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	replaceTree(3, [drums()]);
	selectedTrackStore.handleTrackSelected(2);
	fxGrid.resetForTrackChange();
	flushSync();
});

describe('a scoped slot', () => {
	it('is ghost until the pad has the device, and active once its records land — the track untouched', () => {
		replaceTree(3, [drums(true)]);
		flushSync();
		expect(selectedTrackStore.getFxGridSlot('reverb').state).toBe('active'); // the track's Reverb
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).state).toBe('ghost'); // the pad has none
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, device(`${PAD}/devices/1`, 'Reverb', 'Hybrid')]]));
		flushSync();
		const scoped = selectedTrackStore.getFxGridSlot('reverb', PAD);
		expect(scoped.state).toBe('active');
		expect(scoped.device?.devicePath).toBe(`${PAD}/devices/1`);
		// The unscoped slot still answers with the track's copy.
		expect(selectedTrackStore.getFxGridSlot('reverb').device?.devicePath).toBe(`${TRACK}/devices/1`);
	});

	it('reads active from the presence row before the pad bundle lands, with a writable stand-in', () => {
		applyPropertyValue(RACK, 'vm.padFx', JSON.stringify({
			pads: { '38': [{ index: 0, class: 'DrumCell', name: 'Snare', type: 1 }, { index: 1, class: 'Hybrid', name: 'Reverb', type: 2 }] }
		}));
		flushSync();
		const slot = selectedTrackStore.getFxGridSlot('reverb', PAD);
		expect(slot.state).toBe('active');
		expect(slot.device?.devicePath).toBe(`${PAD}/devices/1`);
		expect(slot.device?.params.size).toBe(0); // no values yet: controls at rest
		// The instrument is not a stand-in; the compressor is not on the pad.
		expect(selectedTrackStore.padDevices(PAD).map((d) => d.name)).toEqual(['Reverb']);
		expect(selectedTrackStore.getFxGridSlot('compressor', PAD).state).toBe('ghost');
		// A write composes a real path from the stand-in.
		expect(selectedTrackStore.paramPath(slot.device!, 1)).toBe(`${PAD}/devices/1/params/1`);
	});

	it('loads with the pad as the target and never renames the track', async () => {
		await selectedTrackStore.loadFxGridDevice('reverb', PAD);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/device/load', [TRACK, PAD, '', 'native:Hybrid', 'Reverb']);
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).state).toBe('loading');
		expect(selectedTrackStore.getFxGridSlot('reverb').state).toBe('ghost'); // the track's slot is untouched
		await selectedTrackStore.loadFxGridDevice('guitar', PAD);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/device/load', [TRACK, PAD, DEVICE_PRESETS.guitar.presetPath]);
		const { setTrackName } = await import('$lib/services/trackCommands');
		expect(setTrackName).not.toHaveBeenCalled();
	});

	it('drains pending values into the device that arrives on the pad, not the track', async () => {
		const setParam = vi.spyOn(selectedTrackStore, 'setParamValue').mockResolvedValue();
		await selectedTrackStore.loadFxGridDevice('reverb', PAD);
		selectedTrackStore.storePendingParam('reverb', 1, 0.9, PAD);
		// A track-level Reverb arriving meanwhile must not complete the pad's slot.
		replaceTree(4, [drums(true)]);
		flushSync();
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).state).toBe('loading');
		expect(setParam).not.toHaveBeenCalled();
		// The pad's own Reverb lands: the pad slot completes and the value drains there.
		mergePadChain(5, PAD, new Map([[`${PAD}/devices/1`, device(`${PAD}/devices/1`, 'Reverb', 'Hybrid')]]));
		flushSync();
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).state).toBe('active');
		expect(setParam).toHaveBeenCalledWith(`${PAD}/devices/1/params/1`, 0.9);
	});

	it('lists the pads with a load in flight until it lands or fails', async () => {
		expect(fxGrid.loadingPadScopes()).toEqual([]);
		await selectedTrackStore.loadFxGridDevice('reverb', PAD);
		expect(fxGrid.loadingPadScopes()).toEqual([PAD]);
		await selectedTrackStore.loadFxGridDevice('reverb'); // the track's own load is not a pad
		expect(fxGrid.loadingPadScopes()).toEqual([PAD]);
		// The device lands on the pad: the slot completes and the pad drops out.
		mergePadChain(5, PAD, new Map([[`${PAD}/devices/1`, device(`${PAD}/devices/1`, 'Reverb', 'Hybrid')]]));
		flushSync(); // the arrival hook runs in an effect
		expect(fxGrid.loadingPadScopes()).toEqual([]);
		// A failure drops it too.
		await selectedTrackStore.loadFxGridDevice('echo', PAD);
		expect(fxGrid.loadingPadScopes()).toEqual([PAD]);
		fxGrid.handleLoadFailed('native:Echo', PAD);
		expect(fxGrid.loadingPadScopes()).toEqual([]);
	});

	it('a failure carrying the scope resets that scope alone', async () => {
		await selectedTrackStore.loadFxGridDevice('reverb', PAD);
		await selectedTrackStore.loadFxGridDevice('reverb');
		fxGrid.handleLoadFailed('native:Hybrid', PAD);
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).state).toBe('ghost');
		expect(selectedTrackStore.getFxGridSlot('reverb').state).toBe('loading');
		fxGrid.handleLoadFailed('native:Hybrid', `${RACK}/pads/40`); // a scope never touched: nothing
		expect(selectedTrackStore.getFxGridSlot('reverb').state).toBe('loading');
	});

	it('every scope goes with the track', async () => {
		await selectedTrackStore.loadFxGridDevice('reverb', PAD);
		fxGrid.resetForTrackChange();
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).state).toBe('ghost');
	});

	it("lets a loading pad's chain row go with the track too (2026-09-12)", async () => {
		const wire = (address: string) =>
			propertyWire.mock.calls.filter(([a]) => a === address).map(([, args]) => (args as string[]).join(' '));
		await selectedTrackStore.loadFxGridDevice('reverb', PAD);
		flushSync();
		expect(wire('/looping/v3/property/subscribe')).toEqual([`${RACK} vm.padChain.38`]);
		fxGrid.resetForTrackChange();
		flushSync();
		expect(fxGrid.loadingPadScopes()).toEqual([]);
		expect(wire('/looping/v3/property/unsubscribe')).toEqual([`${RACK} vm.padChain.38`]);
	});

	it('follows presence when the pad map is stale — an effect added or removed while the pad was unsubscribed (2026-09-12)', () => {
		// A bundle landed once (the pad's Reverb), then the pad was let go: the
		// map stops refreshing, presence does not (it is the rack's row).
		mergePadChain(4, PAD, new Map([[`${PAD}/devices/1`, device(`${PAD}/devices/1`, 'Reverb', 'Hybrid')]]));
		flushSync();
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).state).toBe('active');

		// A Delay added to the pad in Live: active at once, as a stand-in
		// until the pad's next bundle. The Reverb keeps its records.
		applyPropertyValue(RACK, 'vm.padFx', JSON.stringify({ pads: { '38': [
			{ index: 0, class: 'DrumCell', name: 'Snare', type: 1 },
			{ index: 1, class: 'Hybrid', name: 'Reverb', type: 2 },
			{ index: 2, class: 'Echo', name: 'Echo', type: 2 }
		] } }));
		flushSync();
		const delay = selectedTrackStore.getFxGridSlot('echo', PAD);
		expect(delay.state).toBe('active');
		expect(delay.device?.params.size).toBe(0);
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).device?.params.size).toBe(2);

		// The Reverb removed and the Delay at its index: presence wins over
		// the map at that index too (a different class), and the Reverb is ghost.
		applyPropertyValue(RACK, 'vm.padFx', JSON.stringify({ pads: { '38': [
			{ index: 0, class: 'DrumCell', name: 'Snare', type: 1 },
			{ index: 1, class: 'Echo', name: 'Echo', type: 2 }
		] } }));
		flushSync();
		expect(selectedTrackStore.getFxGridSlot('reverb', PAD).state).toBe('ghost');
		expect(selectedTrackStore.getFxGridSlot('echo', PAD).device?.devicePath).toBe(`${PAD}/devices/1`);
	});

	it("lets a loading pad's chain row go while its rack is not at its path, and takes it again when the rack returns (2026-09-12)", async () => {
		const wire = (address: string) =>
			propertyWire.mock.calls.filter(([a]) => a === address).map(([, args]) => (args as string[]).join(' '));
		await selectedTrackStore.loadFxGridDevice('reverb', PAD);
		flushSync();
		expect(wire('/looping/v3/property/subscribe')).toEqual([`${RACK} vm.padChain.38`]);

		// A MIDI effect through the browser fallback transits the track at
		// index 0 (ADR-430's follow-up): the rack is `devices/1` for a beat,
		// and the surface has torn the row down at `devices/0`.
		const random = device(`${TRACK}/devices/0`, 'Random', 'MidiRandom', ['Device On']);
		const rack = device(`${TRACK}/devices/1`, 'Drum Rack', 'DrumGroupDevice', ['Device On']);
		replaceTree(4, [{ ...drums(), devices: new SvelteMap([[random.devicePath, random], [rack.devicePath, rack]]) }]);
		flushSync();
		expect(wire('/looping/v3/property/unsubscribe')).toEqual([`${RACK} vm.padChain.38`]); // the count reached zero

		// The rack is back at its path: the row is taken again — a fresh
		// subscribe, which is what the surface needs to send the records.
		replaceTree(5, [drums()]);
		flushSync();
		expect(wire('/looping/v3/property/subscribe')).toEqual([`${RACK} vm.padChain.38`, `${RACK} vm.padChain.38`]);
		expect(fxGrid.loadingPadScopes()).toEqual([PAD]); // the load itself is still in flight
	});
});
