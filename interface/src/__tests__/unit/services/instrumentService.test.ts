import { describe, it, expect } from 'vitest';
import { instrumentService, type InstrumentInfo } from '$lib/services/instrumentService';
import type { Device } from '$lib/types/device';

describe('instrumentService', () => {
	const createDevice = (
		id: number,
		index: number,
		name: string,
		className: string
	): Device => ({
		id,
		index,
		name,
		className
	});

	describe('isInstrument', () => {
		it('should return true for DrumGroupDevice', () => {
			const device = createDevice(0, 0, 'Drum Rack', 'DrumGroupDevice');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for InstrumentGroupDevice', () => {
			const device = createDevice(0, 0, 'Instrument Rack', 'InstrumentGroupDevice');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for Operator', () => {
			const device = createDevice(0, 0, 'Operator', 'Operator');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for Analog', () => {
			const device = createDevice(0, 0, 'Analog', 'Analog');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for Wavetable', () => {
			const device = createDevice(0, 0, 'Wavetable', 'InstrumentVector');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for Drift', () => {
			const device = createDevice(0, 0, 'Drift', 'Drift');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for Sampler (MultiSampler)', () => {
			const device = createDevice(0, 0, 'Sampler', 'MultiSampler');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for OriginalSimpler', () => {
			const device = createDevice(0, 0, 'Simpler', 'OriginalSimpler');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for AuPluginDevice', () => {
			const device = createDevice(0, 0, 'Omnisphere', 'AuPluginDevice');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return true for PluginDevice', () => {
			const device = createDevice(0, 0, 'Serum', 'PluginDevice');
			expect(instrumentService.isInstrument(device)).toBe(true);
		});

		it('should return false for audio effects', () => {
			const device = createDevice(0, 0, 'Auto Filter', 'AutoFilter');
			expect(instrumentService.isInstrument(device)).toBe(false);
		});

		it('should return false for Compressor', () => {
			const device = createDevice(0, 0, 'Compressor', 'Compressor');
			expect(instrumentService.isInstrument(device)).toBe(false);
		});
	});

	describe('findInstrumentInDeviceList', () => {
		it('should find the first instrument in a device list', () => {
			const devices: Device[] = [
				createDevice(0, 0, 'Wavetable', 'InstrumentVector'),
				createDevice(1, 1, 'Auto Filter', 'AutoFilter')
			];

			const result = instrumentService.findInstrumentInDeviceList(devices);

			expect(result).not.toBeNull();
			expect(result?.className).toBe('InstrumentVector');
			expect(result?.deviceIndex).toBe(0);
		});

		it('should return null when no instrument found', () => {
			const devices: Device[] = [
				createDevice(0, 0, 'Auto Filter', 'AutoFilter'),
				createDevice(1, 1, 'Compressor', 'Compressor')
			];

			const result = instrumentService.findInstrumentInDeviceList(devices);

			expect(result).toBeNull();
		});

		it('should return null for empty device list', () => {
			const result = instrumentService.findInstrumentInDeviceList([]);
			expect(result).toBeNull();
		});

		it('should find instrument even if not first device', () => {
			const devices: Device[] = [
				createDevice(0, 0, 'Auto Filter', 'AutoFilter'),
				createDevice(1, 1, 'Wavetable', 'InstrumentVector'),
				createDevice(2, 2, 'Compressor', 'Compressor')
			];

			const result = instrumentService.findInstrumentInDeviceList(devices);

			expect(result).not.toBeNull();
			expect(result?.deviceIndex).toBe(1);
		});
	});

	describe('identifyInstrumentType', () => {
		const createInstrumentInfo = (
			deviceIndex: number,
			className: string,
			name: string
		): InstrumentInfo => ({
			deviceIndex,
			className,
			name,
			type: 'instrument'
		});

		it('should identify DrumGroupDevice as drumrack', () => {
			const info = createInstrumentInfo(0, 'DrumGroupDevice', 'Drum Rack');
			expect(instrumentService.identifyInstrumentType(info)).toBe('drumrack');
		});

		it('should identify Operator', () => {
			const info = createInstrumentInfo(0, 'Operator', 'Operator');
			expect(instrumentService.identifyInstrumentType(info)).toBe('operator');
		});

		it('should identify Analog', () => {
			const info = createInstrumentInfo(0, 'Analog', 'Analog');
			expect(instrumentService.identifyInstrumentType(info)).toBe('analog');
		});

		it('should identify Wavetable', () => {
			const info = createInstrumentInfo(0, 'InstrumentVector', 'Wavetable');
			expect(instrumentService.identifyInstrumentType(info)).toBe('wavetable');
		});

		it('should identify Drift', () => {
			const info = createInstrumentInfo(0, 'Drift', 'Drift');
			expect(instrumentService.identifyInstrumentType(info)).toBe('drift');
		});

		it('should identify Sampler (MultiSampler) as sampler', () => {
			const info = createInstrumentInfo(0, 'MultiSampler', 'Sampler');
			expect(instrumentService.identifyInstrumentType(info)).toBe('sampler');
		});

		it('should identify OriginalSimpler as simpler', () => {
			const info = createInstrumentInfo(0, 'OriginalSimpler', 'Simpler');
			expect(instrumentService.identifyInstrumentType(info)).toBe('simpler');
		});

		it('should identify InstrumentGroupDevice as instrument-rack', () => {
			const info = createInstrumentInfo(0, 'InstrumentGroupDevice', 'Bass Rack');
			expect(instrumentService.identifyInstrumentType(info)).toBe('instrument-rack');
		});

		it('should identify Omnisphere plugin', () => {
			const info = createInstrumentInfo(0, 'AuPluginDevice', 'Omnisphere 2');
			expect(instrumentService.identifyInstrumentType(info)).toBe('omnisphere');
		});

		it('should identify Komplete Kontrol plugin', () => {
			const info = createInstrumentInfo(0, 'AuPluginDevice', 'Komplete Kontrol');
			expect(instrumentService.identifyInstrumentType(info)).toBe('komplete-kontrol');
		});

		it('should identify generic AU plugin', () => {
			const info = createInstrumentInfo(0, 'AuPluginDevice', 'Serum');
			expect(instrumentService.identifyInstrumentType(info)).toBe('plugin');
		});

		it('should identify generic VST plugin', () => {
			const info = createInstrumentInfo(0, 'PluginDevice', 'Vital');
			expect(instrumentService.identifyInstrumentType(info)).toBe('plugin');
		});

		it('should handle case-insensitive Omnisphere detection', () => {
			const info = createInstrumentInfo(0, 'AuPluginDevice', 'OMNISPHERE');
			expect(instrumentService.identifyInstrumentType(info)).toBe('omnisphere');
		});

		it('should return unknown for unrecognized class', () => {
			const info = createInstrumentInfo(0, 'UnknownDevice', 'Mystery');
			expect(instrumentService.identifyInstrumentType(info)).toBe('unknown');
		});
	});

	describe('findAllInstruments', () => {
		it('should find all instruments in a mixed device list', () => {
			const devices: Device[] = [
				createDevice(0, 0, 'Wavetable', 'InstrumentVector'),
				createDevice(1, 1, 'Auto Filter', 'AutoFilter'),
				createDevice(2, 2, 'Operator', 'Operator'),
				createDevice(3, 3, 'Compressor', 'Compressor')
			];

			const instruments = instrumentService.findAllInstruments(devices);

			expect(instruments).toHaveLength(2);
			expect(instruments[0].className).toBe('InstrumentVector');
			expect(instruments[1].className).toBe('Operator');
		});

		it('should return empty array when no instruments', () => {
			const devices: Device[] = [
				createDevice(0, 0, 'Auto Filter', 'AutoFilter'),
				createDevice(1, 1, 'Compressor', 'Compressor')
			];

			const instruments = instrumentService.findAllInstruments(devices);

			expect(instruments).toHaveLength(0);
		});

		it('should preserve device indices in results', () => {
			const devices: Device[] = [
				createDevice(0, 0, 'Auto Filter', 'AutoFilter'),
				createDevice(1, 1, 'Wavetable', 'InstrumentVector'),
				createDevice(2, 2, 'Compressor', 'Compressor'),
				createDevice(3, 3, 'Analog', 'Analog')
			];

			const instruments = instrumentService.findAllInstruments(devices);

			expect(instruments[0].deviceIndex).toBe(1);
			expect(instruments[1].deviceIndex).toBe(3);
		});
	});
});

// ---------------------------------------------------------------------------
// ADR-428 Milestone 1b: every DrumGroupDevice is `drumrack`. The old split
// read macro names — FX1/FX2 on macros 1–2 meant `drumrack`, anything else
// `drumrack-komplete-kontrol` — which sent the Jazz kit (macro 1 =
// Transpose) and every Sampler kit to a macro grid whose sliders move
// nothing on an unmapped rack. The mode is now the view's decision, made
// from the surface's `vm.members` census.
// ---------------------------------------------------------------------------

import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';

function rackTrack(className: string, macroNames: string[]): TrackRecord {
	const devicePath = 'tracks/0/devices/0';
	const params = new SvelteMap<string, ParamRecord>();
	['Device On', ...macroNames].forEach((name, i) => {
		const paramPath = `${devicePath}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min: 0, max: 127, value: 0, unit: '' });
	});
	const device: DeviceRecord = {
		devicePath,
		name: className,
		className,
		params,
		properties: new SvelteMap<string, OSCArg>()
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
		devices: new SvelteMap<string, DeviceRecord>([[devicePath, device]]),
		slots: new SvelteMap()
	};
}

describe('identifyInstrumentTypeAsync — one type for every Drum Rack (ADR-428 M1b)', () => {
	const info = (className: string, name: string): InstrumentInfo => ({
		deviceIndex: 0,
		className,
		name,
		type: 'instrument',
		devicePath: 'tracks/0/devices/0'
	});

	beforeEach(() => {
		_resetForTests();
		selectedTrackStore.handleTrackSelected(0);
	});

	it('a pipeline kit (FX1 / FX2 macros) is drumrack', async () => {
		replaceTree(1, [rackTrack('DrumGroupDevice', ['FX1', 'FX2', 'Macro 3', 'Macro 4'])]);
		await expect(
			instrumentService.identifyInstrumentTypeAsync(info('DrumGroupDevice', ' 606 + 808'), 0)
		).resolves.toBe('drumrack');
	});

	it('the Jazz kit (Transpose / Release macros) is drumrack too — not a macro-grid type', async () => {
		replaceTree(1, [rackTrack('DrumGroupDevice', ['Transpose', 'Release', 'Macro 3', 'Macro 4'])]);
		await expect(
			instrumentService.identifyInstrumentTypeAsync(info('DrumGroupDevice', '32 Pad Kit Jazz'), 0)
		).resolves.toBe('drumrack');
	});

	it('a Komplete Kontrol-mapped rack is drumrack as well — the macro grid is the view\'s call', async () => {
		replaceTree(1, [rackTrack('DrumGroupDevice', ['Custom A', 'Custom B', 'Custom C', 'Custom D', 'Custom E'])]);
		await expect(
			instrumentService.identifyInstrumentTypeAsync(info('DrumGroupDevice', 'Drum Rack'), 0)
		).resolves.toBe('drumrack');
	});

	it('a Drum Rack with no parameter names yet is drumrack', async () => {
		await expect(
			instrumentService.identifyInstrumentTypeAsync(info('DrumGroupDevice', 'Drum Rack'), 0)
		).resolves.toBe('drumrack');
	});

	it('still spots a pattern Instrument Rack from its first macro', async () => {
		replaceTree(1, [rackTrack('InstrumentGroupDevice', ['Pattern 8', 'Macro 2'])]);
		await expect(
			instrumentService.identifyInstrumentTypeAsync(info('InstrumentGroupDevice', 'Patterns'), 0)
		).resolves.toBe('instrument-rack-pattern');
	});
});
